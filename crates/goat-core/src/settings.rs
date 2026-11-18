//! Persistência das preferências em JSON (pasta de configuração do app).

use crate::types::{Profile, Settings, SUPER_MAX, VALORANT_ID};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Arquivo `.goatfilter.json` para compartilhar perfis.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileExport {
    pub app: String,
    pub version: u32,
    pub profiles: Vec<Profile>,
}

pub fn export_profiles(profiles: &[Profile]) -> String {
    let e = ProfileExport { app: "goat-filter".into(), version: 1, profiles: profiles.to_vec() };
    serde_json::to_string_pretty(&e).unwrap_or_default()
}

/// Junta os perfis do arquivo aos atuais (mesmo id substitui). Devolve quantos entraram.
pub fn import_profiles(json: &str, settings: &mut Settings) -> Result<usize, String> {
    let e: ProfileExport = serde_json::from_str(json).map_err(|_| "Arquivo inválido: não é um perfil do Goat Filter.".to_string())?;
    if e.app != "goat-filter" {
        return Err("Arquivo inválido: não é um perfil do Goat Filter.".into());
    }
    let n = e.profiles.len();
    for p in e.profiles {
        if p.name.trim().is_empty() {
            continue;
        }
        match settings.profiles.iter_mut().find(|x| x.id == p.id) {
            Some(x) => *x = p,
            None => settings.profiles.push(p),
        }
    }
    *settings = sanitize(std::mem::take(settings));
    Ok(n)
}

/// Backup completo das preferências (arquivo .json escolhido pelo usuário).
pub fn export_all(s: &Settings) -> String {
    serde_json::json!({ "app": "goat-filter", "kind": "backup", "version": 1, "settings": s }).to_string()
}

/// Lê um backup. Aceita o formato acima ou um settings.json puro.
pub fn import_all(json: &str) -> Result<Settings, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| "Arquivo inválido.".to_string())?;
    let inner = match v.get("kind").and_then(|k| k.as_str()) {
        Some("backup") if v.get("app").and_then(|a| a.as_str()) == Some("goat-filter") => v.get("settings").cloned().unwrap_or_default(),
        Some(_) => return Err("Arquivo inválido.".into()),
        None => v,
    };
    let s: Settings = serde_json::from_value(inner).map_err(|_| "Arquivo inválido: não é um backup do Goat Filter.".to_string())?;
    Ok(sanitize(s))
}

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
        p.tuning = p.tuning.sanitized();
    }
    s.close_on_game = crate::tweaks::closable(&s.close_on_game);
    s.close_on_game.dedup();
    s.crosshairs.retain(|c| crate::games::is_crosshair_code(&c.code) && !c.name.trim().is_empty());
    s.crosshairs.truncate(200);
    s.recorder = std::mem::take(&mut s.recorder).sanitized();
    if s.temp_alert != 0 {
        s.temp_alert = s.temp_alert.clamp(60, 100);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_vai_e_volta() {
        let mut s = Settings::default();
        s.oled = true;
        s.recorder.clip_seconds = 45;
        s.crosshairs.push(crate::types::Crosshair { id: "a".into(), name: "Minha".into(), code: "0;P;c;5".into() });
        let back = import_all(&export_all(&s)).unwrap();
        assert!(back.oled);
        assert_eq!(back.recorder.clip_seconds, 45);
        assert_eq!(back.crosshairs.len(), 1);
        // settings.json puro também serve.
        assert_eq!(import_all(&serde_json::to_string(&s).unwrap()).unwrap().recorder.clip_seconds, 45);
        assert!(import_all("{\"kind\":\"outra\"}").is_err());
        assert!(import_all("lixo").is_err());
    }

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

    #[test]
    fn export_import_roundtrip() {
        let mut src = Settings::default();
        src.profiles[0].vibrance = 160;
        src.profiles[0].tuning.gamma = 130;
        src.profiles.push(Profile { id: "cs2".into(), name: "CS2".into(), executable: "cs2.exe".into(), ..src.profiles[0].clone() });
        let file = export_profiles(&src.profiles);

        let mut dst = Settings::default();
        assert_eq!(import_profiles(&file, &mut dst).unwrap(), 2);
        assert_eq!(dst.profiles.len(), 2);
        assert_eq!(dst.profiles[0].vibrance, 160);
        assert_eq!(dst.profiles[0].tuning.gamma, 130);
        assert!(import_profiles("{}", &mut dst).is_err());
        assert!(import_profiles(r#"{"app":"outro","version":1,"profiles":[]}"#, &mut dst).is_err());
    }

    #[test]
    fn old_settings_without_new_fields_still_load() {
        let old = r#"{"theme":"rosa","profiles":[{"id":"valorant","name":"Valorant","executable":"VALORANT.exe","vibrance":90,"applyOnOpen":true,"restoreOnClose":true}]}"#;
        let s: Settings = serde_json::from_str(old).unwrap();
        assert!(!s.profiles[0].focus_only);
        assert_eq!(s.profiles[0].tuning, crate::types::Tuning::default());
        assert!(s.hotkeys);
    }
}
