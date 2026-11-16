//! Camada Super via perfil de cor MHC2 (Windows 11).
//!
//! A cada valor, gera um perfil ICC com a matriz de saturação, instala no
//! Windows e define como padrão do monitor (escopo do usuário). Para desligar,
//! devolve exatamente a configuração anterior do usuário.
//!
//! Diferente da Magnificação, o perfil continua ativo se o app travar. Por isso
//! o estado fica em `mhc2.json` e é desfeito na próxima abertura.
//!
//! Todas as funções do `mscms.dll` são carregadas dinamicamente para o app
//! continuar abrindo em versões do Windows que não as têm.

use super::icc::{build_mhc2_profile, saturation_matrix_xyz};
use super::{BackendError, Result, SuperLayer};
use crate::monitors::{display_target, monitor_interface_name, Target};
use crate::types::SuperMethod;
use libloading::Library;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

type Pcwstr = *const u16;
type FnAdd = unsafe extern "system" fn(i32, Pcwstr, Luid, u32, i32, i32) -> i32;
type FnRemove = unsafe extern "system" fn(i32, Pcwstr, Luid, u32, i32) -> i32;
type FnSetDefault = unsafe extern "system" fn(i32, Pcwstr, i32, i32, Luid, u32) -> i32;
type FnGetDefault = unsafe extern "system" fn(i32, Luid, u32, i32, i32, *mut *mut u16) -> i32;
type FnInstall = unsafe extern "system" fn(Pcwstr, Pcwstr) -> i32;
type FnUninstall = unsafe extern "system" fn(Pcwstr, Pcwstr, i32) -> i32;
type FnSetPerUser = unsafe extern "system" fn(Pcwstr, u32, i32) -> i32;
type FnGetPerUser = unsafe extern "system" fn(Pcwstr, u32, *mut i32) -> i32;

const SCOPE_USER: i32 = 1;
const CPT_ICC: i32 = 0;
const CPST_STANDARD_DISPLAY: i32 = 7;
const CLASS_MONITOR: u32 = u32::from_be_bytes(*b"mntr");

#[repr(C)]
#[derive(Clone, Copy)]
struct Luid {
    low: u32,
    high: i32,
}

