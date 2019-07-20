var util = require('util');
var Transform = require('stream').Transform;

var lengthRegex = /Content-Length:\s*(\d+)/i;

// Start of Image
var soi = Buffer.from([0xff, 0xd8]);

// End of Image
var eoi = Buffer.from([0xff, 0xd9]);

function MjpegConsumer(options) {
  if (!(this instanceof MjpegConsumer)) {
      return new MjpegConsumer(options);
  }

  Transform.call(this, options);

  this.buffer = null;

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
  this.buffer = Buffer.alloc(len);
  this.bytesWritten = 0;

  var hasStart = typeof start !== 'undefined' && start > -1;
  var hasEnd = typeof end !== 'undefined' && end > -1 && end > start;

  if (hasStart) {
    var bufEnd = chunk.length;

    if (hasEnd) {
      bufEnd = end + eoi.length;
    }

    chunk.copy(this.buffer, 0, start, bufEnd);

    this.bytesWritten = chunk.length - start;
    // If we have the eoi bytes, send the frame
    if (hasEnd) {
      this._sendFrame();
    } else {
      this.reading = true;
    }
  }
};

/**
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number} start - index of start of jpeg in chunk
 * @param {Number} end - index of end of jpeg in chunk
 *
 */
MjpegConsumer.prototype._readFrame = function(chunk, start, end) {
  var bufStart = start > -1 && start < end ? start : 0;
  var bufEnd = end > -1 ? end + eoi.length : chunk.length;

  chunk.copy(this.buffer, this.bytesWritten, bufStart, bufEnd);

  this.bytesWritten += bufEnd - bufStart;

  if (end > -1 || this.bytesWritten === this.contentLength) {
    this._sendFrame();
  } else {
    this.reading = true;
  }
};

/**
 * Handle sending the frame to the next stream and resetting state
 */
MjpegConsumer.prototype._sendFrame = function() {
  this.reading = false;
  this.push(this.buffer);
};

MjpegConsumer.prototype._transform = function(chunk, encoding, done) {
  var start = chunk.indexOf(soi);
  var end = chunk.indexOf(eoi);
  var len = (lengthRegex.exec(chunk.toString('ascii')) || [])[1];

  if (this.buffer && (this.reading || start > -1)) {
    this._readFrame(chunk, start, end);
  }

  if (len) {
    this._initFrame(+len, chunk, start, end);
  }

  done();
};

module.exports = MjpegConsumer;
