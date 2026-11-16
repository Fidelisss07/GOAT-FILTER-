//! Controle do próprio monitor pelo cabo (DDC/CI): brilho, contraste e
//! saturação do monitor (quando o modelo aceita). Usa `dxva2.dll`.
//!
//! DDC/CI é lento (dezenas de ms por comando) e alguns monitores precisam da
//! opção "DDC/CI" ligada no menu do próprio monitor.

use super::{BackendError, HwControl, MonitorHw, Result};
use crate::monitors::hmonitor_for;
use libloading::Library;
use std::ffi::c_void;

type Handle = *mut c_void;

#[repr(C)]
struct PhysicalMonitor {
    handle: Handle,
    description: [u16; 128],
}

type FnCount = unsafe extern "system" fn(isize, *mut u32) -> i32;
type FnGetPhysical = unsafe extern "system" fn(isize, u32, *mut PhysicalMonitor) -> i32;
type FnDestroy = unsafe extern "system" fn(u32, *const PhysicalMonitor) -> i32;
type FnGetVcp = unsafe extern "system" fn(Handle, u8, *mut u32, *mut u32, *mut u32) -> i32;
type FnSetVcp = unsafe extern "system" fn(Handle, u8, u32) -> i32;

pub struct Ddc {
    _lib: Library,
    count: FnCount,
    get_physical: FnGetPhysical,
    destroy: FnDestroy,
    get_vcp: FnGetVcp,
    set_vcp: FnSetVcp,
}

unsafe impl Send for Ddc {}

impl Ddc {
    pub fn load() -> std::result::Result<Self, String> {
        unsafe {
            let lib = Library::new("dxva2.dll").map_err(|e| format!("dxva2.dll: {e}"))?;
            macro_rules! sym {
                ($t:ty, $n:literal) => {
                    *lib.get::<$t>($n).map_err(|e| e.to_string())?
                };
            }
            Ok(Self {
                count: sym!(FnCount, b"GetNumberOfPhysicalMonitorsFromHMONITOR\0"),
                get_physical: sym!(FnGetPhysical, b"GetPhysicalMonitorsFromHMONITOR\0"),
                destroy: sym!(FnDestroy, b"DestroyPhysicalMonitors\0"),
                get_vcp: sym!(FnGetVcp, b"GetVCPFeatureAndVCPReply\0"),
                set_vcp: sym!(FnSetVcp, b"SetVCPFeature\0"),
                _lib: lib,
            })
        }
    }

    /// Executa `f` com o primeiro monitor físico ligado a esse nome GDI.
    fn with<T>(&self, display: &str, f: impl FnOnce(Handle) -> Result<T>) -> Result<T> {
        let hmon = hmonitor_for(display).ok_or_else(|| BackendError::Driver("monitor não encontrado".into()))?;
        unsafe {
            let mut n = 0u32;
            if (self.count)(hmon, &mut n) == 0 || n == 0 {
                return Err(BackendError::Unsupported);
            }
            let mut list: Vec<PhysicalMonitor> =
                (0..n).map(|_| PhysicalMonitor { handle: std::ptr::null_mut(), description: [0; 128] }).collect();
            if (self.get_physical)(hmon, n, list.as_mut_ptr()) == 0 {
                return Err(BackendError::Unsupported);
            }
            let r = f(list[0].handle);
            (self.destroy)(n, list.as_ptr());
            r
        }
    }

    fn read_vcp(&self, h: Handle, code: u8) -> Option<(u32, u32)> {
        let (mut kind, mut cur, mut max) = (0u32, 0u32, 0u32);
        // Alguns monitores falham na primeira leitura; tenta de novo uma vez.
        for _ in 0..2 {
            if unsafe { (self.get_vcp)(h, code, &mut kind, &mut cur, &mut max) } != 0 && max > 0 {
                return Some((cur, max));
            }
            std::thread::sleep(std::time::Duration::from_millis(40));
        }
        None
    }
}

impl MonitorHw for Ddc {
    fn read(&mut self, display: &str, control: HwControl) -> Result<(u32, u32)> {
        self.with(display, |h| self.read_vcp(h, control.vcp()).ok_or(BackendError::Unsupported))
    }

    fn write(&mut self, display: &str, control: HwControl, value: u32) -> Result<()> {
        self.with(display, |h| {
            if unsafe { (self.set_vcp)(h, control.vcp(), value) } != 0 {
                Ok(())
            } else {
                Err(BackendError::Driver("o monitor não aceitou o comando DDC/CI".into()))
            }
        })
    }
}
