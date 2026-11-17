//! Atualização automática sem chaves extras:
//! 1. baixa o instalador da versão nova nos Releases do GitHub;
//! 2. confere o SHA-256 que o próprio GitHub publica para o arquivo;
//! 3. na próxima abertura (ou no botão "Reiniciar e atualizar"), roda o
//!    instalador em modo silencioso e reabre o app.
//!
//! Só funciona na versão instalada; a portátil apenas avisa.

use goat_core::update::{pending_path, UpdateInfo};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

pub use goat_core::update::Pending;

/// Instalado pelo instalador (tem o desinstalador ao lado do .exe)?
pub fn is_installed() -> bool {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("uninstall.exe").is_file()))
        .unwrap_or(false)
}

pub fn pending(dir: &Path) -> Option<Pending> {
    goat_core::update::read_pending(dir, env!("CARGO_PKG_VERSION"))
}

pub fn clear(dir: &Path) {
    goat_core::update::clear_pending(dir)
}

/// Baixa e confere o instalador. Devolve a atualização pronta.
/// `progress` recebe a porcentagem (0–100) durante o download.
pub fn download(dir: &Path, info: &UpdateInfo, progress: impl Fn(u8)) -> Result<Pending, String> {
    let version = info.latest.clone().ok_or("versão desconhecida")?;
    let url = info.installer_url.clone().ok_or("a versão não tem instalador")?;
    // Sem o código de verificação do GitHub, não instala sozinho.
    let expected = info.installer_sha256.clone().ok_or("a versão não tem código de verificação")?;
    if let Some(p) = pending(dir) {
        if p.version == version {
            return Ok(p);
        }
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("GoatFilter-{}-instalador.exe", version.trim_start_matches('v')));
    let part = file.with_extension("part");

    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout(Duration::from_secs(120))
        .build();
    let resp = agent
        .get(&url)
        .set("User-Agent", "goat-filter-updater")
        .call()
        .map_err(|e| format!("download falhou ({e})"))?;
    let size: Option<u64> = resp.header("Content-Length").and_then(|v| v.parse().ok());
    let mut reader = resp.into_reader();
    let mut last_pct = 255u8;
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > 200 * 1024 * 1024 {
            let _ = std::fs::remove_file(&part);
            return Err("arquivo grande demais".into());
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        if let Some(sz) = size.filter(|s| *s > 0) {
            let pct = ((total * 100) / sz).min(100) as u8;
            if pct != last_pct {
                last_pct = pct;
                progress(pct);
            }
        }
    }
    drop(out);
    let got = format!("{:x}", h.finalize());
    if got != expected {
        let _ = std::fs::remove_file(&part);
        return Err("o arquivo baixado não confere com o publicado no GitHub".into());
    }
    std::fs::rename(&part, &file).map_err(|e| e.to_string())?;
    let p = Pending { version, file, sha256: got };
    std::fs::write(pending_path(dir), serde_json::to_string_pretty(&p).unwrap_or_default()).map_err(|e| e.to_string())?;
    log::info!("Atualização {} baixada e conferida", p.version);
    Ok(p)
}

/// Fecha o caminho para o instalador: espera o app sair, instala em
/// silêncio e reabre o Goat Filter.
#[cfg(windows)]
pub fn launch(p: &Pending, minimized: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let extra = if minimized { " --minimized" } else { "" };
    let script = format!(
        "/C ping -n 3 127.0.0.1 >nul & \"{}\" /S & start \"\" \"{}\"{}",
        p.file.display(),
        exe.display(),
        extra
    );
    log::info!("Instalando atualização {}", p.version);
    std::process::Command::new("cmd")
        .raw_arg(script)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn launch(_p: &Pending, _minimized: bool) -> Result<(), String> {
    Err("disponível apenas no Windows".into())
}
