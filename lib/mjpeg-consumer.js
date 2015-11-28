var util = require('util');
var Transform = require('stream').Transform;
require("buffertools").extend();

var lengthRegex = /Content-Length:\s*(\d+)/i;

// Start of Image
var soi = new Buffer(2);
soi.writeUInt16LE(0xd8ff, 0);

// End of Image
var eoi = new Buffer(2);
eoi.writeUInt16LE(0xd9ff, 0);

function MjpegConsumer(options) {
  if (!(this instanceof MjpegConsumer)) {
      return new MjpegConsumer(options);
  }

  Transform.call(this, options);

  this.buffer = null;

  // state flags
  this.reading = false;
  this.contentLength = null;
  this.bytesWritten = 0;
}
util.inherits(MjpegConsumer, Transform);

/**
 * @param {Number} len - length to initialize buffer
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number=} start - optional index of start of jpeg chunk
 * @param {Number=} end - optional index of end of jpeg chunk
 *
 * Initialize a new buffer and reset state
 */
MjpegConsumer.prototype._initFrame = function(len, chunk, start, end) {
  this.contentLength = len;
  this.buffer = new Buffer(len);
  // Fill the buffer so we don't leak random bytes
  // more info: https://nodejs.org/api/buffer.html#buffer_new_buffer_size
  this.buffer.fill(0);
  this.bytesWritten = 0;

  if (typeof start !== 'undefined' && start > -1) {
    var bufEnd = chunk.length;
    if (typeof end !== 'undefined' && end > -1) {
      bufEnd = end;
    }
    chunk.copy(this.buffer, 0, start, bufEnd);
    this.bytesWritten = chunk.length - start;
    this.reading = true;
  }
};

/**
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number} start - index of start of jpeg in chunk
 * @param {Number} end - index of end of jpeg in chunk
 *
 */
MjpegConsumer.prototype._readFrame = function(chunk, start, end) {
  var bufStart = start > -1 ? start : 0;
  var bufEnd = end > -1 ? end : chunk.length;

  chunk.copy(this.buffer, this.bytesWritten, bufStart, bufEnd);

  this.bytesWritten += bufEnd - bufStart;

  if (end > -1 || this.bytesWritten === this.contentLength) {
    this.reading = false;
    this.push(this.buffer);
  } else {
    this.reading = true;
  }
};

MjpegConsumer.prototype._transform = function(chunk, encoding, done) {
  var start = chunk.indexOf(soi);
  var end = chunk.indexOf(eoi);
  var len = (lengthRegex.exec(chunk) || [])[1];

  if (this.buffer && (this.reading || start > -1)) {
    this._readFrame(chunk, start, end);
  }

  if (len) {
    this._initFrame(+len, chunk, start);
  }

  done();
};

module.exports = MjpegConsumer;
