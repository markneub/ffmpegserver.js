/*
 * Copyright 2015, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *     * Redistributions of source code must retain the above copyright
 * notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above
 * copyright notice, this list of conditions and the following disclaimer
 * in the documentation and/or other materials provided with the
 * distribution.
 *     * Neither the name of Gregg Tavares. nor the names of its
 * contributors may be used to endorse or promote products derived from
 * this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF2 LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

"use strict";

var debug        = require('debug')('video-encoder');
var FFMpegRunner = require('../lib/ffmpeg-runner');
var fs           = require('fs');
var path         = require('path');
var Promise      = require('bluebird');
var utils        = require('../lib/utils');
var util         = require('util');

var encoders = [];

function cleanUpEncodersOnExit() {
  encoders.forEach(function(encoder, ndx) {
    console.log(ndx);
    encoder.cleanup();
  });
  encoders = [];
};

function cleanUpEncodersOnExitAndExit() {
  cleanUpEncodersOnExit();
  process.exit();
}

process.on('exit', cleanUpEncodersOnExit);
process.on('SIGINT', cleanUpEncodersOnExitAndExit);
process.on('uncaughtException', cleanUpEncodersOnExitAndExit);

/**
 * @constructor
 * @param {!Client} client The websocket
 * @param {string} id a unique id
 */
