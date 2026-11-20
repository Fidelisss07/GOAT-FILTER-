#!/usr/bin/env bash
# Compila um FFmpeg mínimo para Windows (x86_64, mingw) só com o que o gravador usa:
# captura da área de trabalho pela GPU (ddagrab/D3D11), codificadores de vídeo da placa
# (NVIDIA NVENC, AMD AMF, Media Foundation para Intel e o resto), AAC e MP4.
# Captura: gfxcapture (Windows Graphics Capture, como o OBS; parte em C++) e ddagrab de reserva.
# Sem x264 e sem bibliotecas GPL: o binário fica LGPL e com poucos MB.
#
# Uso: scripts/build-ffmpeg.sh <pasta-de-trabalho> <saida/ffmpeg.exe>
set -euo pipefail
WORK="$1"
OUT="$(realpath -m "$2")"
FFMPEG_TAG="n8.1.3"
NV_TAG="n13.0.19.0"
AMF_TAG="v1.4.36"
# Compilador: llvm-mingw (clang + cabeçalhos do mingw-w64 novos). O gfxcapture
# precisa de cabeçalhos WinRT que o mingw-w64 do Ubuntu 24.04 ainda não tem.
LLVM_MINGW="20261104"

mkdir -p "$WORK"
cd "$WORK"
if [ ! -d llvm-mingw ]; then
  curl -fsSL --retry 5 -o lm.tar.xz \
    "https://github.com/mstorsjo/llvm-mingw/releases/download/$LLVM_MINGW/llvm-mingw-$LLVM_MINGW-ucrt-ubuntu-22.04-x86_64.tar.xz"
  sha256sum lm.tar.xz
  mkdir llvm-mingw && tar -xJf lm.tar.xz -C llvm-mingw --strip-components=1 && rm lm.tar.xz
fi
export PATH="$WORK/llvm-mingw/bin:$PATH"
x86_64-w64-mingw32-clang --version | head -1
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
# Goat Filter: o ddagrab espera entre quadros com Sleep(), que no Windows tem
# precisão de ~15,6 ms por padrão. A 60 fps (16,7 ms) os quadros saem em
# intervalos irregulares e o vídeo "engasga". Pede relógio de 1 ms e tira o
# processo (sem janela) da economia de energia do Windows 11.
if ! grep -q goat_timer_fix fftools/ffmpeg.c; then
  perl -0pi -e 's/int main\(int argc, char \*\*argv\)\n\{/#ifdef _WIN32
static void goat_timer_fix(void)
{
    typedef UINT (WINAPI *TBP)(UINT);
    typedef BOOL (WINAPI *SPI)(HANDLE, int, LPVOID, DWORD);
    struct { ULONG Version, ControlMask, StateMask; } pt = { 1, 0x1 | 0x4, 0 };
    HMODULE k = GetModuleHandleA("kernel32.dll");
    SPI spi = k ? (SPI)(void *)GetProcAddress(k, "SetProcessInformation") : NULL;
    HMODULE w = LoadLibraryA("winmm.dll");
    TBP tbp = w ? (TBP)(void *)GetProcAddress(w, "timeBeginPeriod") : NULL;
    if (spi)
        spi(GetCurrentProcess(), 4, &pt, sizeof(pt));
    if (tbp)
        tbp(1);
}
#endif

int main(int argc, char **argv)
{/' fftools/ffmpeg.c
  perl -0pi -e 's/\n    init_dynload\(\);/\n#ifdef _WIN32\n    goat_timer_fix();\n#endif\n    init_dynload();/' fftools/ffmpeg.c
  [ "$(grep -c goat_timer_fix fftools/ffmpeg.c)" = 2 ] || { echo "patch do relógio falhou"; exit 1; }
fi
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$PREFIX" \
  --arch=x86_64 --target-os=mingw32 --cross-prefix=x86_64-w64-mingw32- \
  --cc=x86_64-w64-mingw32-clang --cxx=x86_64-w64-mingw32-clang++ \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include -O2" --extra-ldflags="-static" \
  --disable-everything --disable-autodetect --disable-debug --disable-doc \
  --disable-ffplay --disable-ffprobe --disable-network \
  --enable-small --enable-d3d11va --enable-ffnvcodec --enable-nvenc --enable-amf --enable-mediafoundation \
  --enable-w32threads \
  --enable-indev=lavfi --enable-indev=dshow \
  --enable-filter=gfxcapture,ddagrab,hwdownload,hwupload,hwmap,format,scale,scale_d3d11,fps,null,color,testsrc2,crop \
  --enable-filter=aresample,amix,anull,aformat,anullsrc,volume,apad,trim,atrim,setpts,asetpts,split,asplit \
  --enable-encoder=h264_nvenc,hevc_nvenc,h264_amf,hevc_amf,h264_mf,hevc_mf,aac,rawvideo,pcm_s16le,mjpeg \
  --enable-decoder=wrapped_avframe,pcm_u8,pcm_f32le,pcm_f64le,pcm_s16le,pcm_s32le,rawvideo,h264,aac \
  --enable-parser=h264,hevc,aac \
  --enable-demuxer=pcm_f32le,pcm_s16le,concat,mpegts,mov,wav \
  --enable-muxer=segment,mpegts,mp4,mov,null,wav,image2,rawvideo \
  --enable-bsf=dump_extradata,aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata \
  --enable-protocol=file,pipe,concat
if ! grep -q "CONFIG_GFXCAPTURE_FILTER 1" config.h; then
  echo "gfxcapture não entrou. Dependências no config.h:"
  grep -E "HAVE_(CXX17|THREADS|W32THREADS|IGRAPHICSCAPTUREITEMINTEROP|__X_ABI_CWINDOWS_CGRAPHICS_CCAPTURE_CIGRAPHICSCAPTURESESSION3)|CONFIG_D3D11VA" config.h || true
  echo "--- trecho do config.log ---"
  grep -n -B2 -A25 -E "IGraphicsCaptureItemInterop|CIGraphicsCaptureSession3|std=c\+\+17" ffbuild/config.log | tail -150 || true
  exit 1
fi
make -j"$(nproc)"
mkdir -p "$(dirname "$OUT")"
x86_64-w64-mingw32-strip -o "$OUT" ffmpeg.exe
grep -aq timeBeginPeriod "$OUT" || { echo "ffmpeg.exe sem o ajuste do relógio"; exit 1; }
ls -la "$OUT"
