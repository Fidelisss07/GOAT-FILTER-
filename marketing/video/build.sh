#!/usr/bin/env bash
# Gera out/goat-filter-tiktok.mp4 (1080x1920, 30 fps, com som).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
python3 audio.py out/audio.wav
node render.cjs
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i out/frames/%05d.jpg -i out/audio.wav \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 192k -movflags +faststart -shortest out/goat-filter-tiktok.mp4
ls -la out/goat-filter-tiktok.mp4
