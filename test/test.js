var test = require('node:test');
var assert = require('node:assert');
var http = require('node:http');
var fs = require('node:fs');
var path = require('node:path');
var Readable = require('node:stream').Readable;

var MjpegConsumer = require('../lib/mjpeg-consumer');

var boundary = '--boundandrebound';
var IMG = fs.readFileSync(path.join(__dirname, 'img.jpg'));

var chunkHeaders = Buffer.from('Content-Type: image/jpeg\nContent-Length: ' + IMG.length + '\n\n');
var chunkBoundary = Buffer.from(boundary + '\n');

var soi = Buffer.from([0xff, 0xd8]);
var eoi = Buffer.from([0xff, 0xd9]);

/**
 * Serves an endless multipart stream, one frame every 50ms. Listens on an
 * ephemeral port so nothing collides with a port already in use.
 */
function startServer() {
  var run = true;

  var server = http.createServer(function(req, res) {
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary
    });

    (function writeFrame() {
      setTimeout(function() {
        if (!run || res.writableEnded) return;
        res.write(boundary + '\nContent-Type: image/jpeg\nContent-Length: ' + IMG.length + '\n\n');
        res.write(IMG);
        writeFrame();
      }, 50);
    })();

    res.on('close', function() {
      run = false;
    });
  });

  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() {
      resolve({
        port: server.address().port,
        stop: function() {
          run = false;
          server.closeAllConnections();
          return new Promise(function(done) { server.close(function() { done(); }); });
        }
      });
    });
  });
}

/** Resolves with the first `count` frames the consumer emits. */
function collect(consumer, count) {
  return new Promise(function(resolve, reject) {
    var frames = [];
    consumer.on('data', function(chunk) {
      frames.push(chunk);
      if (frames.length === count) resolve(frames);
    });
    consumer.on('error', reject);
  });
}

test('consumes an http mjpeg stream', async function() {
  var server = await startServer();
  var controller = new AbortController();
  var body = null;

  try {
    var res = await fetch('http://127.0.0.1:' + server.port, {
      signal: controller.signal
    });

    var consumer = new MjpegConsumer();
    var frames = collect(consumer, 3);

    body = Readable.fromWeb(res.body);
    // The stream is endless, so the test ends by aborting mid-response. That
    // surfaces on the body as an AbortError which nothing else will claim;
    // without this handler it escapes as an uncaught exception.
    body.on('error', function(err) {
      if (err.name !== 'AbortError') throw err;
    });
    body.pipe(consumer);

    // Three times. You know. For science.
    for (var frame of await frames) {
      assert.strictEqual(frame.length, IMG.length);
      assert.deepStrictEqual(frame, IMG);
    }
  } finally {
    controller.abort();
    if (body) body.destroy();
    await server.stop();
  }
});

test('constructs without new', function() {
  var consumer = MjpegConsumer();
  assert.ok(consumer instanceof MjpegConsumer);
});

test('reassembles a frame split across two writes', async function() {
  var consumer = new MjpegConsumer();
  var frames = collect(consumer, 1);

  var header = Buffer.from('Content-Length: ' + IMG.length + '\n\n');

  consumer.write(Buffer.concat([header, IMG.subarray(0, 500)]));
  consumer.end(IMG.subarray(500));

  var frame = (await frames)[0];
  assert.strictEqual(frame.length, IMG.length);
  assert.deepStrictEqual(frame, IMG);
});

test('emits a second frame when a write spans a boundary', async function() {
  var consumer = new MjpegConsumer();
  var frames = collect(consumer, 2);

  var header = Buffer.from('Content-Length: ' + IMG.length + '\n\n');
  var headerAndFirstHalf = Buffer.concat([header, IMG.subarray(0, 500)]);
  var secondHalf = IMG.subarray(500);

  consumer.write(headerAndFirstHalf);
  consumer.write(Buffer.concat([secondHalf, headerAndFirstHalf]));
  consumer.end(secondHalf);

  assert.deepStrictEqual((await frames)[1], IMG);
});

/**
 * The same frame delivered across every combination of write boundaries. All
 * four must produce one identical frame — where a chunk ends is an artifact of
 * the socket, not of the format.
 */
