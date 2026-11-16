//! AMD: saturação de cor via ADL (`atiadlxx.dll`), a mesma opção
//! "Saturação" do AMD Software › Tela › Cor personalizada.

use super::mapping::{level_to_percent, percent_to_level};
use super::{BackendError, DriverVibrance, Result};
use crate::types::DriverKind;
use libloading::Library;
use std::collections::HashMap;
use std::ffi::c_void;

type Ctx = *mut c_void;
type MallocCb = unsafe extern "system" fn(i32) -> *mut c_void;
type FnCreate = unsafe extern "system" fn(MallocCb, i32, *mut Ctx) -> i32;
type FnDestroy = unsafe extern "system" fn(Ctx) -> i32;
type FnNumAdapters = unsafe extern "system" fn(Ctx, *mut i32) -> i32;
type FnAdapterInfo = unsafe extern "system" fn(Ctx, *mut AdapterInfo, i32) -> i32;
type FnDisplayInfo = unsafe extern "system" fn(Ctx, i32, *mut i32, *mut *mut DisplayInfo, i32) -> i32;
type FnColorGet = unsafe extern "system" fn(Ctx, i32, i32, i32, *mut i32, *mut i32, *mut i32, *mut i32, *mut i32) -> i32;
type FnColorSet = unsafe extern "system" fn(Ctx, i32, i32, i32, i32) -> i32;

const ADL_OK: i32 = 0;
const ADL_DISPLAY_COLOR_SATURATION: i32 = 1 << 3;
const DISPLAY_CONNECTED_AND_MAPPED: i32 = 0x1 | 0x2;

#[repr(C)]
struct AdapterInfo {
    size: i32,
    adapter_index: i32,
    udid: [u8; 256],
    bus: i32,
    device: i32,
    function: i32,
    vendor: i32,
    adapter_name: [u8; 256],
    display_name: [u8; 256],
    present: i32,
    exist: i32,
    driver_path: [u8; 256],
    driver_path_ext: [u8; 256],
    pnp: [u8; 256],
    os_display_index: i32,
}

#[repr(C)]
struct DisplayInfo {
    logical_index: i32,
    physical_index: i32,
    logical_adapter_index: i32,
    physical_adapter_index: i32,
    controller_index: i32,
    name: [u8; 256],
    manufacturer: [u8; 256],
    display_type: i32,
    output_type: i32,
    connector: i32,
    info_mask: i32,
    info_value: i32,
}

extern "C" {
    fn malloc(size: usize) -> *mut c_void;
    fn free(p: *mut c_void);
}

unsafe extern "system" fn adl_malloc(size: i32) -> *mut c_void {
    malloc(size.max(0) as usize)
}

fn cstr(b: &[u8]) -> String {
    let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    String::from_utf8_lossy(&b[..end]).into_owned()
}

#[derive(Clone, Copy)]
struct Target {
    adapter: i32,
    display: i32,
}

#[derive(Clone, Copy)]
struct Range {
    current: i32,
    default: i32,
    min: i32,
    max: i32,
}

pub struct Adl {
    _lib: Library,
    ctx: Ctx,
    destroy: FnDestroy,
    num_adapters: FnNumAdapters,
    adapter_info: FnAdapterInfo,
    display_info: FnDisplayInfo,
    color_get: FnColorGet,
    color_set: FnColorSet,
    targets: HashMap<String, Option<(i32, i32)>>,
}

unsafe impl Send for Adl {}

impl Adl {
    pub fn load() -> std::result::Result<Self, String> {
        unsafe {
            let lib = Library::new("atiadlxx.dll").map_err(|e| format!("atiadlxx.dll: {e}"))?;
            macro_rules! sym {
                ($t:ty, $n:literal) => {
                    *lib.get::<$t>($n).map_err(|e| format!("{}: {e}", stringify!($n)))?
                };
            }
            let create: FnCreate = sym!(FnCreate, b"ADL2_Main_Control_Create\0");
            let mut me = Self {
                destroy: sym!(FnDestroy, b"ADL2_Main_Control_Destroy\0"),
                num_adapters: sym!(FnNumAdapters, b"ADL2_Adapter_NumberOfAdapters_Get\0"),
                adapter_info: sym!(FnAdapterInfo, b"ADL2_Adapter_AdapterInfo_Get\0"),
                display_info: sym!(FnDisplayInfo, b"ADL2_Display_DisplayInfo_Get\0"),
                color_get: sym!(FnColorGet, b"ADL2_Display_Color_Get\0"),
                color_set: sym!(FnColorSet, b"ADL2_Display_Color_Set\0"),
                ctx: std::ptr::null_mut(),
                targets: HashMap::new(),
                _lib: lib,
            };
            let st = create(adl_malloc, 1, &mut me.ctx);
            if st != ADL_OK {
                return Err(format!("ADL2_Main_Control_Create retornou {st}"));
            }
            Ok(me)
        }
    }

