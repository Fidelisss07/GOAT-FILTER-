//! Backends que alteram as cores. Nada aqui toca no processo de jogo:
//! tudo passa pelo driver da GPU ou pelo próprio Windows.

pub mod mapping;
pub mod mock;

#[cfg(windows)]
pub mod adl;
#[cfg(windows)]
pub mod magnifier;
#[cfg(windows)]
pub mod nvapi;

use crate::types::{DriverKind, SuperMethod};

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

/// Camada 2: matriz de saturação aplicada pelo Windows por cima de tudo.
/// Fator 1.0 = sem efeito. É global (todos os monitores).
pub trait SuperLayer: Send {
    fn method(&self) -> SuperMethod;
    fn set_factor(&mut self, factor: f32) -> Result<()>;
}

pub struct Detected {
    pub drivers: Vec<Box<dyn DriverVibrance>>,
    pub super_layer: Option<Box<dyn SuperLayer>>,
    pub super_reason: Option<String>,
}

/// Carrega o que existir nesta máquina. Falhas viram "indisponível", nunca pânico.
#[cfg(windows)]
pub fn detect() -> Detected {
    let mut drivers: Vec<Box<dyn DriverVibrance>> = Vec::new();
    match nvapi::NvApi::load() {
        Ok(n) => drivers.push(Box::new(n)),
        Err(e) => log::info!("NVAPI indisponível: {e}"),
    }
    match adl::Adl::load() {
        Ok(a) => drivers.push(Box::new(a)),
        Err(e) => log::info!("ADL indisponível: {e}"),
    }
    let (super_layer, super_reason) = match magnifier::Magnifier::start() {
        Ok(m) => (Some(Box::new(m) as Box<dyn SuperLayer>), None),
        Err(e) => (None, Some(format!("Super Vibrance indisponível: {e}"))),
    };
    Detected { drivers, super_layer, super_reason }
}

#[cfg(not(windows))]
pub fn detect() -> Detected {
    Detected {
        drivers: Vec::new(),
        super_layer: None,
        super_reason: Some("Disponível apenas no Windows.".into()),
    }
}

/// Matriz de saturação 5×5 no formato do Windows (vetor-linha: linha = canal
/// de entrada, coluna = canal de saída). Pesos de luminância Rec.709.
pub fn saturation_matrix(s: f32) -> [[f32; 5]; 5] {
    const W: [f32; 3] = [0.2126, 0.7152, 0.0722];
    let mut m = [[0.0f32; 5]; 5];
    for (i, w) in W.iter().enumerate() {
        for j in 0..3 {
            m[i][j] = (1.0 - s) * w + if i == j { s } else { 0.0 };
        }
    }
    m[3][3] = 1.0;
    m[4][4] = 1.0;
    m
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
