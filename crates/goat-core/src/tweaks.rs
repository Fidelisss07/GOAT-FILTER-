//! Aba Desempenho (parte 2): taxa do monitor, gravação em segundo plano do
//! Xbox (Game DVR), agendamento de GPU por hardware (HAGS), apps pesados e o
//! painel da máquina. Nada aqui abre ou mexe no processo do jogo.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Modo de vídeo atual de um monitor e as taxas possíveis nessa resolução.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMode {
    pub width: u32,
    pub height: u32,
    pub hz: u32,
    pub max_hz: u32,
    pub rates: Vec<u32>,
}

/// Taxas disponíveis na resolução atual (ordem crescente, sem repetir).
pub fn rates_for(modes: &[(u32, u32, u32)], width: u32, height: u32) -> Vec<u32> {
    let mut r: Vec<u32> = modes
        .iter()
        .filter(|(w, h, hz)| *w == width && *h == height && *hz > 1)
        .map(|m| m.2)
        .collect();
    r.sort_unstable();
    r.dedup();
    r
}

/// Uma resolução para jogar esticado (ex.: 1280x960 em 4:3).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
    pub max_hz: u32,
    /// "4:3", "5:4", "16:10"…
    pub aspect: String,
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// Proporção comum mais próxima (1280x1024 = 5:4, 1440x1080 = 4:3, 1366x768 ≈ 16:9).
pub fn aspect_label(w: u32, h: u32) -> String {
    if h == 0 {
        return String::new();
    }
    let r = w as f64 / h as f64;
    for (label, v) in [("4:3", 4.0 / 3.0), ("5:4", 1.25), ("16:10", 1.6), ("16:9", 16.0 / 9.0), ("3:2", 1.5), ("21:9", 64.0 / 27.0)] {
        if (r - v).abs() < 0.02 {
            return label.to_string();
        }
    }
    let g = gcd(w, h).max(1);
    format!("{}:{}", w / g, h / g)
}

/// Resoluções boas para esticar: menores que a nativa e com outra proporção
/// (4:3 primeiro, que é o mais usado), sem repetir, cada uma com a maior taxa.
pub fn stretch_choices(modes: &[(u32, u32, u32)], native: (u32, u32)) -> Vec<Resolution> {
    let native_aspect = aspect_label(native.0, native.1);
    let mut out: Vec<Resolution> = Vec::new();
    for &(w, h, hz) in modes {
        if w < 800 || h < 600 || h > native.1 || w > native.0 {
            continue;
        }
        let aspect = aspect_label(w, h);
        if aspect == native_aspect {
            continue;
        }
        match out.iter_mut().find(|r| r.width == w && r.height == h) {
            Some(r) => r.max_hz = r.max_hz.max(hz),
            None => out.push(Resolution { width: w, height: h, max_hz: hz, aspect }),
        }
    }
    let rank = |a: &str| match a {
        "4:3" => 0,
        "5:4" => 1,
        "16:10" => 2,
        _ => 3,
    };
    out.sort_by(|a, b| rank(&a.aspect).cmp(&rank(&b.aspect)).then(b.height.cmp(&a.height)));
    out
}

/// Programas comuns que pesam enquanto se joga (nome do .exe, nome exibido).
pub const HEAVY_APPS: &[(&str, &str)] = &[
    ("chrome.exe", "Google Chrome"),
    ("msedge.exe", "Microsoft Edge"),
    ("firefox.exe", "Firefox"),
    ("opera.exe", "Opera"),
    ("brave.exe", "Brave"),
    ("onedrive.exe", "OneDrive"),
    ("dropbox.exe", "Dropbox"),
    ("googledrivefs.exe", "Google Drive"),
    ("teams.exe", "Microsoft Teams"),
    ("ms-teams.exe", "Microsoft Teams"),
    ("epicgameslauncher.exe", "Epic Games Launcher"),
    ("eadesktop.exe", "EA app"),
    ("battle.net.exe", "Battle.net"),
    ("obs64.exe", "OBS Studio"),
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeavyApp {
    pub exe: String,
    pub name: String,
    pub running: bool,
}

/// Lista os apps pesados conhecidos, marcando os que estão abertos agora.
pub fn heavy_apps(running: &HashSet<String>) -> Vec<HeavyApp> {
    let mut seen = HashSet::new();
    HEAVY_APPS
        .iter()
        .filter(|(exe, _)| seen.insert(*exe))
        .map(|(exe, name)| HeavyApp { exe: exe.to_string(), name: name.to_string(), running: running.contains(*exe) })
        .collect()
}

/// Só deixa fechar nomes da lista conhecida (nunca o jogo ou o sistema).
pub fn closable(names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|n| n.to_lowercase())
        .filter(|n| HEAVY_APPS.iter().any(|(exe, _)| exe == n))
        .collect()
}

