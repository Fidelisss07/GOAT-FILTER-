//! Guarda os valores originais do driver antes de qualquer alteração.
//!
//! O arquivo `session.json` só existe enquanto há alterações ativas. Se o app
//! travar ou o PC desligar, na próxima abertura o arquivo ainda existe e os
//! valores são restaurados. A camada Super não precisa disso: o Windows a
//! remove sozinho quando o processo termina.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct SessionData {
    /// Nome GDI do monitor → porcentagem do driver antes do Goat Filter.
    pub originals: BTreeMap<String, u8>,
}

pub struct Session {
    path: Option<PathBuf>,
    data: SessionData,
}

impl Session {
    /// `path = None` mantém tudo só em memória (testes/demonstração).
    pub fn open(path: Option<PathBuf>) -> (Self, SessionData) {
        let leftover = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<SessionData>(&s).ok())
            .unwrap_or_default();
        (Self { path, data: SessionData::default() }, leftover)
    }

    pub fn original(&self, display: &str) -> Option<u8> {
        self.data.originals.get(display).copied()
    }

    /// Grava o original só na primeira vez (nunca sobrescreve).
    pub fn remember(&mut self, display: &str, value: u8) {
        if self.data.originals.contains_key(display) {
            return;
        }
        self.data.originals.insert(display.to_string(), value);
        self.flush();
    }

    pub fn forget(&mut self, display: &str) {
        if self.data.originals.remove(display).is_some() {
            self.flush();
        }
    }

    pub fn originals(&self) -> Vec<(String, u8)> {
        self.data.originals.iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    pub fn clear(&mut self) {
        self.data.originals.clear();
        self.flush();
    }

    fn flush(&self) {
        let Some(p) = &self.path else { return };
        if self.data.originals.is_empty() {
            let _ = std::fs::remove_file(p);
            return;
        }
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = p.with_extension("json.tmp");
        if let Ok(s) = serde_json::to_string_pretty(&self.data) {
            if std::fs::write(&tmp, s).is_ok() {
                let _ = std::fs::rename(&tmp, p);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn survives_crash_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        {
            let (mut s, left) = Session::open(Some(path.clone()));
            assert!(left.originals.is_empty());
            s.remember("D1", 50);
            s.remember("D1", 90); // não sobrescreve
            // "crash": não chama clear()
        }
        let (mut s, left) = Session::open(Some(path.clone()));
        assert_eq!(left.originals.get("D1"), Some(&50));
        s.clear();
        assert!(!path.exists());
    }
}