    fn find(&mut self, display: &str) -> Option<Target> {
        if let Some(t) = self.targets.get(display) {
            return t.map(|(a, d)| Target { adapter: a, display: d });
        }
        let found = unsafe { self.search(display) };
        self.targets.insert(display.to_string(), found.map(|t| (t.adapter, t.display)));
        found
    }

    unsafe fn search(&mut self, display: &str) -> Option<Target> {
        let mut n = 0;
        if (self.num_adapters)(self.ctx, &mut n) != ADL_OK || n <= 0 {
            return None;
        }
        let mut infos: Vec<AdapterInfo> = (0..n).map(|_| std::mem::zeroed()).collect();
        let size = (std::mem::size_of::<AdapterInfo>() * n as usize) as i32;
        for i in infos.iter_mut() {
            i.size = std::mem::size_of::<AdapterInfo>() as i32;
        }
        if (self.adapter_info)(self.ctx, infos.as_mut_ptr(), size) != ADL_OK {
            return None;
        }
        for a in infos.iter().filter(|a| a.present != 0) {
            if !cstr(&a.display_name).eq_ignore_ascii_case(display) {
                continue;
            }
            let mut count = 0;
            let mut list: *mut DisplayInfo = std::ptr::null_mut();
            if (self.display_info)(self.ctx, a.adapter_index, &mut count, &mut list, 0) != ADL_OK || list.is_null() {
                continue;
            }
            let displays = std::slice::from_raw_parts(list, count.max(0) as usize);
            let hit = displays.iter().find(|d| {
                d.info_value & DISPLAY_CONNECTED_AND_MAPPED == DISPLAY_CONNECTED_AND_MAPPED
                    && d.logical_adapter_index == a.adapter_index
            });
            let t = hit.map(|d| Target { adapter: a.adapter_index, display: d.logical_index });
            free(list as *mut c_void);
            if let Some(t) = t {
                if self.range(t).is_some() {
                    return Some(t);
                }
            }
        }
        None
    }

    fn range(&self, t: Target) -> Option<Range> {
        let (mut cur, mut def, mut min, mut max, mut step) = (0, 0, 0, 0, 0);
        let st = unsafe {
            (self.color_get)(
                self.ctx, t.adapter, t.display, ADL_DISPLAY_COLOR_SATURATION,
                &mut cur, &mut def, &mut min, &mut max, &mut step,
            )
        };
        (st == ADL_OK && max > min).then_some(Range { current: cur, default: def.clamp(min, max), min, max })
    }
}

impl Drop for Adl {
    fn drop(&mut self) {
        unsafe {
            (self.destroy)(self.ctx);
        }
    }
}

impl DriverVibrance for Adl {
    fn kind(&self) -> DriverKind {
        DriverKind::Amd
    }
    fn supports(&mut self, display: &str) -> bool {
        self.find(display).is_some()
    }
    fn get(&mut self, display: &str) -> Result<u8> {
        let t = self.find(display).ok_or(BackendError::Unsupported)?;
        let r = self.range(t).ok_or_else(|| BackendError::Driver("não foi possível ler a saturação".into()))?;
        Ok(level_to_percent(r.current, r.min, r.default, r.max))
    }
    fn set(&mut self, display: &str, percent: u8) -> Result<()> {
        let t = self.find(display).ok_or(BackendError::Unsupported)?;
        let r = self.range(t).ok_or_else(|| BackendError::Driver("não foi possível ler a saturação".into()))?;
        let lvl = percent_to_level(percent, r.min, r.default, r.max);
        let st = unsafe { (self.color_set)(self.ctx, t.adapter, t.display, ADL_DISPLAY_COLOR_SATURATION, lvl) };
        if st == ADL_OK { Ok(()) } else { Err(BackendError::Driver(format!("ADL2_Display_Color_Set retornou {st}"))) }
    }
    fn default_percent(&mut self, _display: &str) -> Option<u8> {
        Some(50)
    }
}