var splits = [
  ['one chunk', [[chunkBoundary, chunkHeaders, IMG]]],
  ['two chunks, split after the headers', [[chunkBoundary, chunkHeaders], [IMG]]],
  ['two chunks, split after the boundary', [[chunkBoundary], [chunkHeaders, IMG]]],
  ['three chunks', [[chunkBoundary], [chunkHeaders], [IMG]]]
];

splits.forEach(function(split) {
  var name = split[0];
  var writes = split[1];

  test('parses a frame delivered as ' + name, async function() {
    var consumer = new MjpegConsumer();
    var frames = collect(consumer, 1);

    writes.forEach(function(parts, i) {
      var buf = Buffer.concat(parts);
      if (i === writes.length - 1) consumer.end(buf);
      else consumer.write(buf);
    });

    var frame = (await frames)[0];
    assert.strictEqual(frame.length, IMG.length);
    assert.strictEqual(consumer.bytesWritten, IMG.length);
    assert.deepStrictEqual(frame, IMG);
  });
});

/** Resolves with the error the consumer fails with. */
function failure(consumer) {
  return new Promise(function(resolve) {
    consumer.on('error', resolve);
  });
}

test('rejects a frame larger than maxFrameBytes', async function() {
  var consumer = new MjpegConsumer();
  var failed = failure(consumer);

  // No allocation should be attempted for this at all.
  consumer.write(Buffer.from('Content-Length: 2000000000\n\n'));

  var err = await failed;
  assert.strictEqual(err.code, 'ERR_FRAME_TOO_LARGE');
  assert.match(err.message, /2000000000 bytes/);
  assert.strictEqual(consumer.buffer, null);
});

test('honours an explicit maxFrameBytes', async function() {
  // Below the size of the test fixture, so the limit is what rejects it.
  var consumer = new MjpegConsumer({ maxFrameBytes: 512 });
  var failed = failure(consumer);

  consumer.write(Buffer.concat([chunkBoundary, chunkHeaders, IMG]));

  var err = await failed;
  assert.strictEqual(err.code, 'ERR_FRAME_TOO_LARGE');
});

test('accepts a frame at exactly maxFrameBytes', async function() {
  var consumer = new MjpegConsumer({ maxFrameBytes: IMG.length });
  var frames = collect(consumer, 1);

  consumer.end(Buffer.concat([chunkBoundary, chunkHeaders, IMG]));

  assert.deepStrictEqual((await frames)[0], IMG);
});

/**
 * Compressed image data will eventually contain the bytes "Content-Length:" by
 * chance. Acting on such a match used to discard the frame in progress and
 * resize the buffer to whatever number followed.
 */
test('ignores a Content-Length that appears inside payload data', async function() {
  var lie = Buffer.from('Content-Length: 999999\n\n');
  var payload = Buffer.concat([
    soi,
    Buffer.alloc(600, 0x41),
    lie,
    Buffer.alloc(600, 0x41),
    eoi
  ]);
  var header = Buffer.from('Content-Length: ' + payload.length + '\n\n');

  var consumer = new MjpegConsumer();
  var frames = collect(consumer, 1);

  consumer.write(Buffer.concat([header, payload.subarray(0, 300)]));
  // The lie sits at offset 602, wholly inside this middle chunk, which is pure
  // payload -- the frame is not complete, so the old code resized here.
  consumer.write(payload.subarray(300, 700));
  consumer.end(payload.subarray(700));

  var frame = (await frames)[0];
  assert.strictEqual(frame.length, payload.length);
  assert.deepStrictEqual(frame, payload);
});

/**
 * Buffer.copy clamps a write that would overrun, but bytesWritten used to keep
 * counting, stepping straight past an exact-equality completion check. With no
 * end-of-image marker to fall back on, the stream simply stopped emitting.
 */
test('emits a frame whose payload overruns its declared length', async function() {
  var declared = 500;
  var header = Buffer.from('Content-Length: ' + declared + '\n\n');
  var body = Buffer.concat([soi, Buffer.alloc(declared - soi.length, 0x41)]);

  var consumer = new MjpegConsumer();
  var frames = collect(consumer, 1);

  consumer.write(Buffer.concat([header, body.subarray(0, 200)]));
  // 400 more bytes with only 300 of room left, and no end-of-image marker.
  consumer.end(Buffer.alloc(400, 0x41));

  var frame = (await frames)[0];
  assert.strictEqual(frame.length, declared);
  assert.strictEqual(consumer.bytesWritten, declared);
});
