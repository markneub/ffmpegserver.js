#!/bin/bash
set -euo pipefail

rsync -avz --delete ./ markneub@pasteur.cc:~/ffmpegserver