//! Brilho, contraste e gama via gamma ramp do Windows (`SetDeviceGammaRamp`).
//! Funciona com qualquer GPU. O Windows recusa curvas muito extremas.

use super::{BackendError, CurveControl, Result};
use crate::color::Ramp;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Gdi::{CreateDCW, DeleteDC};
use windows::Win32::UI::ColorSystem::{GetDeviceGammaRamp, SetDeviceGammaRamp};

pub struct GdiGamma;

fn with_dc<T>(display: &str, f: impl FnOnce(windows::Win32::Graphics::Gdi::HDC) -> Result<T>) -> Result<T> {
    let name: Vec<u16> = display.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let dc = CreateDCW(PCWSTR(name.as_ptr()), PCWSTR(name.as_ptr()), PCWSTR::null(), None);
        if dc.is_invalid() {
            return Err(BackendError::Driver("monitor indisponível".into()));
        }
        let r = f(dc);
        let _ = DeleteDC(dc);
        r
    }
}

impl CurveControl for GdiGamma {
    fn get(&mut self, display: &str) -> Result<Ramp> {
        with_dc(display, |dc| {
            let mut r: Ramp = [[0; 256]; 3];
            if unsafe { GetDeviceGammaRamp(dc, r.as_mut_ptr() as _) }.as_bool() {
                Ok(r)
            } else {
                Err(BackendError::Driver("não foi possível ler a curva de gama".into()))
            }
        })
    }

    fn set(&mut self, display: &str, ramp: &Ramp) -> Result<()> {
        with_dc(display, |dc| {
            if unsafe { SetDeviceGammaRamp(dc, ramp.as_ptr() as _) }.as_bool() {
                Ok(())
            } else {
                Err(BackendError::Driver(
                    "o Windows recusou a curva (ajuste extremo demais ou tela cheia exclusiva)".into(),
                ))
            }
        })
    }
}
