#!/usr/bin/env bash
# Compila um FFmpeg mínimo para Windows (x86_64, mingw) só com o que o gravador usa:
# captura da área de trabalho pela GPU (ddagrab/D3D11), codificadores de vídeo da placa
# (NVIDIA NVENC, AMD AMF, Media Foundation para Intel e o resto), AAC e MP4.
# Sem x264 e sem bibliotecas GPL: o binário fica LGPL e com poucos MB.
#
# Uso: scripts/build-ffmpeg.sh <pasta-de-trabalho> <saida/ffmpeg.exe>
set -euo pipefail
WORK="$1"
OUT="$(realpath -m "$2")"
FFMPEG_TAG="n8.0.1"
NV_TAG="n13.0.19.0"
AMF_TAG="v1.4.36"

mkdir -p "$WORK"
cd "$WORK"
[ -d ffmpeg ] || git clone -q --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git ffmpeg
[ -d nv ] || git clone -q --depth 1 --branch "$NV_TAG" https://github.com/FFmpeg/nv-codec-headers.git nv
if [ ! -d amf ]; then
  git clone -q --depth 1 --branch "$AMF_TAG" --filter=blob:none --sparse https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git amf
  (cd amf && git sparse-checkout set amf/public/include)
fi

PREFIX="$WORK/prefix"
mkdir -p "$PREFIX/include/AMF"
make -C nv PREFIX="$PREFIX" install
cp -r amf/amf/public/include/* "$PREFIX/include/AMF/"

cd ffmpeg
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$PREFIX" \
  --arch=x86_64 --target-os=mingw32 --cross-prefix=x86_64-w64-mingw32- \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include -O2" --extra-ldflags="-static -static-libgcc" \
  --disable-everything --disable-autodetect --disable-debug --disable-doc \
  --disable-ffplay --disable-ffprobe --disable-network \
  --enable-small --enable-d3d11va --enable-ffnvcodec --enable-nvenc --enable-amf --enable-mediafoundation \
  --enable-w32threads \
  --enable-indev=lavfi --enable-indev=dshow \
  --enable-filter=ddagrab,hwdownload,hwupload,hwmap,format,scale,scale_d3d11,fps,null,color,testsrc2,crop \
  --enable-filter=aresample,amix,anull,aformat,anullsrc,volume,apad,trim,atrim,setpts,asetpts,split,asplit \
  --enable-encoder=h264_nvenc,hevc_nvenc,h264_amf,hevc_amf,h264_mf,hevc_mf,aac,rawvideo,pcm_s16le,mjpeg \
  --enable-decoder=wrapped_avframe,pcm_u8,pcm_f32le,pcm_f64le,pcm_s16le,pcm_s32le,rawvideo,h264,aac \
  --enable-parser=h264,hevc,aac \
  --enable-demuxer=pcm_f32le,pcm_s16le,concat,mpegts,mov,wav \
  --enable-muxer=segment,mpegts,mp4,mov,null,wav,image2 \
  --enable-bsf=dump_extradata,aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata \
  --enable-protocol=file,pipe,concat
make -j"$(nproc)"
mkdir -p "$(dirname "$OUT")"
x86_64-w64-mingw32-strip -o "$OUT" ffmpeg.exe
ls -la "$OUT"
