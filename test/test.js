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
