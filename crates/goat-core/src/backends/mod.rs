//! Backends que alteram as cores. Nada aqui toca no processo de jogo:
//! tudo passa pelo driver da GPU ou pelo próprio Windows.

pub mod icc;
pub mod mapping;
pub mod mock;

#[cfg(windows)]
pub mod adl;
#[cfg(windows)]
pub mod gamma;
#[cfg(windows)]
pub mod magnifier;
#[cfg(windows)]
pub mod mhc2;
#[cfg(windows)]
pub mod nvapi;

use crate::color::{self, Mat3, Ramp};
use crate::types::{DriverKind, SuperMethod};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error("{0}")]
    Driver(String),
    #[error("monitor não suportado por este backend")]
    Unsupported,
}

pub type Result<T> = std::result::Result<T, BackendError>;

/// Camada 1: Digital Vibrance do driver, 0–100% (50% = normal).
///
/// `display` é o nome GDI do monitor, ex.: `\\.\DISPLAY1`.
pub trait DriverVibrance: Send {
    fn kind(&self) -> DriverKind;
    fn supports(&mut self, display: &str) -> bool;
    fn get(&mut self, display: &str) -> Result<u8>;
    fn set(&mut self, display: &str, percent: u8) -> Result<()>;
    fn default_percent(&mut self, display: &str) -> Option<u8>;
}

/// Camada 2: matriz de cor (RGB linear) aplicada pelo Windows depois do jogo.
/// Recebe a matriz desejada por monitor. Monitores fora do mapa devem voltar
/// ao normal. Camadas globais usam a matriz mais forte.
pub trait SuperLayer: Send {
    fn method(&self) -> SuperMethod;
    fn apply(&mut self, matrices: &BTreeMap<String, Mat3>) -> Result<()>;
}

/// Matriz mais forte (para camadas que valem para a tela toda).
pub fn combined(matrices: &BTreeMap<String, Mat3>) -> Mat3 {
    matrices
        .values()
        .copied()
        .fold(color::IDENTITY, |acc, m| if color::strength(&m) > color::strength(&acc) { m } else { acc })
}

/// Brilho/contraste/gama por monitor (gamma ramp).
pub trait CurveControl: Send {
    fn get(&mut self, display: &str) -> Result<Ramp>;
    fn set(&mut self, display: &str, ramp: &Ramp) -> Result<()>;
}

pub struct Detected {
    pub drivers: Vec<Box<dyn DriverVibrance>>,
    /// Camadas Super disponíveis, na ordem de preferência.
    pub super_layers: Vec<Box<dyn SuperLayer>>,
    /// Por que cada método ausente não está disponível.
    pub super_reasons: Vec<(SuperMethod, String)>,
    pub curves: Option<Box<dyn CurveControl>>,
}

/// Carrega o que existir nesta máquina. Falhas viram "indisponível", nunca pânico.
/// `data_dir` guarda os perfis de cor gerados pela camada MHC2.
#[cfg(windows)]
pub fn detect(data_dir: &Path) -> Detected {
    let mut drivers: Vec<Box<dyn DriverVibrance>> = Vec::new();
    match nvapi::NvApi::load() {
        Ok(n) => drivers.push(Box::new(n)),
        Err(e) => log::info!("NVAPI indisponível: {e}"),
    }
    match adl::Adl::load() {
        Ok(a) => drivers.push(Box::new(a)),
        Err(e) => log::info!("ADL indisponível: {e}"),
    }
    let mut super_layers: Vec<Box<dyn SuperLayer>> = Vec::new();
    let mut super_reasons = Vec::new();
    match magnifier::Magnifier::start() {
        Ok(m) => super_layers.push(Box::new(m)),
        Err(e) => super_reasons.push((SuperMethod::Magnifier, e)),
    }
    match mhc2::Mhc2::start(data_dir.join("perfis-de-cor")) {
        Ok(m) => super_layers.push(Box::new(m)),
        Err(e) => super_reasons.push((SuperMethod::Mhc2, e)),
    }
    Detected { drivers, super_layers, super_reasons, curves: Some(Box::new(gamma::GdiGamma)) }
}

#[cfg(not(windows))]
pub fn detect(_data_dir: &Path) -> Detected {
    Detected {
        drivers: Vec::new(),
        super_layers: Vec::new(),
        super_reasons: vec![
            (SuperMethod::Magnifier, "disponível apenas no Windows".into()),
            (SuperMethod::Mhc2, "disponível apenas no Windows 11".into()),
        ],
        curves: None,
    }
}

/// Converte para a matriz 5×5 da Magnification API (vetor-linha: linha =
/// canal de entrada, coluna = canal de saída), ou seja, a transposta.
pub fn to_magnifier(m: &Mat3) -> [[f32; 5]; 5] {
    let mut o = [[0.0f32; 5]; 5];
    for i in 0..3 {
        for j in 0..3 {
            o[i][j] = m[j][i];
        }
    }
    o[3][3] = 1.0;
    o[4][4] = 1.0;
    o
}

/// Saturação uniforme no formato da Magnification API.
pub fn saturation_matrix(s: f32) -> [[f32; 5]; 5] {
    to_magnifier(&color::saturation(s))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(m: &[[f32; 5]; 5], rgb: [f32; 3]) -> [f32; 3] {
        let mut out = [0.0; 3];
        for j in 0..3 {
            out[j] = (0..3).map(|i| rgb[i] * m[i][j]).sum();
        }
        out
    }

    #[test]
    fn identity_at_one() {
        let m = saturation_matrix(1.0);
        let c = apply(&m, [0.3, 0.6, 0.9]);
        for (a, b) in c.iter().zip([0.3, 0.6, 0.9]) {
            assert!((a - b).abs() < 1e-6);
        }
    }

    #[test]
    fn grays_stay_gray() {
        let m = saturation_matrix(1.8);
        let c = apply(&m, [0.5, 0.5, 0.5]);
        for v in c {
            assert!((v - 0.5).abs() < 1e-5, "{c:?}");
        }
    }

    #[test]
    fn zero_is_grayscale() {
        let m = saturation_matrix(0.0);
        let c = apply(&m, [1.0, 0.0, 0.0]);
        assert!((c[0] - c[1]).abs() < 1e-6 && (c[1] - c[2]).abs() < 1e-6);
    }

    #[test]
    fn boosts_saturation() {
        let m = saturation_matrix(1.5);
        let c = apply(&m, [0.8, 0.4, 0.4]);
        assert!(c[0] > 0.8 && c[1] < 0.4);
    }
}
