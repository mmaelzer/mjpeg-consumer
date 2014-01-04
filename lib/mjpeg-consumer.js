var util = require('util');
var Transform = require('stream').Transform;
require("buffertools");

var lengthExpression = /Content-Length:\s*\d+/i;
var soi = new Buffer(2);
soi.writeUInt16LE(0xd8ff, 0);

function MjpegConsumer(options) {
    if (!(this instanceof MjpegConsumer)) {
        return new MjpegConsumer(options);
    }

    Transform.call(this, options);

    this.bytesWritten = 0;
    this.totalBytes = 0;
    this.buffer = null;
    this.initialized = false;
}

util.inherits(MjpegConsumer, Transform);

MjpegConsumer.prototype._transform = function(chunk, encoding, done) {
    var len, start, initialBytes, remaining, soiIndex;

    if (chunk.length < this.totalBytes - this.bytesWritten) {
        chunk.copy(this.buffer, this.bytesWritten, 0, chunk.length);
        this.bytesWritten += chunk.length;
        done();
        return;
    }

    if (this.initialized && this.bytesWritten < this.totalBytes) {
        remaining = this.totalBytes - this.bytesWritten
        chunk.copy(this.buffer, this.bytesWritten, 0, remaining);
        this.bytesWritten += remaining;
    }

    len = lengthExpression.exec(chunk);
    if (len) {
        if (this.initialized) {
            this.push(this.buffer);
        } else {
            this.initialized = true;
        }
        this.bytesWritten = 0;
        this.totalBytes = Number(/\d+/.exec(len[0]));
        this.buffer = new Buffer(this.totalBytes);
    }

    start = chunk.indexOf(soi);
    if (start !== -1) {
        initialBytes = (chunk.length - start);
        chunk.copy(this.buffer, 0, start, chunk.length);
        this.bytesWritten += initialBytes;
    }

    done();
};

module.exports = MjpegConsumer;
