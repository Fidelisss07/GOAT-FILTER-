//! Persistência das preferências em JSON (pasta de configuração do app).

use crate::types::{Settings, SUPER_MAX, VALORANT_ID};
use std::path::Path;

pub fn load(path: &Path) -> Settings {
    let s = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
        .unwrap_or_default();
    sanitize(s)
}

pub fn save(path: &Path, s: &Settings) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(s)?)?;
    std::fs::rename(tmp, path)
}

/// Garante um estado válido: perfil do Valorant sempre presente, valores no intervalo.
pub fn sanitize(mut s: Settings) -> Settings {
    if !s.profiles.iter().any(|p| p.id == VALORANT_ID) {
        s.profiles.insert(0, Settings::default().profiles.remove(0));
    }
    let mut seen = std::collections::HashSet::new();
    s.profiles.retain(|p| seen.insert(p.id.clone()));
    for p in &mut s.profiles {
        p.vibrance = p.vibrance.min(SUPER_MAX);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        let mut s = load(&p);
        assert_eq!(s, Settings::default());
        s.profiles[0].vibrance = 140;
        save(&p, &s).unwrap();
        assert_eq!(load(&p).profiles[0].vibrance, 140);
    }

    #[test]
    fn corrupt_file_falls_back() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("settings.json");
        std::fs::write(&p, "{ quebrado").unwrap();
        assert_eq!(load(&p), Settings::default());
    }

    #[test]
    fn camel_case_matches_frontend() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        assert!(json.get("startWithWindows").is_some());
        assert!(json["profiles"][0].get("applyOnOpen").is_some());
        assert_eq!(json["theme"], "roxo");
    }
}