/// Uso de CPU entre duas amostras de GetSystemTimes (idle, kernel, user).
/// Kernel inclui o tempo ocioso.
pub fn cpu_usage(prev: (u64, u64, u64), now: (u64, u64, u64)) -> Option<f32> {
    let idle = now.0.checked_sub(prev.0)?;
    let total = now.1.checked_sub(prev.1)? + now.2.checked_sub(prev.2)?;
    if total == 0 {
        return None;
    }
    Some(((1.0 - idle as f64 / total as f64) * 100.0).clamp(0.0, 100.0) as f32)
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemStats {
    pub cpu_usage: Option<f32>,
    pub ram_used_gb: Option<f32>,
    pub ram_total_gb: Option<f32>,
    pub gpu_name: Option<String>,
    pub gpu_usage: Option<u32>,
    pub gpu_temp: Option<u32>,
    pub vram_used_gb: Option<f32>,
    pub vram_total_gb: Option<f32>,
}

/// Estado dos ajustes do Windows mostrados na aba Desempenho.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsTweaks {
    /// Gravação em segundo plano do Xbox ligada?
    pub game_dvr: Option<bool>,
    /// Agendamento de GPU por hardware ligado?
    pub hags: Option<bool>,
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use super::*;
    use std::path::Path;
    use std::os::windows::process::CommandExt;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, FILETIME};
    use windows::Win32::Graphics::Gdi::{
        ChangeDisplaySettingsExW, EnumDisplaySettingsW, CDS_UPDATEREGISTRY, DEVMODEW, DISP_CHANGE_SUCCESSFUL,
        DM_DISPLAYFREQUENCY, DM_PELSHEIGHT, DM_PELSWIDTH, ENUM_CURRENT_SETTINGS, ENUM_DISPLAY_SETTINGS_MODE,
    };
    use windows::Win32::System::Registry::{
        RegGetValueW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_DWORD, RRF_RT_REG_DWORD,
    };
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::GetSystemTimes;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(Some(0)).collect()
    }

    fn devmode() -> DEVMODEW {
        DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() }
    }

    pub fn display_mode(gdi: &str) -> Option<DisplayMode> {
        let name = wide(gdi);
        let mut cur = devmode();
        unsafe {
            if !EnumDisplaySettingsW(PCWSTR(name.as_ptr()), ENUM_CURRENT_SETTINGS, &mut cur).as_bool() {
                return None;
            }
            let mut modes = Vec::new();
            let mut i = 0u32;
            loop {
                let mut m = devmode();
                if !EnumDisplaySettingsW(PCWSTR(name.as_ptr()), ENUM_DISPLAY_SETTINGS_MODE(i), &mut m).as_bool() {
                    break;
                }
                modes.push((m.dmPelsWidth, m.dmPelsHeight, m.dmDisplayFrequency));
                i += 1;
                if i > 4000 {
                    break;
                }
            }
            let rates = rates_for(&modes, cur.dmPelsWidth, cur.dmPelsHeight);
            let max_hz = rates.last().copied().unwrap_or(cur.dmDisplayFrequency);
            Some(DisplayMode {
                width: cur.dmPelsWidth,
                height: cur.dmPelsHeight,
                hz: cur.dmDisplayFrequency,
                max_hz,
                rates,
            })
        }
    }

    /// Resolução atual do monitor (rápido: não lista os modos).
    pub fn current_size(gdi: &str) -> Option<(u32, u32)> {
        let name = wide(gdi);
        let mut m = devmode();
        unsafe { EnumDisplaySettingsW(PCWSTR(name.as_ptr()), ENUM_CURRENT_SETTINGS, &mut m).as_bool() }
            .then_some((m.dmPelsWidth, m.dmPelsHeight))
    }

    /// Todos os modos de vídeo do monitor (largura, altura, Hz).
    pub fn all_modes(gdi: &str) -> Vec<(u32, u32, u32)> {
        let name = wide(gdi);
        let mut modes = Vec::new();
        unsafe {
            let mut i = 0u32;
            loop {
                let mut m = devmode();
                if !EnumDisplaySettingsW(PCWSTR(name.as_ptr()), ENUM_DISPLAY_SETTINGS_MODE(i), &mut m).as_bool() || i > 4000 {
                    break;
                }
                modes.push((m.dmPelsWidth, m.dmPelsHeight, m.dmDisplayFrequency));
                i += 1;
            }
        }
        modes
    }

    /// Resolução temporária (não fica salva no Windows) com a imagem esticada
    /// pela placa de vídeo. Volta com `reset_resolution`.
    pub fn set_resolution(gdi: &str, width: u32, height: u32, hz: u32) -> Result<(), String> {
        use windows::Win32::Graphics::Gdi::{CDS_FULLSCREEN, DMDFO_STRETCH, DM_DISPLAYFIXEDOUTPUT};
        let name = wide(gdi);
        let mut m = devmode();
        m.dmPelsWidth = width;
        m.dmPelsHeight = height;
        m.dmDisplayFrequency = hz;
        m.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_DISPLAYFIXEDOUTPUT;
        m.Anonymous1.Anonymous2.dmDisplayFixedOutput = DMDFO_STRETCH;
        unsafe {
            let mut r = ChangeDisplaySettingsExW(PCWSTR(name.as_ptr()), Some(&m), None, CDS_FULLSCREEN, None);
            if r != DISP_CHANGE_SUCCESSFUL {
                // Alguns drivers não aceitam pedir o "esticar": tenta só a resolução.
                m.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
                r = ChangeDisplaySettingsExW(PCWSTR(name.as_ptr()), Some(&m), None, CDS_FULLSCREEN, None);
            }
            if r == DISP_CHANGE_SUCCESSFUL {
                Ok(())
            } else {
                Err(format!("o Windows recusou {width}x{height} (código {})", r.0))
            }
        }
    }

    /// Volta o monitor à resolução salva no Windows.
    pub fn reset_resolution(gdi: &str) -> Result<(), String> {
        let name = wide(gdi);
        let r = unsafe { ChangeDisplaySettingsExW(PCWSTR(name.as_ptr()), None, None, Default::default(), None) };
        if r == DISP_CHANGE_SUCCESSFUL { Ok(()) } else { Err(format!("código {}", r.0)) }
    }

    pub fn set_refresh(gdi: &str, hz: u32) -> Result<(), String> {
        let name = wide(gdi);
        let mut m = devmode();
        unsafe {
            if !EnumDisplaySettingsW(PCWSTR(name.as_ptr()), ENUM_CURRENT_SETTINGS, &mut m).as_bool() {
                return Err("monitor não encontrado".into());
            }
            m.dmDisplayFrequency = hz;
            m.dmFields = DM_DISPLAYFREQUENCY | DM_PELSWIDTH | DM_PELSHEIGHT;
            let r = ChangeDisplaySettingsExW(PCWSTR(name.as_ptr()), Some(&m), None, CDS_UPDATEREGISTRY, None);
            if r == DISP_CHANGE_SUCCESSFUL {
                Ok(())
            } else {
                Err(format!("o Windows recusou {hz} Hz (código {})", r.0))
            }
        }
    }

    fn get_dword(root: HKEY, key: PCWSTR, value: PCWSTR) -> Option<u32> {
        let mut v = 0u32;
        let mut len = 4u32;
        let r = unsafe { RegGetValueW(root, key, value, RRF_RT_REG_DWORD, None, Some(&mut v as *mut u32 as _), Some(&mut len)) };
        (r == ERROR_SUCCESS).then_some(v)
    }

    fn set_dword(key: PCWSTR, value: PCWSTR, v: u32) -> Result<(), String> {
        let r = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key, value, REG_DWORD.0, Some(&v as *const u32 as _), 4) };
        if r == ERROR_SUCCESS { Ok(()) } else { Err(format!("erro {}", r.0)) }
    }

    pub fn game_dvr() -> Option<bool> {
        let dvr = get_dword(HKEY_CURRENT_USER, w!(r"System\GameConfigStore"), w!("GameDVR_Enabled"));
        let capture = get_dword(
            HKEY_CURRENT_USER,
            w!(r"Software\Microsoft\Windows\CurrentVersion\GameDVR"),
            w!("AppCaptureEnabled"),
        );
        // Sem os valores gravados, o Windows usa o padrão: ligado.
        Some(dvr.unwrap_or(1) != 0 && capture.unwrap_or(1) != 0)
    }

    pub fn set_game_dvr(on: bool) -> Result<(), String> {
        let v = on as u32;
        set_dword(w!(r"System\GameConfigStore"), w!("GameDVR_Enabled"), v)?;
        set_dword(w!(r"Software\Microsoft\Windows\CurrentVersion\GameDVR"), w!("AppCaptureEnabled"), v)
    }

    pub fn hags() -> Option<bool> {
        get_dword(HKEY_LOCAL_MACHINE, w!(r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers"), w!("HwSchMode"))
            .map(|v| v == 2)
    }

    /// HAGS fica em HKLM: pede permissão de administrador (janela do Windows).
    pub fn request_hags(on: bool) -> Result<(), String> {
        let args = format!(
            r#"add "HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" /v HwSchMode /t REG_DWORD /d {} /f"#,
            if on { 2 } else { 1 }
        );
        let a = wide(&args);
        let r = unsafe { ShellExecuteW(None, w!("runas"), w!("reg.exe"), PCWSTR(a.as_ptr()), PCWSTR::null(), SW_HIDE) };
        if r.0 as isize > 32 { Ok(()) } else { Err("permissão de administrador negada".into()) }
    }

    /// Fecha com calma (como clicar no X), sem forçar.
    /// Caminho completo dos processos com esses nomes (para reabrir depois).
    pub fn running_paths(names: &[String]) -> Vec<String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let wanted: Vec<String> = closable(names).into_iter().map(|n| n.to_lowercase()).collect();
        let mut out: Vec<String> = Vec::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            let mut ok = Process32FirstW(snap, &mut e).is_ok();
            while ok {
                let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase();
                if wanted.contains(&name) {
                    if let Ok(h) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, e.th32ProcessID) {
                        let mut buf = [0u16; 1024];
                        let mut size = buf.len() as u32;
                        if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut size).is_ok() {
                            let p = String::from_utf16_lossy(&buf[..size as usize]);
                            if !out.iter().any(|x| x.eq_ignore_ascii_case(&p)) {
                                out.push(p);
                            }
                        }
                        let _ = CloseHandle(h);
                    }
                }
                ok = Process32NextW(snap, &mut e).is_ok();
            }
            let _ = CloseHandle(snap);
        }
        // Um por app: o primeiro caminho de cada nome.
        let mut seen = Vec::new();
        out.retain(|p| {
            let n = Path::new(p).file_name().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if seen.contains(&n) {
                false
            } else {
                seen.push(n);
                true
            }
        });
        out
    }

    /// Reabre apps fechados ao jogar (minimizados quando o app aceita).
    pub fn reopen(paths: &[String]) -> usize {
        let mut n = 0;
        for p in paths {
            let path = Path::new(p);
            if !path.is_file() || path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("exe")) != Some(true) {
                continue;
            }
            let mut cmd = std::process::Command::new(path);
            if let Some(dir) = path.parent() {
                cmd.current_dir(dir);
            }
            if cmd.spawn().is_ok() {
                n += 1;
            }
        }
        n
    }

    pub fn close_apps(names: &[String]) -> usize {
        let mut n = 0;
        for exe in closable(names) {
            let ok = std::process::Command::new("taskkill")
                .args(["/IM", &exe])
                .creation_flags(CREATE_NO_WINDOW)
                .status()
                .map(|s| s.success())
                .unwrap_or(false);
            if ok {
                n += 1;
            }
        }
        n
    }

    pub fn cpu_times() -> Option<(u64, u64, u64)> {
        let (mut i, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
        unsafe { GetSystemTimes(Some(&mut i), Some(&mut k), Some(&mut u)).ok()? };
        let f = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
        Some((f(i), f(k), f(u)))
    }

    pub fn ram() -> Option<(f32, f32)> {
        let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        unsafe { GlobalMemoryStatusEx(&mut m).ok()? };
        let gb = |b: u64| b as f32 / 1024.0 / 1024.0 / 1024.0;
        Some((gb(m.ullTotalPhys - m.ullAvailPhys), gb(m.ullTotalPhys)))
    }
}

