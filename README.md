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

----------------------
### Options

`MjpegConsumer` is a Transform stream and accepts all the usual stream options, plus:

#### `maxFrameBytes`

The largest frame this stream will accept, in bytes. Default `16777216` (16 MiB).

Each part in an mjpeg stream announces its own size in a `Content-Length` header, and that number is used directly to size an allocation. A camera that has been tampered with — or anything able to sit in the middle of what is usually a plaintext HTTP stream on a LAN — can announce a two gigabyte frame and take the process down with a single header. Frames above the limit are rejected with an `ERR_FRAME_TOO_LARGE` error rather than allocated.

The default is several times larger than any real camera produces; a 4K JPEG at high quality lands around 1.5–3 MB. Raise it if your hardware disagrees:

```javascript
var consumer = new MjpegConsumer({ maxFrameBytes: 64 * 1024 * 1024 });

consumer.on('error', function(err) {
  if (err.code === 'ERR_FRAME_TOO_LARGE') {
    console.error(err.message);
  }
});
```

Pass `Infinity` to restore the unbounded behaviour of 2.0.0 and earlier.
