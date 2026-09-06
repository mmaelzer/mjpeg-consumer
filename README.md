mjpeg-consumer
==================
  
A node.js transform stream implementation that consumes http multipart mjpeg streams and emits jpegs.

[![build status](https://github.com/mmaelzer/mjpeg-consumer/actions/workflows/test.yml/badge.svg)](https://github.com/mmaelzer/mjpeg-consumer/actions/workflows/test.yml)

  
### Install

```bash
npm install mjpeg-consumer
```
  
----------------------  
### Usage
The `mjpeg-consumer` isn't very useful without a writable pipe to pipe jpegs to. I've built the [file-on-write](https://github.com/mmaelzer/file-on-write) stream to write a file every time `write` is called on it. The below example opens a stream to an IP camera, pipes the results to the `mjpeg-consumer` which processes the stream and emits parsed jpegs to the `file-on-write` writer.

```javascript
var { Readable } = require("node:stream");
var MjpegConsumer = require("mjpeg-consumer");
var FileOnWrite = require("file-on-write");

var writer = new FileOnWrite({
  path: './video',
  ext: '.jpg'
});
var consumer = new MjpegConsumer();

fetch("http://mjpeg.sanford.io/count.mjpeg").then(function(res) {
  Readable.fromWeb(res.body).pipe(consumer).pipe(writer);
});
```

Requires Node 18 or newer.