#[cfg(windows)]
pub use win::{current_size, all_modes, reset_resolution, set_resolution, close_apps, reopen, running_paths, display_mode, game_dvr, hags, request_hags, set_game_dvr, set_refresh};

#[cfg(not(windows))]
pub fn display_mode(_gdi: &str) -> Option<DisplayMode> {
    None
}
#[cfg(not(windows))]
pub fn current_size(_gdi: &str) -> Option<(u32, u32)> {
    None
}

#[cfg(not(windows))]
pub fn all_modes(_gdi: &str) -> Vec<(u32, u32, u32)> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn set_resolution(_gdi: &str, _w: u32, _h: u32, _hz: u32) -> Result<(), String> {
    Err("disponível apenas no Windows".into())
}

#[cfg(not(windows))]
pub fn reset_resolution(_gdi: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
pub fn set_refresh(_gdi: &str, _hz: u32) -> Result<(), String> {
    Err("disponível apenas no Windows".into())
}
#[cfg(not(windows))]
pub fn game_dvr() -> Option<bool> {
    None
}
#[cfg(not(windows))]
pub fn set_game_dvr(_on: bool) -> Result<(), String> {
    Err("disponível apenas no Windows".into())
}
#[cfg(not(windows))]
pub fn hags() -> Option<bool> {
    None
}
#[cfg(not(windows))]
pub fn request_hags(_on: bool) -> Result<(), String> {
    Err("disponível apenas no Windows".into())
}
#[cfg(not(windows))]
pub fn running_paths(_names: &[String]) -> Vec<String> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn reopen(_paths: &[String]) -> usize {
    0
}

#[cfg(not(windows))]
pub fn close_apps(_names: &[String]) -> usize {
    0
}

pub fn windows_tweaks() -> WindowsTweaks {
    WindowsTweaks { game_dvr: game_dvr(), hags: hags() }
}

// ---------------------------------------------------------------------------
// Painel da máquina
// ---------------------------------------------------------------------------

/// Lê CPU, RAM e (NVIDIA) GPU. Guarda a amostra anterior para calcular a CPU.
#[derive(Default)]
pub struct StatsSampler {
    prev_cpu: Option<(u64, u64, u64)>,
    #[cfg(windows)]
    nvml: Option<nvml::Nvml>,
    #[cfg(windows)]
    nvml_tried: bool,
}

impl StatsSampler {
    pub fn sample(&mut self) -> SystemStats {
        #[allow(unused_mut)]
        let mut s = SystemStats::default();
        #[cfg(windows)]
        {
            if let Some(now) = win::cpu_times() {
                if let Some(prev) = self.prev_cpu {
                    s.cpu_usage = cpu_usage(prev, now);
                }
                self.prev_cpu = Some(now);
            }
            if let Some((used, total)) = win::ram() {
                s.ram_used_gb = Some(used);
                s.ram_total_gb = Some(total);
            }
            if !self.nvml_tried {
                self.nvml_tried = true;
                self.nvml = nvml::Nvml::load().ok();
            }
            if let Some(n) = self.nvml.as_ref() {
                n.fill(&mut s);
            }
        }
        s
    }
}

#[cfg(windows)]
mod nvml {
    //! Uso e temperatura da GPU NVIDIA pela NVML (`nvml.dll`, vem com o driver).
    use super::SystemStats;
    use libloading::Library;
    use std::ffi::c_void;

    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Util {
        gpu: u32,
        memory: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Mem {
        total: u64,
        free: u64,
        used: u64,
    }
    type FnInit = unsafe extern "C" fn() -> i32;
    type FnHandle = unsafe extern "C" fn(u32, *mut Handle) -> i32;
    type FnName = unsafe extern "C" fn(Handle, *mut u8, u32) -> i32;
    type FnUtil = unsafe extern "C" fn(Handle, *mut Util) -> i32;
    type FnTemp = unsafe extern "C" fn(Handle, i32, *mut u32) -> i32;
    type FnMem = unsafe extern "C" fn(Handle, *mut Mem) -> i32;

    pub struct Nvml {
        _lib: Library,
        dev: Handle,
        name: String,
        util: FnUtil,
        temp: FnTemp,
        mem: FnMem,
    }
    unsafe impl Send for Nvml {}

    impl Nvml {
        pub fn load() -> Result<Self, String> {
            unsafe {
                let lib = Library::new("nvml.dll").map_err(|e| e.to_string())?;
                macro_rules! sym {
                    ($t:ty, $n:literal) => {
                        *lib.get::<$t>($n).map_err(|e| e.to_string())?
                    };
                }
                let init: FnInit = sym!(FnInit, b"nvmlInit_v2\0");
                if init() != 0 {
                    return Err("nvmlInit falhou".into());
                }
                let get: FnHandle = sym!(FnHandle, b"nvmlDeviceGetHandleByIndex_v2\0");
                let mut dev: Handle = std::ptr::null_mut();
                if get(0, &mut dev) != 0 {
                    return Err("nenhuma GPU NVIDIA".into());
                }
                let name_fn: FnName = sym!(FnName, b"nvmlDeviceGetName\0");
                let mut buf = [0u8; 96];
                let name = if name_fn(dev, buf.as_mut_ptr(), buf.len() as u32) == 0 {
                    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    String::from_utf8_lossy(&buf[..end]).into_owned()
                } else {
                    "NVIDIA".into()
                };
                Ok(Self {
                    util: sym!(FnUtil, b"nvmlDeviceGetUtilizationRates\0"),
                    temp: sym!(FnTemp, b"nvmlDeviceGetTemperature\0"),
                    mem: sym!(FnMem, b"nvmlDeviceGetMemoryInfo\0"),
                    dev,
                    name,
                    _lib: lib,
                })
            }
        }

        pub fn fill(&self, s: &mut SystemStats) {
            s.gpu_name = Some(self.name.clone());
            unsafe {
                let mut u = Util::default();
                if (self.util)(self.dev, &mut u) == 0 {
                    s.gpu_usage = Some(u.gpu);
                }
                let mut t = 0u32;
                if (self.temp)(self.dev, 0, &mut t) == 0 {
                    s.gpu_temp = Some(t);
                }
                let mut m = Mem::default();
                if (self.mem)(self.dev, &mut m) == 0 {
                    let gb = |b: u64| b as f32 / 1024.0 / 1024.0 / 1024.0;
                    s.vram_used_gb = Some(gb(m.used));
                    s.vram_total_gb = Some(gb(m.total));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proporcoes() {
        assert_eq!(aspect_label(1280, 960), "4:3");
        assert_eq!(aspect_label(1440, 1080), "4:3");
        assert_eq!(aspect_label(1280, 1024), "5:4");
        assert_eq!(aspect_label(1680, 1050), "16:10");
        assert_eq!(aspect_label(1366, 768), "16:9");
        assert_eq!(aspect_label(2560, 1080), "21:9");
    }

    #[test]
    fn resolucoes_para_esticar() {
        let modes = [
            (1920, 1080, 60), (1920, 1080, 144), (1280, 960, 60), (1280, 960, 144), (1440, 1080, 120),
            (1280, 1024, 75), (1680, 1050, 60), (1600, 900, 144), (1024, 768, 60), (640, 480, 60), (2560, 1440, 60),
        ];
        let c = stretch_choices(&modes, (1920, 1080));
        let names: Vec<String> = c.iter().map(|r| format!("{}x{}@{}", r.width, r.height, r.max_hz)).collect();
        // 4:3 primeiro (maior primeiro), depois 5:4 e 16:10; sem 16:9, sem maiores que a nativa, sem 640x480.
        assert_eq!(names, ["1440x1080@120", "1280x960@144", "1024x768@60", "1280x1024@75", "1680x1050@60"]);
    }

    #[test]
    fn rates_at_current_resolution() {
        let modes = [(1920, 1080, 60), (1920, 1080, 144), (1920, 1080, 120), (1280, 720, 240), (1920, 1080, 144), (1920, 1080, 1)];
        assert_eq!(rates_for(&modes, 1920, 1080), vec![60, 120, 144]);
    }

    #[test]
    fn only_known_apps_can_be_closed() {
        let names = vec!["Chrome.exe".to_string(), "valorant-win64-shipping.exe".to_string(), "explorer.exe".to_string()];
        assert_eq!(closable(&names), vec!["chrome.exe".to_string()]);
    }

    #[test]
    fn heavy_apps_marks_running() {
        let running: HashSet<String> = ["chrome.exe".to_string()].into_iter().collect();
        let list = heavy_apps(&running);
        assert!(list.iter().find(|a| a.exe == "chrome.exe").unwrap().running);
        assert!(!list.iter().find(|a| a.exe == "firefox.exe").unwrap().running);
        assert_eq!(list.iter().filter(|a| a.name == "Microsoft Teams").count(), 2);
    }

    #[test]
    fn cpu_usage_from_times() {
        // 100 de tempo total (kernel 60 + user 40), 25 ocioso → 75%.
        assert_eq!(cpu_usage((0, 0, 0), (25, 60, 40)), Some(75.0));
        assert_eq!(cpu_usage((10, 10, 10), (10, 10, 10)), None);
    }
}
