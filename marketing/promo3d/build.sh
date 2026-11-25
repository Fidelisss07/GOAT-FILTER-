#!/usr/bin/env bash
# Gera out/goat-filter-3d.mp4 (1080x1920, 30 fps, com trilha). Com narração: ./build.sh out/narracao.wav
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
python3 audio.py out/audio.wav
[ -d out/frames ] && [ "$(ls out/frames | wc -l)" -ge 750 ] || node render.cjs
if [ "${1:-}" != "" ]; then
  # Música abaixa sozinha quando a voz fala (sidechain).
  ffmpeg -hide_banner -loglevel error -y -i out/audio.wav -i "$1" -filter_complex \
    "[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=1.6,apad[vo];[vo]asplit[vo1][vo2];[0:a][vo1]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[bed];[bed][vo2]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" \
    -map "[a]" out/mix.wav
  AUDIO=out/mix.wav
else
  AUDIO=out/audio.wav
fi
ffmpeg -hide_banner -loglevel error -y -framerate 30 -i out/frames/%05d.jpg -i "$AUDIO" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 192k -movflags +faststart -shortest out/goat-filter-3d.mp4
ls -la out/goat-filter-3d.mp4
