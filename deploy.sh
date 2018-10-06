#!/bin/bash
set -euo pipefail

rsync -avz --delete --exclude=output ./ markneub@pasteur.cc:~/ffmpegserver