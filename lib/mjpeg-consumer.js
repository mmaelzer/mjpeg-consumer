require("buffertools");

var length = /Content-Length: \d+/;
var soi = new Buffer(2);
soi.writeUInt16LE(0xd8ff, 0);

var MjpegConsumer = function() {
    this.readable = true;
    this.writable = true;
    this.bytesWritten = 0;
    this.totalBytes = 0;
    this.buffer = null;
    this.initialized = false;
};

require('util').inherits(MjpegConsumer, require('stream'));

MjpegConsumer.prototype.write = function(chunk) {
    var len, start, initialBytes, remaining, soiIndex;

    if (chunk.length < this.totalBytes - this.bytesWritten) {         
        chunk.copy(this.buffer, this.bytesWritten, 0, chunk.length);
        this.bytesWritten += chunk.length;
        return;
    }

    if (this.initialized && this.bytesWritten < this.totalBytes) {
        remaining = this.totalBytes - this.bytesWritten
        chunk.copy(this.buffer, this.bytesWritten, 0, remaining);
        this.bytesWritten += remaining;
    }

    len = length.exec(chunk);
    if (len) {
        if (this.initialized) {
            this.emit('data', this.buffer);
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
};

MjpegConsumer.prototype.end = function(chunk) {
    this.writable = false;
};

MjpegConsumer.prototype.destroy = function() {
    this.writable = false;
};

module.exports = MjpegConsumer;