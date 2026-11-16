//! Comparação de versões para o aviso de atualização (Releases do GitHub).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Atualização baixada esperando para ser instalada.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pending {
    pub version: String,
    pub file: PathBuf,
    pub sha256: String,
}

pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

pub fn pending_path(dir: &Path) -> PathBuf {
    dir.join("pending.json")
}

pub fn clear_pending(dir: &Path) {
    let _ = std::fs::remove_dir_all(dir);
}

/// Atualização baixada, ainda íntegra e mais nova que `current`.
/// Qualquer coisa fora disso é apagada.
pub fn read_pending(dir: &Path, current: &str) -> Option<Pending> {
    let raw = std::fs::read_to_string(pending_path(dir)).ok()?;
    let p: Pending = match serde_json::from_str(&raw) {
        Ok(p) => p,
        Err(_) => {
            clear_pending(dir);
            return None;
        }
    };
    if !is_newer(&p.version, current) {
        clear_pending(dir);
        return None;
    }
    match sha256_file(&p.file) {
        Ok(h) if h == p.sha256 => Some(p),
        _ => {
            log::warn!("Atualização baixada não confere; descartando");
            clear_pending(dir);
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub url: Option<String>,
    pub notes: Option<String>,
    /// Link direto do instalador da versão nova.
    pub installer_url: Option<String>,
    /// SHA-256 do instalador publicado pelo GitHub (hex minúsculo).
    pub installer_sha256: Option<String>,
}

/// Escolhe o instalador entre os arquivos da versão (nunca o portátil).
pub fn pick_installer(json: &serde_json::Value) -> Option<(String, Option<String>)> {
    let assets = json.get("assets")?.as_array()?;
    let is_installer = |name: &str| {
        let n = name.to_lowercase();
        n.ends_with(".exe") && (n.contains("instalador") || n.contains("setup")) && !n.contains("portatil")
    };
    // Prefere o nome com versão (o de nome fixo é cópia dele).
    let mut list: Vec<&serde_json::Value> = assets
        .iter()
        .filter(|a| a.get("name").and_then(|n| n.as_str()).map(is_installer).unwrap_or(false))
        .collect();
    list.sort_by_key(|a| a.get("name").and_then(|n| n.as_str()).map(|n| n.len()).unwrap_or(0));
    let a = list.last()?;
    let url = a.get("browser_download_url")?.as_str()?.to_string();
    let sha = a
        .get("digest")
        .and_then(|d| d.as_str())
        .and_then(|d| d.strip_prefix("sha256:"))
        .map(|d| d.to_lowercase());
    Some((url, sha))
}

/// "v1.2.3" / "1.2.3-beta" → (1, 2, 3). Partes ausentes viram 0.
pub fn parse(v: &str) -> Option<(u64, u64, u64)> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    let core = v.split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>());
    let a = it.next()?.ok()?;
    let b = it.next().unwrap_or(Ok(0)).ok()?;
    let c = it.next().unwrap_or(Ok(0)).ok()?;
    Some((a, b, c))
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse(latest), parse(current)) {
        (Some(l), Some(c)) => l > c,
        _ => false,
    }
}

/// Monta o resultado a partir do `latest.json` anexado a cada versão
/// (baixado pelo link normal do GitHub, sem o limite de consultas da API).
/// Formato: `{"version": "1.3.1", "tag": "v1.3.1", "installer": "...exe", "sha256": "..."}`.
pub fn from_manifest_json(current: &str, repo: &str, json: &serde_json::Value) -> Option<UpdateInfo> {
    let version = json.get("version")?.as_str()?.trim().trim_start_matches(['v', 'V']).to_string();
    parse(&version)?;
    let tag = json
        .get("tag")
        .and_then(|t| t.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| format!("v{version}"));
    let installer = json.get("installer").and_then(|t| t.as_str()).filter(|n| !n.contains('/') && !n.contains('\\'));
    let sha = json
        .get("sha256")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()));
    Some(UpdateInfo {
        current: current.into(),
        available: is_newer(&version, current),
        latest: Some(tag.clone()),
        url: Some(format!("https://github.com/{repo}/releases/tag/{tag}")),
        notes: None,
        installer_url: installer.map(|n| format!("https://github.com/{repo}/releases/download/{tag}/{n}")),
        installer_sha256: sha,
    })
}

