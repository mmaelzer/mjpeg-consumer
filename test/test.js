var MjpegConsumer = (function(coverage) {
  return coverage
    ? require('../lib/mjpeg-consumer-cov')
    : require('../lib/mjpeg-consumer');
})(process.env.USE_COVERAGE);

var http = require('http');
var fs = require('fs');
var request = require('request');

var boundary = '--boundandrebound';
var IMG = fs.readFileSync(__dirname + '/img.jpg');
var Writable = require('stream').Writable;

function startServer(port) {
  var run = true;
  var server = http.createServer(function(req, res) {
    res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary});

    (function writeFrame() {
      setTimeout(function() {
        res.write(boundary + '\nContent-Type: image/jpeg\nContent-Length: '+ IMG.length + '\n\n');
        res.write(IMG);

        if (run) writeFrame();
      }, 500);
    })();

    res.on('close', function() {
      run = false;
    });

  });
  server.listen(port);
  return {
    server: server,
    stop: function() {
      server.close();
      run = false;
    }
  };
}

module.exports.testConsumer = function(t) {
  var port = 1234;
  var server = startServer(port);

  var consumer = new MjpegConsumer();
  var req = request('http://127.0.0.1:' + port);

  var ws = new Writable();
  var iterations = 0;
  ws._write = function (chunk, enc, next) {
    t.equal(chunk.length, IMG.length);
    t.deepEqual(chunk, IMG);
    // Do this 3 times before stopping.
    // You know. For science.
    if (iterations++ === 2) {
      req.abort();
      server.stop();
      t.done();
    }
    next();
  };
  req.pipe(consumer).pipe(ws);
};

module.exports.testConstructor = function(t) {
  var consumer = MjpegConsumer();
  t.ok(consumer instanceof MjpegConsumer);
  t.done();
};

module.exports.testInitFrame = function(t) {
  var consumer = new MjpegConsumer();
  var buf = Buffer.from("Content-Length: " + IMG.length + "\n\n");
  var fhalfImg = Buffer.alloc(500);
  var shalfImg = Buffer.alloc(IMG.length - 500);

  IMG.copy(fhalfImg, 0, 0, fhalfImg.length);
  IMG.copy(shalfImg, 0, 500);

  var img = Buffer.concat([buf, fhalfImg]);

  consumer.once('data', function(chunk) {
    t.equal(chunk.length, IMG.length);
    t.deepEqual(chunk, IMG);
    t.done();
  });

  consumer.write(img);
  consumer.end(shalfImg);
};


module.exports.testSplitImage = function(t) {
  var consumer = new MjpegConsumer();
  var buf = Buffer.from("Content-Length: " + IMG.length + "\n\n");
  var fhalfImg = Buffer.alloc(500);
  var shalfImg = Buffer.alloc(IMG.length - 500);

  IMG.copy(fhalfImg, 0, 0, fhalfImg.length);
  IMG.copy(shalfImg, 0, 500);

  var img = Buffer.concat([buf, fhalfImg]);
  var imgCount = 0;
  consumer.on('data', function(chunk) {
    if (++imgCount === 2) {
      t.deepEqual(chunk, IMG);
      t.done();
    }
  });
  consumer.write(img);
  consumer.write(Buffer.concat([shalfImg, img]));
  consumer.end(shalfImg);
};

var chunkHeaders = Buffer.from('Content-Type: image/jpeg\nContent-Length: '+ IMG.length + '\n\n');
var chunkBoundary = Buffer.from(boundary + '\n');

function getTestConsumer(t) {
  var consumer = new MjpegConsumer();
  consumer.once('data', function (chunk) {
    t.equal(chunk.length, IMG.length);
    t.equal(this.bytesWritten, IMG.length);
    t.deepEqual(chunk, IMG);
    t.done();
  });
  return consumer;
}

module.exports.testOneChunk = function(t) {
  var consumer = getTestConsumer(t);

  var all = Buffer.concat([chunkBoundary, chunkHeaders, IMG]);
  consumer.end(all);
};

module.exports.testTwoChunksFirst = function(t) {
  var consumer = getTestConsumer(t);

  var boundaryAndHeaders = Buffer.concat([chunkBoundary, chunkHeaders]);
  consumer.write(boundaryAndHeaders);
  consumer.end(IMG);
};

module.exports.testTwoChunksSecond = function(t) {
  var consumer = getTestConsumer(t);

  var headersAndImage = Buffer.concat([chunkHeaders, IMG]);
  consumer.write(chunkBoundary);
  consumer.end(headersAndImage);
};

module.exports.testThreeChunks = function(t) {
  var consumer = getTestConsumer(t);

  consumer.write(chunkBoundary);
  consumer.write(chunkHeaders);
  consumer.end(IMG);
};

module.exports.testOldBuffer = function(t) {
  var consumer = getTestConsumer(t);
  consumer.oldBufferType = true;
  consumer.write(chunkBoundary);
  consumer.write(chunkHeaders);
  consumer.end(IMG);
};

module.exports.testNewBuffer = function(t) {
  var consumer = getTestConsumer(t);
  consumer.oldBufferType = false;
  consumer.write(chunkBoundary);
  consumer.write(chunkHeaders);
  consumer.end(IMG);
};
