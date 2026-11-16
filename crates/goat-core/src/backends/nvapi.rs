//! NVIDIA: Digital Vibrance Control (DVC) via `nvapi64.dll`.
//!
//! É a mesma configuração do "Ajustar configurações de cor da área de trabalho"
//! do Painel de Controle da NVIDIA. As funções são obtidas por
//! `nvapi_QueryInterface` com os IDs públicos de `nvapi_interface.h`.

use super::mapping::{level_to_percent, percent_to_level};
use super::{BackendError, DriverVibrance, Result};
use crate::types::DriverKind;
use libloading::Library;
use std::collections::HashMap;
use std::ffi::{c_void, CString};

type NvHandle = *mut c_void;
type QueryInterface = unsafe extern "C" fn(u32) -> *const c_void;
type FnInit = unsafe extern "C" fn() -> i32;
type FnAssoc = unsafe extern "C" fn(*const i8, *mut NvHandle) -> i32;
type FnGetEx = unsafe extern "C" fn(NvHandle, u32, *mut DvcInfoEx) -> i32;
type FnSetEx = unsafe extern "C" fn(NvHandle, u32, *mut DvcInfoEx) -> i32;
type FnGet = unsafe extern "C" fn(NvHandle, u32, *mut DvcInfo) -> i32;
type FnSet = unsafe extern "C" fn(NvHandle, u32, u32) -> i32;

const ID_INITIALIZE: u32 = 0x0150_E828;
const ID_GET_ASSOCIATED_DISPLAY: u32 = 0x35C2_9134;
const ID_GET_DVC_INFO_EX: u32 = 0x0E45_002D;
const ID_SET_DVC_LEVEL_EX: u32 = 0x4A82_C2B1;
const ID_GET_DVC_INFO: u32 = 0x4085_DE45;
const ID_SET_DVC_LEVEL: u32 = 0x1724_09B4;

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct DvcInfoEx {
    version: u32,
    current: i32,
    min: i32,
    max: i32,
    default: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct DvcInfo {
    version: u32,
    current: u32,
    min: u32,
    max: u32,
}

const fn make_version<T>(v: u32) -> u32 {
    std::mem::size_of::<T>() as u32 | (v << 16)
}

pub struct NvApi {
    _lib: Library,
    assoc: FnAssoc,
    get_ex: Option<FnGetEx>,
    set_ex: Option<FnSetEx>,
    get: Option<FnGet>,
    set: Option<FnSet>,
    handles: HashMap<String, Option<usize>>,
}

// Os ponteiros de função e handles do NVAPI podem ser usados de qualquer thread;
// o acesso é serializado pelo Mutex do Engine.
unsafe impl Send for NvApi {}

impl NvApi {
    pub fn load() -> std::result::Result<Self, String> {
        unsafe {
            let lib = Library::new("nvapi64.dll").map_err(|e| format!("nvapi64.dll: {e}"))?;
            let qi: QueryInterface = *lib
                .get::<QueryInterface>(b"nvapi_QueryInterface\0")
                .map_err(|e| e.to_string())?;
            let f = |id: u32| {
                let p = qi(id);
                if p.is_null() { None } else { Some(p) }
            };
            let init: FnInit = std::mem::transmute(f(ID_INITIALIZE).ok_or("NvAPI_Initialize ausente")?);
            let st = init();
            if st != 0 {
                return Err(format!("NvAPI_Initialize retornou {st}"));
            }
            let assoc: FnAssoc =
                std::mem::transmute(f(ID_GET_ASSOCIATED_DISPLAY).ok_or("GetAssociatedNvidiaDisplayHandle ausente")?);
            let me = Self {
                assoc,
                get_ex: f(ID_GET_DVC_INFO_EX).map(|p| std::mem::transmute::<_, FnGetEx>(p)),
                set_ex: f(ID_SET_DVC_LEVEL_EX).map(|p| std::mem::transmute::<_, FnSetEx>(p)),
                get: f(ID_GET_DVC_INFO).map(|p| std::mem::transmute::<_, FnGet>(p)),
                set: f(ID_SET_DVC_LEVEL).map(|p| std::mem::transmute::<_, FnSet>(p)),
                handles: HashMap::new(),
                _lib: lib,
            };
            if me.get_ex.is_none() && me.get.is_none() {
                return Err("funções de Digital Vibrance ausentes neste driver".into());
            }
            Ok(me)
        }
    }

    fn handle(&mut self, display: &str) -> Option<NvHandle> {
        if let Some(h) = self.handles.get(display) {
            return h.map(|v| v as NvHandle);
        }
        let name = CString::new(display).ok()?;
        let mut h: NvHandle = std::ptr::null_mut();
        let st = unsafe { (self.assoc)(name.as_ptr(), &mut h) };
        let v = (st == 0 && !h.is_null()).then_some(h as usize);
        self.handles.insert(display.to_string(), v);
        v.map(|v| v as NvHandle)
    }

    fn read_ex(&mut self, h: NvHandle) -> Option<DvcInfoEx> {
        let f = self.get_ex?;
        let mut info = DvcInfoEx { version: make_version::<DvcInfoEx>(1), ..Default::default() };
        (unsafe { f(h, 0, &mut info) } == 0).then_some(info)
    }

    fn read_legacy(&mut self, h: NvHandle) -> Option<DvcInfo> {
        let f = self.get?;
        let mut info = DvcInfo { version: make_version::<DvcInfo>(1), ..Default::default() };
        (unsafe { f(h, 0, &mut info) } == 0).then_some(info)
    }
}

impl DriverVibrance for NvApi {
    fn kind(&self) -> DriverKind {
        DriverKind::Nvidia
    }

    fn supports(&mut self, display: &str) -> bool {
        match self.handle(display) {
            Some(h) => self.read_ex(h).is_some() || self.read_legacy(h).is_some(),
            None => false,
        }
    }

    fn get(&mut self, display: &str) -> Result<u8> {
        let h = self.handle(display).ok_or(BackendError::Unsupported)?;
        if let Some(i) = self.read_ex(h) {
            return Ok(level_to_percent(i.current, i.min, i.default.clamp(i.min, i.max), i.max));
        }
        if let Some(i) = self.read_legacy(h) {
            return Ok(level_to_percent(i.current as i32, i.min as i32, i.min as i32, i.max as i32));
        }
        Err(BackendError::Driver("não foi possível ler o Digital Vibrance".into()))
    }

    fn set(&mut self, display: &str, percent: u8) -> Result<()> {
        let h = self.handle(display).ok_or(BackendError::Unsupported)?;
        if let (Some(mut i), Some(set_ex)) = (self.read_ex(h), self.set_ex) {
            i.current = percent_to_level(percent, i.min, i.default.clamp(i.min, i.max), i.max);
            let st = unsafe { set_ex(h, 0, &mut i) };
            return if st == 0 { Ok(()) } else { Err(BackendError::Driver(format!("NvAPI_SetDVCLevelEx retornou {st}"))) };
        }
        if let (Some(i), Some(set)) = (self.read_legacy(h), self.set) {
            let lvl = percent_to_level(percent, i.min as i32, i.min as i32, i.max as i32);
            let st = unsafe { set(h, 0, lvl as u32) };
            return if st == 0 { Ok(()) } else { Err(BackendError::Driver(format!("NvAPI_SetDVCLevel retornou {st}"))) };
        }
        Err(BackendError::Driver("Digital Vibrance não suportado".into()))
    }

    fn default_percent(&mut self, _display: &str) -> Option<u8> {
        // No painel da NVIDIA o padrão é sempre 50% (nível neutro).
        Some(50)
    }
}
