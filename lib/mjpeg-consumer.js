require("buffertools");

var length = /Content-Length: \d+\s*/;

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
    var len = length.exec(chunk);
    var start, initialBytes, remaining;

    if (chunk.length < this.totalBytes - this.bytesWritten) {         
        chunk.copy(this.buffer, this.bytesWritten, 0, chunk.length);
        this.bytesWritten += chunk.length;
    } else if (this.initialized && this.bytesWritten < this.totalBytes) {
        remaining = this.totalBytes - this.bytesWritten
        chunk.copy(this.buffer, this.bytesWritten, 0, remaining);
        this.bytesWritten += remaining;
    }

    if (len) {
        if (this.initialized) {
            this.emit('data', this.buffer);
        } else {
            this.initialized = true;
        }
        this.bytesWritten = 0;
        this.totalBytes = Number(/\d+/.exec(len[0]));
        this.buffer = new Buffer(this.totalBytes);  
        start = chunk.indexOf("Content-Length");
        initialBytes = (chunk.length - (start + len[0].length));    
        chunk.copy(this.buffer, 0, start + len[0].length, chunk.length);
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