mjpeg-consumer
==================
  
A node.js transform stream implementation that consumes http multipart mjpeg streams and emits jpegs.

[![build status](https://secure.travis-ci.org/mmaelzer/mjpeg-consumer.png)](http://travis-ci.org/mmaelzer/mjpeg-consumer)
[![Coverage Status](https://coveralls.io/repos/mmaelzer/mjpeg-consumer/badge.svg?branch=master&service=github)](https://coveralls.io/github/mmaelzer/mjpeg-consumer?branch=master)

  
### Install

```bash
npm install mjpeg-consumer
```
  
----------------------  
### Usage
The `mjpeg-consumer` isn't very useful without a writable pipe to pipe jpegs to. I've built the [file-on-write](https://github.com/mmaelzer/file-on-write) stream to write a file every time `write` is called on it. The below example opens a stream to an IP camera, pipes the results to the `mjpeg-consumer` which processes the stream and emits parsed jpegs to the `file-on-write` writer.

```javascript
var request = require("request");
var MjpegConsumer = require("mjpeg-consumer");
var FileOnWrite = require("file-on-write");

var writer = new FileOnWrite({ 
	path: './video',
	ext: '.jpg'
});
var consumer = new MjpegConsumer();

request("http://mjpeg.sanford.io/count.mjpeg").pipe(consumer).pipe(writer);
```
