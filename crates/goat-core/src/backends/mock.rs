//! Backends falsos para testes e para rodar fora do Windows.

use super::{combined, BackendError, CurveControl, DriverVibrance, HwControl, MonitorHw, Result, SuperLayer};
use crate::color::{self, Mat3, Ramp};
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
    pub factors: Arc<Mutex<BTreeMap<String, Mat3>>>,
}

/// Recupera o fator de saturação de uma matriz de saturação pura.
fn factor_of(m: &Mat3) -> f32 {
    let w = color::LUMA[0];
    (m[0][0] - w) / (1.0 - w)
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
        factor_of(&combined(&self.factors.lock().unwrap()))
    }
    /// Fator de um monitor (camadas por monitor).
    pub fn of(&self, display: &str) -> f32 {
        self.factors.lock().unwrap().get(display).map(factor_of).unwrap_or(1.0)
    }
    pub fn matrix(&self, display: &str) -> Option<Mat3> {
        self.factors.lock().unwrap().get(display).copied()
    }
}

impl SuperLayer for MockSuper {
    fn method(&self) -> SuperMethod {
        self.method
    }
    fn apply(&mut self, matrices: &BTreeMap<String, Mat3>) -> Result<()> {
        *self.factors.lock().unwrap() = matrices.clone();
        Ok(())
    }
}

/// Gamma ramp falsa.
#[derive(Clone, Default)]
pub struct MockCurves {
    pub ramps: Arc<Mutex<HashMap<String, Ramp>>>,
}

impl MockCurves {
    pub fn ramp(&self, display: &str) -> Ramp {
        self.ramps.lock().unwrap().get(display).copied().unwrap_or_else(color::identity_ramp)
    }
}

impl CurveControl for MockCurves {
    fn get(&mut self, display: &str) -> Result<Ramp> {
        Ok(self.ramp(display))
    }
    fn set(&mut self, display: &str, ramp: &Ramp) -> Result<()> {
        self.ramps.lock().unwrap().insert(display.into(), *ramp);
        Ok(())
    }
}

/// Monitor DDC/CI falso: valores 0–100, saturação só se `saturation` for true.
#[derive(Clone)]
pub struct MockHw {
    pub values: Arc<Mutex<HashMap<(String, HwControl), u32>>>,
    pub saturation: bool,
}

impl Default for MockHw {
    fn default() -> Self {
        Self { values: Arc::new(Mutex::new(HashMap::new())), saturation: false }
    }
}

impl MockHw {
    pub fn value(&self, display: &str, c: HwControl) -> u32 {
        self.values.lock().unwrap().get(&(display.to_string(), c)).copied().unwrap_or(70)
    }
}

impl MonitorHw for MockHw {
    fn read(&mut self, display: &str, c: HwControl) -> Result<(u32, u32)> {
        if c == HwControl::Saturation && !self.saturation {
            return Err(BackendError::Unsupported);
        }
        Ok((self.value(display, c), 100))
    }
    fn write(&mut self, display: &str, c: HwControl, value: u32) -> Result<()> {
        if c == HwControl::Saturation && !self.saturation {
            return Err(BackendError::Unsupported);
        }
        self.values.lock().unwrap().insert((display.to_string(), c), value);
        Ok(())
    }
}
