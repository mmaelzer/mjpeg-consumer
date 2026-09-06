var util = require('util');
var Transform = require('stream').Transform;

var lengthRegex = /Content-Length:\s*(\d+)/i;

// Start of Image
var soi = Buffer.from([0xff, 0xd8]);

// End of Image
var eoi = Buffer.from([0xff, 0xd9]);

/**
 * Ceiling on a single frame's declared Content-Length.
 *
 * The length is supplied by whatever is on the other end of the socket, and it
 * is used directly to size an allocation. Without a ceiling, a camera that has
 * been tampered with -- or anything able to sit in the middle of what is almost
 * always a plaintext HTTP stream on a LAN -- can announce a two gigabyte frame
 * and take the process down with one header.
 *
 * 16 MiB is several times the largest frame any real camera produces: a 4K JPEG
 * at high quality lands around 1.5-3 MB, and even 8K stays well under this. Set
 * `maxFrameBytes` explicitly if you have hardware that disagrees, or Infinity to
 * restore the old unbounded behaviour.
 */
var DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;

function MjpegConsumer(options) {
  if (!(this instanceof MjpegConsumer)) {
      return new MjpegConsumer(options);
  }

  Transform.call(this, options);

  var opts = options || {};

  this.maxFrameBytes = opts.maxFrameBytes === undefined
    ? DEFAULT_MAX_FRAME_BYTES
    : opts.maxFrameBytes;

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

    // Never take more than the frame was declared to hold. Buffer.copy clamps
    // the write silently, so without this the byte count would run past
    // contentLength and the completion check below could never be reached.
    bufEnd = Math.min(bufEnd, start + len);

    chunk.copy(this.buffer, 0, start, bufEnd);

    this.bytesWritten = bufEnd - start;
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

  // As in _initFrame: clamp to the room left in the frame rather than letting
  // Buffer.copy drop the overflow on the floor while bytesWritten keeps going.
  bufEnd = Math.min(bufEnd, bufStart + (this.contentLength - this.bytesWritten));

  chunk.copy(this.buffer, this.bytesWritten, bufStart, bufEnd);

  this.bytesWritten += bufEnd - bufStart;

  // >= rather than ===: a payload that overruns its declared length used to
  // step straight past an exact-equality check and stall the stream until an
  // end-of-image marker happened along.
  if (end > -1 || this.bytesWritten >= this.contentLength) {
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

/**
 * @param {Buffer} chunk - chunk of http goodness
 * @param {Number} start - index of start of jpeg in chunk, or -1
 * @return {String} the region of the chunk that may contain part headers
 *
 * A chunk is part headers followed by part payload. Searching the payload for
 * a Content-Length is not just wasted work -- compressed image data will
 * eventually contain those bytes by chance, and acting on the match discards
 * whatever frame was in progress. So the search is confined to the bytes that
 * cannot be payload: after whatever remains of the current frame, and before
 * the next start-of-image marker.
 */
MjpegConsumer.prototype._headerRegion = function(chunk, start) {
  var from = this.reading
    ? Math.max(0, this.contentLength - this.bytesWritten)
    : 0;
  var to = start > -1 ? start : chunk.length;

  if (from >= to) return '';

  // latin1 rather than ascii: ascii masks off the high bit, which can turn
  // arbitrary binary into the very characters being searched for.
  return chunk.toString('latin1', from, to);
};

MjpegConsumer.prototype._transform = function(chunk, encoding, done) {
  var start = chunk.indexOf(soi);
  var end = chunk.indexOf(eoi);
  var len = (lengthRegex.exec(this._headerRegion(chunk, start)) || [])[1];

  if (this.buffer && (this.reading || start > -1)) {
    this._readFrame(chunk, start, end);
  }

  if (len) {
    var size = +len;

    if (size > this.maxFrameBytes) {
      var err = new Error(
        'mjpeg frame declares ' + size + ' bytes, above the ' +
        this.maxFrameBytes + ' byte maxFrameBytes limit'
      );
      err.code = 'ERR_FRAME_TOO_LARGE';
      return done(err);
    }

    this._initFrame(size, chunk, start, end);
  }

  done();
};

module.exports = MjpegConsumer;
