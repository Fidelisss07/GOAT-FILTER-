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
    /// Nome GDI → gamma ramp original (3 × 256 valores).
    #[serde(default)]
    pub ramps: BTreeMap<String, Vec<u16>>,
    /// Nome GDI → código VCP → valor cru original do monitor (DDC/CI).
    #[serde(default)]
    pub hw: BTreeMap<String, BTreeMap<u8, u32>>,
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

    pub fn remember_ramp(&mut self, display: &str, ramp: Vec<u16>) {
        if self.data.ramps.contains_key(display) {
            return;
        }
        self.data.ramps.insert(display.to_string(), ramp);
        self.flush();
    }

    pub fn ramp(&self, display: &str) -> Option<&Vec<u16>> {
        self.data.ramps.get(display)
    }

    pub fn ramps(&self) -> Vec<(String, Vec<u16>)> {
        self.data.ramps.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
    }

    pub fn forget_ramp(&mut self, display: &str) {
        if self.data.ramps.remove(display).is_some() {
            self.flush();
        }
    }

    pub fn remember_hw(&mut self, display: &str, vcp: u8, value: u32) {
        let e = self.data.hw.entry(display.to_string()).or_default();
        if e.contains_key(&vcp) {
            return;
        }
        e.insert(vcp, value);
        self.flush();
    }

    pub fn hw(&self, display: &str, vcp: u8) -> Option<u32> {
        self.data.hw.get(display).and_then(|m| m.get(&vcp)).copied()
    }

    pub fn forget_hw(&mut self, display: &str, vcp: u8) {
        if let Some(m) = self.data.hw.get_mut(display) {
            m.remove(&vcp);
            if m.is_empty() {
                self.data.hw.remove(display);
            }
            self.flush();
        }
    }

    pub fn all_hw(&self) -> Vec<(String, u8, u32)> {
        self.data
            .hw
            .iter()
            .flat_map(|(d, m)| m.iter().map(move |(c, v)| (d.clone(), *c, *v)))
            .collect()
    }

    pub fn originals(&self) -> Vec<(String, u8)> {
        self.data.originals.iter().map(|(k, v)| (k.clone(), *v)).collect()
    }

    pub fn clear(&mut self) {
        self.data.originals.clear();
        self.data.ramps.clear();
        self.data.hw.clear();
        self.flush();
    }

    fn is_empty(&self) -> bool {
        self.data.originals.is_empty() && self.data.ramps.is_empty() && self.data.hw.is_empty()
    }

    fn flush(&self) {
        let Some(p) = &self.path else { return };
        if self.is_empty() {
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
