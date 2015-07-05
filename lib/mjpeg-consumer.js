var util = require('util');
var Transform = require('stream').Transform;
require("buffertools").extend();

var lengthExpression = /Content-Length:\s*\d+/i;

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

    this.bytesWritten = 0;
    this.totalBytes = 0;
    this.buffer = null;
    this.initialized = false;
    this.hasContentLength = false;
    this.eoiFound = false;
}

util.inherits(MjpegConsumer, Transform);

MjpegConsumer.prototype._transform = function(chunk, encoding, done) {
    var len, start, end, initialBytes, remaining, soiIndex;

    // If this chunk is smaller than the total bytes of the image minus the amount of bytes saved
    // copy it over and call done()
    if (this.hasContentLength && chunk.length < this.totalBytes - this.bytesWritten) {
        chunk.copy(this.buffer, this.bytesWritten, 0, chunk.length);
        this.bytesWritten += chunk.length;
        done();
        return;
    }

    // If this chunk contains the remainder of the image data, copy the remaining image data
    if (this.hasContentLength && this.initialized && this.bytesWritten < this.totalBytes) {
        remaining = this.totalBytes - this.bytesWritten;
        chunk.copy(this.buffer, this.bytesWritten, 0, remaining);
        this.bytesWritten += remaining;
    }

    // If we don't know the length of the image from the Content-Length header, check for 
    // the eoi marker on the jpeg
    if (this.initialized && !this.hasContentLength && !this.eoiFound) {
        end = chunk.indexOf(eoi);
        // If we're at the end of the image, copy over until we hit the eoi marker
        if (end !== -1) {
            this.concatImageBytes(chunk.slice(0, end + eoi.length));
            this.eoiFound = true;
        }
        // Otherwise, copy over all the chunk data and call `done()` 
        else {
            this.concatImageBytes(chunk);
            done();
            return;
        }
    }

    // Look for Content-Length HTTP header
    len = lengthExpression.exec(chunk);
    // Look for the start of a jpeg image
    start = chunk.indexOf(soi);

    // Did we find a jpeg start of image (soi)?
    if (start !== -1) {
        // If initialized, pass along the image to the next stream, otherwise initialize
        this.writeImage();
        // Determine whether we need to continually concat Buffers or can we allocate a Buffer once
        this.hasContentLength = Boolean(len);
        // If we have a Content-Length, set totalBytes to Content-Length value, otherwise
        // set totalBytes, provisionally to the current chunk length
        this.totalBytes = this.hasContentLength
                ? Number(/\d+/.exec(len[0])) 
                : (chunk.length - start);
        // Create  a new buffer based on this.totalBytes
        this.newImage();
        // Copy bytes from the chunk to this.buffer
        this.copyImageBytes(start, chunk);
    }

    done();
};

/**
 *  Either flag ourselves to be initialized or pass along our current image
 *  to the next stream.
 */
MjpegConsumer.prototype.writeImage = function() {
    if (this.initialized) {
        this.push(this.buffer);
    } else {
        this.initialized = true;
    }
};

/**
 *  Initializes a new `Buffer` object with a size of `this.totalBytes`
 */
MjpegConsumer.prototype.newImage = function() {
    this.bytesWritten = 0;
    this.eoiFound = false;
    this.buffer = new Buffer(this.totalBytes);
};

/**
 *  Copy the current data chunk to our internal buffer and update the
 *  `bytesWritten` to our new length
 *  @param {Number} start
 *  @param {Buffer} chunk
 */
MjpegConsumer.prototype.copyImageBytes = function(start, chunk) {
    var initialBytes = (chunk.length - start);
    chunk.copy(this.buffer, 0, start, chunk.length);
    this.bytesWritten += initialBytes;    
};

/**
 *  Concat the current data chunk with the internal buffer to create a new buffer
 *  that is then assigned to our internal buffer. This method is used when `Content-Length`
 *  is not provided in the HTTP header.
 *  @param {Buffer} chunk
 */
MjpegConsumer.prototype.concatImageBytes = function(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk], this.buffer.length + chunk.length);
};

module.exports = MjpegConsumer;