/// Monta o resultado a partir do JSON de `releases/latest`.
pub fn from_release_json(current: &str, json: &serde_json::Value) -> UpdateInfo {
    let tag = json.get("tag_name").and_then(|t| t.as_str()).map(str::to_string);
    let url = json.get("html_url").and_then(|t| t.as_str()).map(str::to_string);
    let notes = json.get("body").and_then(|t| t.as_str()).map(|s| s.chars().take(600).collect());
    let available = tag.as_deref().map(|t| is_newer(t, current)).unwrap_or(false);
    let installer = pick_installer(json);
    UpdateInfo {
        current: current.into(),
        latest: tag,
        available,
        url,
        notes,
        installer_url: installer.as_ref().map(|i| i.0.clone()),
        installer_sha256: installer.and_then(|i| i.1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("v1.0.1", "1.0.0"));
        assert!(is_newer("v1.10.0", "1.9.9"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
        assert!(!is_newer("v0.9.0", "1.0.0"));
        assert!(!is_newer("lixo", "1.0.0"));
        assert_eq!(parse("v2.1.0-beta.1"), Some((2, 1, 0)));
        assert_eq!(parse("3"), Some((3, 0, 0)));
    }

    #[test]
    fn reads_release_json() {
        let j = serde_json::json!({"tag_name": "v1.2.0", "html_url": "https://github.com/x/y/releases/tag/v1.2.0", "body": "novidades"});
        let u = from_release_json("1.0.0", &j);
        assert!(u.available);
        assert_eq!(u.latest.as_deref(), Some("v1.2.0"));
        let u = from_release_json("1.2.0", &j);
        assert!(!u.available);
    }

    #[test]
    fn picks_installer_with_digest() {
        let j = serde_json::json!({
            "tag_name": "v1.2.0",
            "assets": [
                {"name": "GoatFilter-1.2.0-portatil.exe", "browser_download_url": "https://x/p.exe", "digest": "sha256:aa"},
                {"name": "GoatFilter-instalador.exe", "browser_download_url": "https://x/fixo.exe", "digest": "sha256:BB"},
                {"name": "GoatFilter-1.2.0-instalador.exe", "browser_download_url": "https://x/i.exe", "digest": "sha256:CC"}
            ]
        });
        let u = from_release_json("1.1.0", &j);
        assert_eq!(u.installer_url.as_deref(), Some("https://x/i.exe"));
        assert_eq!(u.installer_sha256.as_deref(), Some("cc"));
        assert!(pick_installer(&serde_json::json!({"assets": [{"name": "x-portatil.exe"}]})).is_none());
    }

    fn write_pending(dir: &Path, version: &str, content: &[u8], sha: Option<&str>) {
        std::fs::create_dir_all(dir).unwrap();
        let file = dir.join("inst.exe");
        std::fs::write(&file, content).unwrap();
        let sha = sha.map(str::to_string).unwrap_or_else(|| sha256_file(&file).unwrap());
        let p = Pending { version: version.into(), file, sha256: sha };
        std::fs::write(pending_path(dir), serde_json::to_string(&p).unwrap()).unwrap();
    }

    #[test]
    fn pending_update_is_verified() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("updates");
        write_pending(&dir, "v1.3.0", b"instalador", None);
        assert_eq!(read_pending(&dir, "1.2.0").unwrap().version, "v1.3.0");
        // já está nessa versão: limpa
        assert!(read_pending(&dir, "1.3.0").is_none());
        assert!(!dir.exists());
    }

    #[test]
    fn tampered_file_is_discarded() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().join("updates");
        write_pending(&dir, "v9.0.0", b"instalador", Some("00"));
        assert!(read_pending(&dir, "1.2.0").is_none());
        assert!(!dir.exists());
    }

    #[test]
    fn sha256_matches_known_value() {
        let t = tempfile::tempdir().unwrap();
        let f = t.path().join("a");
        std::fs::write(&f, b"abc").unwrap();
        assert_eq!(sha256_file(&f).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn reads_release_manifest() {
        let j = serde_json::json!({
            "version": "1.3.1", "tag": "v1.3.1",
            "installer": "GoatFilter-1.3.1-instalador.exe",
            "sha256": "AB".repeat(32)
        });
        let u = from_manifest_json("1.3.0", "o/r", &j).unwrap();
        assert!(u.available);
        assert_eq!(
            u.installer_url.as_deref(),
            Some("https://github.com/o/r/releases/download/v1.3.1/GoatFilter-1.3.1-instalador.exe")
        );
        assert_eq!(u.installer_sha256.as_deref(), Some("ab".repeat(32).as_str()));
        assert!(!from_manifest_json("1.3.1", "o/r", &j).unwrap().available);
        // nome com caminho ou hash inválido são ignorados
        let bad = serde_json::json!({"version": "2.0.0", "installer": "../x.exe", "sha256": "123"});
        let u = from_manifest_json("1.0.0", "o/r", &bad).unwrap();
        assert!(u.installer_url.is_none() && u.installer_sha256.is_none());
        assert!(from_manifest_json("1.0.0", "o/r", &serde_json::json!({"version": "lixo"})).is_none());
    }
}
