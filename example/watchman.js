var request = require("request");
var MjpegConsumer = require("../lib/mjpeg-consumer");
var FileOnWrite = require("file-on-write");

var writer = new FileOnWrite({ 
	path: './video',
	ext: '.jpg'
});
var consumer = new MjpegConsumer();

var username = "admin";
var password = "admin";
var options = {
    url: "http://192.168.1.1/videostream.cgi",
    headers: {
     'Authorization': 'Basic ' + new Buffer(username + ':' + password).toString('base64')
   }  
};

request(options).pipe(consumer).pipe(writer);