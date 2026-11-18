use std::path::PathBuf;

fn main() {
    // FFmpeg do gravador (scripts/build-ffmpeg.sh). O CI coloca o arquivo em
    // src-tauri/bin/ffmpeg.exe; sem ele o app compila com o gravador desligado.
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let real = manifest.join("bin").join("ffmpeg.exe");
    println!("cargo:rerun-if-changed=bin/ffmpeg.exe");
    let path = if real.is_file() {
        real
    } else {
        let empty = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("ffmpeg-empty.bin");
        std::fs::write(&empty, []).unwrap();
        empty
    };
    println!("cargo:rustc-env=GOAT_FFMPEG={}", path.display());
    tauri_build::build()
}