impl From<Target> for Luid {
    fn from(t: Target) -> Self {
        Luid { low: t.adapter_low, high: t.adapter_high }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    /// Nome do perfil do Goat Filter instalado agora.
    ours: String,
    /// Perfil padrão do usuário antes do Goat Filter (se havia).
    previous: Option<String>,
    /// "Usar minhas configurações para este dispositivo" estava ligado?
    per_user_was: bool,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn hr(code: i32, what: &str) -> Result<()> {
    if code >= 0 { Ok(()) } else { Err(BackendError::Driver(format!("{what} falhou (0x{:08X})", code as u32))) }
}

extern "system" {
    fn LocalFree(p: *mut core::ffi::c_void) -> *mut core::ffi::c_void;
}

pub struct Mhc2 {
    _lib: Library,
    add: FnAdd,
    remove: FnRemove,
    set_default: FnSetDefault,
    get_default: FnGetDefault,
    install: FnInstall,
    uninstall: FnUninstall,
    set_per_user: FnSetPerUser,
    get_per_user: FnGetPerUser,
    dir: PathBuf,
    active: BTreeMap<String, Entry>,
}

unsafe impl Send for Mhc2 {}

impl Mhc2 {
    pub fn start(dir: PathBuf) -> std::result::Result<Self, String> {
        let build = crate::monitors::windows_build();
        if build < 22000 {
            return Err("requer Windows 11".into());
        }
        unsafe {
            let lib = Library::new("mscms.dll").map_err(|e| format!("mscms.dll: {e}"))?;
            macro_rules! sym {
                ($t:ty, $n:literal) => {
                    *lib.get::<$t>($n).map_err(|_| format!("{} ausente", String::from_utf8_lossy(&$n[..$n.len() - 1])))?
                };
            }
            let mut me = Self {
                add: sym!(FnAdd, b"ColorProfileAddDisplayAssociation\0"),
                remove: sym!(FnRemove, b"ColorProfileRemoveDisplayAssociation\0"),
                set_default: sym!(FnSetDefault, b"ColorProfileSetDisplayDefaultAssociation\0"),
                get_default: sym!(FnGetDefault, b"ColorProfileGetDisplayDefault\0"),
                install: sym!(FnInstall, b"InstallColorProfileW\0"),
                uninstall: sym!(FnUninstall, b"UninstallColorProfileW\0"),
                set_per_user: sym!(FnSetPerUser, b"WcsSetUsePerUserProfiles\0"),
                get_per_user: sym!(FnGetPerUser, b"WcsGetUsePerUserProfiles\0"),
                _lib: lib,
                active: BTreeMap::new(),
                dir,
            };
            std::fs::create_dir_all(&me.dir).map_err(|e| e.to_string())?;
            me.recover();
            Ok(me)
        }
    }

    fn state_path(&self) -> PathBuf {
        self.dir.join("mhc2.json")
    }

    fn save(&self) {
        if self.active.is_empty() {
            let _ = std::fs::remove_file(self.state_path());
        } else if let Ok(s) = serde_json::to_string_pretty(&self.active) {
            let _ = std::fs::write(self.state_path(), s);
        }
    }

    /// Desfaz perfis que ficaram de uma execução que não terminou direito.
    fn recover(&mut self) {
        let left: BTreeMap<String, Entry> = std::fs::read_to_string(self.state_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        for (display, entry) in left {
            self.active.insert(display.clone(), entry);
            if let Err(e) = self.clear(&display) {
                log::warn!("MHC2: não foi possível desfazer {display}: {e}");
            }
        }
        self.active.clear();
        self.save();
    }

    fn profile_name(display: &str, factor: f32) -> String {
        let tag: String = display.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
        format!("GoatFilter_{}_{}.icm", tag, (factor * 100.0).round() as i32)
    }

    unsafe fn read_default(&self, t: Target) -> Option<String> {
        let mut out: *mut u16 = std::ptr::null_mut();
        let st = (self.get_default)(SCOPE_USER, t.into(), t.source_id, CPT_ICC, CPST_STANDARD_DISPLAY, &mut out);
        if st < 0 || out.is_null() {
            return None;
        }
        let len = (0..).take_while(|&i| *out.add(i) != 0).count();
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(out, len));
        LocalFree(out as _);
        (!s.is_empty()).then_some(s)
    }

    fn set(&mut self, display: &str, factor: f32) -> Result<()> {
        let t = display_target(display).ok_or_else(|| BackendError::Driver("monitor não encontrado".into()))?;
        let iface = monitor_interface_name(display);
        let name = Self::profile_name(display, factor);
        if self.active.get(display).map(|e| e.ours == name).unwrap_or(false) {
            return Ok(());
        }

        let bytes = build_mhc2_profile(&format!("Goat Filter {}%", (factor * 100.0).round()), saturation_matrix_xyz(factor as f64));
        let path = self.dir.join(&name);
        std::fs::write(&path, bytes).map_err(|e| BackendError::Driver(format!("gravar perfil: {e}")))?;

        unsafe {
            if (self.install)(std::ptr::null(), wide(&path.to_string_lossy()).as_ptr()) == 0 {
                return Err(BackendError::Driver("o Windows não instalou o perfil de cor".into()));
            }
            let first = !self.active.contains_key(display);
            let mut entry = self.active.get(display).cloned().unwrap_or(Entry { ours: String::new(), previous: None, per_user_was: true });
            if first {
                if let Some(dev) = &iface {
                    let w = wide(dev);
                    let mut on = 0;
                    if (self.get_per_user)(w.as_ptr(), CLASS_MONITOR, &mut on) != 0 {
                        entry.per_user_was = on != 0;
                    }
                    if on == 0 {
                        (self.set_per_user)(w.as_ptr(), CLASS_MONITOR, 1);
                    }
                }
                entry.previous = if entry.per_user_was { self.read_default(t) } else { None };
            }

            let wname = wide(&name);
            hr((self.add)(SCOPE_USER, wname.as_ptr(), t.into(), t.source_id, 1, 0), "associar perfil")?;

            let old = std::mem::replace(&mut entry.ours, name);
            if !old.is_empty() {
                let w = wide(&old);
                (self.remove)(SCOPE_USER, w.as_ptr(), t.into(), t.source_id, 0);
                (self.uninstall)(std::ptr::null(), w.as_ptr(), 1);
            }
            self.active.insert(display.to_string(), entry);
        }
        self.save();
        Ok(())
    }

    fn clear(&mut self, display: &str) -> Result<()> {
        let Some(entry) = self.active.get(display).cloned() else { return Ok(()) };
        let t = display_target(display);
        unsafe {
            if let Some(t) = t {
                if let Some(prev) = &entry.previous {
                    let w = wide(prev);
                    let _ = (self.set_default)(SCOPE_USER, w.as_ptr(), CPT_ICC, CPST_STANDARD_DISPLAY, t.into(), t.source_id);
                }
                let w = wide(&entry.ours);
                (self.remove)(SCOPE_USER, w.as_ptr(), t.into(), t.source_id, 0);
            }
            if !entry.per_user_was {
                if let Some(dev) = monitor_interface_name(display) {
                    (self.set_per_user)(wide(&dev).as_ptr(), CLASS_MONITOR, 0);
                }
            }
            (self.uninstall)(std::ptr::null(), wide(&entry.ours).as_ptr(), 1);
        }
        let _ = std::fs::remove_file(self.dir.join(&entry.ours));
        self.active.remove(display);
        self.save();
        if t.is_none() {
            return Err(BackendError::Driver("monitor desconectado; perfil removido da lista".into()));
        }
        Ok(())
    }
}

impl SuperLayer for Mhc2 {
    fn method(&self) -> SuperMethod {
        SuperMethod::Mhc2
    }

    fn apply(&mut self, factors: &BTreeMap<String, f32>) -> Result<()> {
        let mut first_err = None;
        let gone: Vec<String> = self.active.keys().filter(|d| !factors.contains_key(*d)).cloned().collect();
        for d in gone {
            if let Err(e) = self.clear(&d) {
                first_err.get_or_insert(e);
            }
        }
        for (d, f) in factors {
            let r = if (f - 1.0).abs() < 1e-3 { self.clear(d) } else { self.set(d, *f) };
            if let Err(e) = r {
                first_err.get_or_insert(e);
            }
        }
        first_err.map_or(Ok(()), Err)
    }
}

impl Drop for Mhc2 {
    fn drop(&mut self) {
        let _ = self.apply(&BTreeMap::new());
    }
}
