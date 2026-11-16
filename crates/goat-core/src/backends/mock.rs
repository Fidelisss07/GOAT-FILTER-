//! Backends falsos para testes e para rodar fora do Windows.

use super::{combined_factor, BackendError, DriverVibrance, Result, SuperLayer};
use std::collections::BTreeMap;
use crate::types::{DriverKind, SuperMethod};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct MockDriver {
    pub levels: Arc<Mutex<HashMap<String, u8>>>,
    pub fail_writes: Arc<Mutex<bool>>,
}

impl MockDriver {
    pub fn with(displays: &[(&str, u8)]) -> Self {
        let d = Self::default();
        for (n, v) in displays {
            d.levels.lock().unwrap().insert((*n).into(), *v);
        }
        d
    }
    pub fn level(&self, display: &str) -> Option<u8> {
        self.levels.lock().unwrap().get(display).copied()
    }
}

impl DriverVibrance for MockDriver {
    fn kind(&self) -> DriverKind {
        DriverKind::Nvidia
    }
    fn supports(&mut self, display: &str) -> bool {
        self.levels.lock().unwrap().contains_key(display)
    }
    fn get(&mut self, display: &str) -> Result<u8> {
        self.level(display).ok_or(BackendError::Unsupported)
    }
    fn set(&mut self, display: &str, percent: u8) -> Result<()> {
        if *self.fail_writes.lock().unwrap() {
            return Err(BackendError::Driver("falha simulada".into()));
        }
        let mut l = self.levels.lock().unwrap();
        match l.get_mut(display) {
            Some(v) => {
                *v = percent.min(100);
                Ok(())
            }
            None => Err(BackendError::Unsupported),
        }
    }
    fn default_percent(&mut self, _display: &str) -> Option<u8> {
        Some(50)
    }
}

/// Camada Super falsa. `method` define se é global (Magnifier) ou por monitor (Mhc2).
#[derive(Clone)]
pub struct MockSuper {
    pub method: SuperMethod,
    pub factors: Arc<Mutex<BTreeMap<String, f32>>>,
}

impl Default for MockSuper {
    fn default() -> Self {
        Self::new(SuperMethod::Magnifier)
    }
}

impl MockSuper {
    pub fn new(method: SuperMethod) -> Self {
        Self { method, factors: Arc::new(Mutex::new(BTreeMap::new())) }
    }
    /// Fator global efetivo.
    pub fn get(&self) -> f32 {
        combined_factor(&self.factors.lock().unwrap())
    }
    /// Fator de um monitor (camadas por monitor).
    pub fn of(&self, display: &str) -> f32 {
        self.factors.lock().unwrap().get(display).copied().unwrap_or(1.0)
    }
}

impl SuperLayer for MockSuper {
    fn method(&self) -> SuperMethod {
        self.method
    }
    fn apply(&mut self, factors: &BTreeMap<String, f32>) -> Result<()> {
        *self.factors.lock().unwrap() = factors.clone();
        Ok(())
    }
}
