#!/bin/bash
set -euo pipefail

rsync -avz --delete --exclude=output ./ markneub@markneuburger.com:/var/www/pasteur/ffmpegserver/
