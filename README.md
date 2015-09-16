﻿# ffmpegserver.js

[![Build Status](https://travis-ci.org/greggman/ffmpegserver.js.svg?branch=master)](https://travis-ci.org/greggman/ffmpegserver.js)

This is a simple node server and library that sends canvas frames to the server and uses ffmpeg to compress the video.
It can be used standalone or with CCapture.js [CCapture.js](https://github.com/spite/ccapture.js).

## Setup

1.  [Install nodejs](http://nodejs.org/download)
2.  clone this repo or download and unzip the zip
3.  cd to the repo and type `npm install`
4.  type `node start.js`

The server is now running.

To see it in work, go to "http://localhost:8080/test". You should see 20 frames rendered, then a link will
be provided to download the video. Or you can get the video in the `output` folder.

## Use it in your own code

In whatever JavaScript program you want to capture from

<script src="http://localhost:8080/ffmpegserver/ffmpegserver.min..js"></script>
<script src="http://localhost:8080/3rdparty/CCapture.min.js"></script>

To create a CCapture object, write:

```js
var capturer = new CCapture( { format: 'ffmpegserver' } );
```

This creates a CCapture object to run at 60fps, non-verbose.
You can tweak the object by setting parameters on the constructor:

```js
var capturer = new CCapture( {
    framerate: 60,
    verbose: true,
    name: "foobar",     // videos will be named foobar-#.mp4, untitled if not set.
    extension: ".mp4",  // extension for file. default = ".mp4"
    codec: "mpeg4",     // this is an valid ffmpeg codec "mpeg4", "libx264", "flv1", etc...
                        // if not set ffmpeg guesses based on extension.
} );
```

You can decide when to start the capturer. When you call the .start() method,
the hooks are set, so from that point on requestAnimationFrame and other methods
that are hooked will behave a bit differently. When you have everything ready to start capturing, call:

```js
capturer.start();
```

And then, in your render() method, after the frame is been drawn, call .capture() passing the canvas you want to capture.

```js
function render(){
  // rendering stuff ...
  capturer.capture( canvas );
}

requestAnimationFrame(render);
```

That's all. Once you're done with the animation, you can call .stop and then .save().
That will compose the video and return a URL that can be previewed or downloaded.

```js
capturer.stop();
capturer.save( function( url, size ) { /* ... */ } );
```

You can also choose to receive progress notifications while the video is processing

```js
var capturer = new CCapture( {
   onProgress: progressFunc,
} );

function progressFunc(progress) {
  console.log(progress);  // 0.0 to 1.0
}
```

## Setting where to capture to

By default all files are saved to the `"output"` folder of where you installed ffmpegserver.
To choose a different folder you can use the options `--frame-dir` and `--video-dir`
as in

    node start.js --frame-dir=/tmp --video-dir=~/videos

The frames are deleted after the video is created default. Top stop frames
from being deleted use

    --keep-frames

## Serving your files

You have 2 options to serve your files

1.  Server them from somewhere else.

    Maybe you have your files on `mysite.com`. As long as the 2 scripts
    above are included from localhost like this

        <script src="http://localhost:8080/CCapture.min.js"></script>
        <script src="http://localhost:8080/ffmpegserver/ffmpegserver.js"></script>

    It should work.

    You might want to you to check for the existence of CCapture.min.js
    For example:

        if (CCapture) {
          // setup CCapture
        }

    That way your app will run even if CCapture is not available

2.  Let ffmpegserver serve your files

    just tell it where the files are by running it like this

        node start.js --base-dir=path/to/files


## To Do

1.  Allow you to pass more options to ffmpeg

    especially quality settings.

2.  Support giant images.

    For example, if you want to render at 10000x10000 resolution you can do that
    using the `camera.setViewOffset` feature of Three.js. You render smaller
    portions of the 10000x10000 image, say 1000x1000 at a time. Send them
    to the server and then have it assemble them. This is a great way to create
    posters or high-res video.

## License

MIT