function VideoEncoder(client, server, id, options) {
  var self = this;
  var count = 0;
  var name;
  var frames = [];
  var sendCmd;
  var numWriting = 0;
  var numErrors = 0;
  var ended = false;
  var framerate = 30;
  var extension = ".mp4";
  var codec;
  var connected = true;
  var ffmpegArguments;
  var textoverlay = '';
  var videoLength = 0;

  debug("" + id + ": start encoder");

  function safeName(name) {
    return name.substr(0, 30).replace(/[^0-9a-zA-Z-.]/g, '_');
  }

  var handleStart = function(data) {
    debug("start: " + JSON.stringify(data, null, 2));
    if (name !== undefined) {
      return sendCmd("error", "video already in progress");
    }
    data = data || {};
    framerate = data.framerate || 30;
    extension = safeName(data.extension || ".mp4");
    codec = data.codec;
    if (options.allowArbitraryFfmpegArguments) {
      ffmpegArguments = data.ffmpegArguments;
    } else if (data.ffmpegArguments) {
      sendCmd("error", { msg: "ffmpegArguments not allowed without --allow-arbitrary-ffmpeg-argumments command line option" });
      return;
    }

// TODO: check it's not started
    count = 0;
    numErrors = 0;
    ended = false;
    name = safeName((data.name || "untitled") + "-" + id);
    frames = [];
    debug("start: " + name);
  };

  var cleanup = function() {
    if (frames.length) {
      if (!options.keepFrames) {
        console.log("deleting frames for: " + name);
        frames.forEach(utils.deleteNoFail.bind(utils));
        frames = [];
      }
    }
    // clean up additional intermediate files
    utils.deleteNoFail(path.join(options.videoDir, 'ts-' + name + '.txt')) // timestamps
    utils.deleteNoFail(path.join(options.videoDir, 'vfr-' + name + '.mp4')) // vfr video
    utils.deleteNoFail(path.join(options.videoDir, 'cfr-' + name + '.mp4')) // cfr video
    utils.deleteNoFail(path.join(options.videoDir, name + '.mp3')) // audio track
    utils.deleteNoFail(path.join(options.videoDir, name + '.mp4')) // initial rendered video
  };

  var handleFFMpegError = function(result) {
    debug("error running ffmpeg: " + JSON.stringify(result));
    sendCmd("error", { result: result });
    cleanup();
    name = undefined;
  };

  var handleFFMpegFrame = function(frameNum) {
    sendCmd("progress", {
      progress: frameNum / frames.length,
    });
  };

  var checkForEnd = function() {
    if (ended && numWriting === 0) {
      var videoname = path.join(options.videoDir, name + extension);
      var framesname = path.join(options.frameDir, name + "-%d.png");
      console.log("converting " + framesname + " to " + videoname);

      var args = [
        "-framerate", framerate,
        "-pattern_type", "sequence",
        "-start_number", "0",
        "-i", framesname,
        "-y",
      ];

      if (codec) {
        args.push("-c:v", codec);
      } else if (extension === ".mp4") {
        args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
      }

      if (Array.isArray(ffmpegArguments)) {
        args = args.concat(ffmpegArguments);
      }
      args.push(videoname)

      var runner = new FFMpegRunner(args);
      runner.on('error', handleFFMpegError);
      runner.on('frame', handleFFMpegFrame);
      runner.on('done', function(result) {
        console.log("converted " + frames.length + " frames to: " + videoname);
        createVfrVideo(videoname)
      });
    }

    function createVfrVideo(videoname) {
      console.log('Writing VFR video...')
      const { spawn } = require('child_process')
      const args = [
        '-o', path.join(options.frameDir, 'vfr-' + name + '.mp4'),
        '-t', path.join(options.frameDir, 'ts-' + name + '.txt'),
        videoname
      ]
      console.log('mp4fpsmod ' + args.join(' '))

      const mp4fpsmod = spawn('mp4fpsmod', args)

      mp4fpsmod.stdout.on('data', data => { console.log(`stdout: ${data}`) })
      mp4fpsmod.stderr.on('data', data => { console.log(`stderr: ${data}`) })
      mp4fpsmod.on('close', createCfrVideo)
    }

    function createCfrVideo() {
      console.log('Writing CFR video with audio...')
      const { spawn } = require('child_process')
      var args = [
        '-y',
        '-i', path.join(options.frameDir, 'vfr-' + name + '.mp4'),
        '-i', path.join(options.frameDir, name + '.mp3'),
        '-map', '0:v',
        '-map', '1:a',
        '-shortest',
        path.join(options.frameDir, 'cfr-' + name + '.mp4')
      ]
      console.log('ffmpeg ' + args.join(' '))

      const ffmpeg = spawn('ffmpeg', args)

      ffmpeg.stdout.on('data', data => { console.log(`stdout: ${data}`) })
      ffmpeg.stderr.on('data', data => { console.log(`stderr: ${data}`) })
      ffmpeg.on('close', createFinalVideo)
    }

    function createFinalVideo() {
      console.log('Writing text overlay to video...')

      let nearEndMap = {
        10000: 6,
        15000: 10,
        30000: 23
      }
      let nearEnd = nearEndMap[videoLength]
      // user defined text
      // - display start
      // - display end
      // - fade out duration
      // - fade in duration
      let DS = 0,
          DE = nearEnd,
          FOD = 0.25,
          FID = 0

      // pasteur tagline
      let DS2 = nearEnd,
          DE2 = 9999,
          FOD2 = 0,
          FID2 = 0.25

      // https://gist.github.com/enzinier/8d00d3f37d2e23985dcfa65662d163fa
      var linuxFontPath = require('os').homedir() + '/.local//share/fonts/adobe-fonts/source-code-pro/TTF/SourceCodePro-Semibold.ttf'
      var fontPath = fs.existsSync(linuxFontPath) ? linuxFontPath : path.resolve(__dirname, '../font/', 'SourceCodePro-SemiBold.ttf')

      var args = [
        '-y',
        '-i', path.join(options.frameDir, 'cfr-' + name + '.mp4'),
        '-filter_complex',
          // '"drawbox=x=0:',
          // 'y=ih-17:',
          // 'w=640:',
          // 'h=17:',
          // 'color=black:',
          // 't=100,', // covers for version incompatibility between ffmpeg 3 and 4 (max vs fill)

          '"pad=width=512:height=512:x=0:y=0:color=black,',

          'drawtext=fontfile=' + fontPath + ':',
          'text=\'' + textoverlay + '\':',
          'fontcolor=efebff:',
          'fontsize=14:',
          'x=(w-text_w)/2:',
          'y=(h-text_h)-4:',
          'ft_load_flags=default:',
          'fontcolor_expr=efebff%{eif\\\\\\\\: clip(255*(1*between(t\\\\, ' + (DS + FID) + '\\\\, ' + (DE - FOD) + ') + ((t - ' + DS + ')/(' + (FID + 0.00001) + '))*between(t\\\\, ' + DS + '\\\\, ' + (DS + FID) + ') + (-(t - ' + DE + ')/(' + (FOD + 0.00001) + '))*between(t\\\\, ' + (DE - FOD) + '\\\\, ' + DE + ') )\\\\, 0\\\\, 255) \\\\\\\\: x\\\\\\\\: 2 },',

          'drawtext=fontfile=' + fontPath + ':',
          'text=\'' + 'generated by @pasteur.cc / www.pasteur.cc' + '\':',
          'fontcolor=efebff:',
          'fontsize=14:',
          'x=(w-text_w)/2:',
          'y=(h-text_h)-2:',
          'ft_load_flags=default:',
          'fontcolor_expr=efebff%{eif\\\\\\\\: clip(255*(1*between(t\\\\, ' + (DS2 + FID2) + '\\\\, ' + (DE2 - FOD2) + ') + ((t - ' + DS2 + ')/(' + (FID2 + 0.00001) + '))*between(t\\\\, ' + DS2 + '\\\\, ' + (DS2 + FID2) + ') + (-(t - ' + DE2 + ')/(' + (FOD2 + 0.00001) + '))*between(t\\\\, ' + (DE2 - FOD2) + '\\\\, ' + DE2 + ') )\\\\, 0\\\\, 255) \\\\\\\\: x\\\\\\\\: 2 }"',
        '-codec:a', 'copy',
        path.join(options.frameDir, 'final-' + name + '.mp4')
      ]
      
      console.log('ffmpeg ' + args.join(' '))
      var runner = new FFMpegRunner(args);
      runner.on('error', handleFFMpegError);
      runner.on('frame', handleFFMpegFrame);
      runner.on('done', function(result) {
        server.addFile(path.join(options.frameDir, 'final-' + name + '.mp4'))
          .then(function(fileInfo) {
            sendCmd("end", fileInfo);
            cleanup();
          })
          .catch(function(e) {
            console.log("error adding file: " + path.join(options.frameDir, 'final-' + name + '.mp4'));
            throw e;
        })
      });
    }
  }

  var EXPECTED_HEADER = 'data:image/png;base64,';
  var handleFrame = function(data) {
    if (name === undefined) {
      return sendCmd("error", "video not started");
    }
    var dataURL = data.dataURL;
    if (dataURL.substr(0, EXPECTED_HEADER.length) !== EXPECTED_HEADER) {
      console.error("bad data URL");
      return;
    }
    var frameNum = count++;
    var filename = path.join(options.frameDir, name + "-" + frameNum + ".png");
    debug("write: " + filename);
    var image = dataURL.substr(EXPECTED_HEADER.length);
    ++numWriting;
    fs.writeFile(filename, image, 'base64', function(err) {
      --numWriting;
      if (err) {
        ++numErrors;
        console.error(err);
      } else {
        if (!connected) {
          utils.deleteNoFail(filename);
          return;
        }
        frames.push(filename);
        sendCmd("frame", { frameNum: frameNum })
        console.log('saved frame: ' + filename);
      }
      if (numWriting === 0) {
        checkForEnd();
      }
    });
  };

  var handleEnd = function(data) {
    if (name === undefined) {
      return sendCmd("error", "video not started");
    }
    ended = true;
    checkForEnd();
  };

  var handleTimestamps = function(data) {
    var filename = path.join(options.frameDir, "ts-" + name + ".txt");
    console.log("saving timestamp data to " + filename)
    fs.writeFile(filename, data, function(err) {
      if(err) {
          return console.log(err);
      }
      console.log(filename + " written successfully");
    });
  }

  var handleAudioFile = function(data) {
    // TODO uniquely identify audio file. determine correct type?
    var filename = path.join(options.frameDir, name + ".mp3");
    fs.writeFile(filename, data, {encoding: 'base64'}, function(err) {
        if(err) {
            return console.log(err);
        }
        console.log(filename + ' written successfully');
    });
  }

  var handleMeta = function(data) {
    textoverlay = data.textOverlay.toUpperCase()
    videoLength = data.videoLength
    console.log('Received metadata: text overlay: \'' + textoverlay + '\', video length: ' + videoLength)
  }

  var messageHandlers = {
    start: handleStart,
    frame: handleFrame,
    end: handleEnd,
    timestamps: handleTimestamps,
    audiofile: handleAudioFile,
    meta: handleMeta
  };

  var onMessage = function(message) {
    var cmd = message.cmd;
    var handler = messageHandlers[cmd];
    if (!handler) {
      console.error("unknown message: " + cmd);
      return;
    }

    handler(message.data);
  };

  /**
   * Disconnect this player. Drop their WebSocket connection.
   */
  var disconnect = function() {
    connected = false;
    var ndx = encoders.indexOf(self);
    encoders.splice(ndx, 1);
    cleanup();
    client.on('message', undefined);
    client.on('disconnect', undefined);
    client.on('error', undefined);
    try {
      client.close();
    } catch(e) {
    }
  };

  /**
   * Sends a message to the browser
   * @param {object} msg data to send.
   */
  var send = function(msg) {
    //debug("send:" + JSON.stringify(msg));
    //debug((new Error()).stack);
    try {
      client.send(msg);
    } catch (e) {
      console.error("error sending to client");
      console.error(e);
      console.error("disconnecting");
      disconnect();
    }
  };

  sendCmd = function(cmd, data) {
    send({cmd: cmd, data: data});
  };

  var onDisconnect = function() {
    debug("" + id + ": disconnected");
    disconnect();
  };

  var onError = function(e) {
    console.error(e);
    disconnect();
  };

  client.on('message', onMessage);
  client.on('disconnect', onDisconnect);
  client.on('error', onError);
  sendCmd("start", {});

  this.cleanup = cleanup;
  encoders.push(this);

};


module.exports = VideoEncoder;

