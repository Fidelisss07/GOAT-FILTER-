//! Lista de monitores ativos: nome GDI (`\\.\DISPLAY1`), nome amigável e principal.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Display {
    /// Nome GDI, usado também como id estável na interface.
    pub id: String,
    pub name: String,
    pub primary: bool,
}

#[cfg(windows)]
pub fn enumerate() -> Vec<Display> {
    use std::collections::HashMap;
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
    };

    const MONITORINFOF_PRIMARY: u32 = 1;

    unsafe extern "system" fn cb(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let out = &mut *(data.0 as *mut Vec<(String, bool)>);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(h, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
            let end = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());
            out.push((
                String::from_utf16_lossy(&info.szDevice[..end]),
                info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            ));
        }
        true.into()
    }

    let mut raw: Vec<(String, bool)> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut raw as *mut _ as isize));
    }
    let friendly: HashMap<String, String> =
        query_paths().into_iter().map(|(k, (name, _))| (k, name)).collect();
    let mut list: Vec<Display> = raw
        .into_iter()
        .enumerate()
        .map(|(i, (id, primary))| {
            let name = friendly
                .get(&id)
                .filter(|n| !n.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| format!("Monitor {}", i + 1));
            Display { id, name, primary }
        })
        .collect();
    list.sort_by(|a, b| b.primary.cmp(&a.primary).then(a.id.cmp(&b.id)));
    list
}

/// HMONITOR (como inteiro) do monitor com esse nome GDI.
#[cfg(windows)]
pub fn hmonitor_for(gdi: &str) -> Option<isize> {
    use windows::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};

    struct Search<'a> {
        name: &'a str,
        found: Option<isize>,
    }
    unsafe extern "system" fn cb(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let s = &mut *(data.0 as *mut Search);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(h, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
            let end = info.szDevice.iter().position(|&c| c == 0).unwrap_or(info.szDevice.len());
            if String::from_utf16_lossy(&info.szDevice[..end]).eq_ignore_ascii_case(s.name) {
                s.found = Some(h.0 as isize);
                return false.into();
            }
        }
        true.into()
    }
    let mut s = Search { name: gdi, found: None };
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(cb), LPARAM(&mut s as *mut _ as isize));
    }
    s.found
}

/// Adaptador (LUID) e origem de um monitor, usados pelas APIs de perfil de cor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Target {
    pub adapter_low: u32,
    pub adapter_high: i32,
    pub source_id: u32,
}

#[cfg(windows)]
pub fn display_target(gdi: &str) -> Option<Target> {
    query_paths().remove(gdi).map(|(_, t)| t)
}

/// Nome de interface do monitor (`\\?\DISPLAY#...`), usado pelo WCS.
#[cfg(windows)]
pub fn monitor_interface_name(gdi: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
    const EDD_GET_DEVICE_INTERFACE_NAME: u32 = 1;
    let name: Vec<u16> = gdi.encode_utf16().chain(Some(0)).collect();
    let mut dd = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
    unsafe {
        if !EnumDisplayDevicesW(PCWSTR(name.as_ptr()), 0, &mut dd, EDD_GET_DEVICE_INTERFACE_NAME).as_bool() {
            return None;
        }
    }
    let end = dd.DeviceID.iter().position(|&c| c == 0).unwrap_or(dd.DeviceID.len());
    let id = String::from_utf16_lossy(&dd.DeviceID[..end]);
    (!id.is_empty()).then_some(id)
}

/// Número de build do Windows (22000+ = Windows 11).
#[cfg(windows)]
pub fn windows_build() -> u32 {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let mut buf = [0u16; 32];
    let mut len = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion"),
            w!("CurrentBuildNumber"),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as _),
            Some(&mut len),
        )
    };
    if r.is_err() {
        return 0;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end]).trim().parse().unwrap_or(0)
}

/// Nome GDI → (nome do modelo, adaptador/origem) via DisplayConfig.
#[cfg(windows)]
fn query_paths() -> std::collections::HashMap<String, (String, Target)> {
    use std::collections::HashMap;
    use windows::Win32::Devices::Display::{
        DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
        DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
        DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SOURCE_DEVICE_NAME,
        DISPLAYCONFIG_TARGET_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
    };

    let mut out = HashMap::new();
    unsafe {
        let (mut np, mut nm) = (0u32, 0u32);
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut np, &mut nm).is_err() {
            return out;
        }
        let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); np as usize];
        let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); nm as usize];
        if QueryDisplayConfig(QDC_ONLY_ACTIVE_PATHS, &mut np, paths.as_mut_ptr(), &mut nm, modes.as_mut_ptr(), None)
            .is_err()
        {
            return out;
        }
        for p in paths.iter().take(np as usize) {
            let mut src = DISPLAYCONFIG_SOURCE_DEVICE_NAME::default();
            src.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            src.header.size = std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32;
            src.header.adapterId = p.sourceInfo.adapterId;
            src.header.id = p.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut src.header) != 0 {
                continue;
            }
            let mut tgt = DISPLAYCONFIG_TARGET_DEVICE_NAME::default();
            tgt.header.r#type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            tgt.header.size = std::mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
            tgt.header.adapterId = p.targetInfo.adapterId;
            tgt.header.id = p.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut tgt.header) != 0 {
                continue;
            }
            let w = |s: &[u16]| {
                let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
                String::from_utf16_lossy(&s[..end])
            };
            let target = Target {
                adapter_low: p.sourceInfo.adapterId.LowPart,
                adapter_high: p.sourceInfo.adapterId.HighPart,
                source_id: p.sourceInfo.id,
            };
            out.insert(w(&src.viewGdiDeviceName), (w(&tgt.monitorFriendlyDeviceName), target));
        }
    }
    out
}

#[cfg(not(windows))]
pub fn enumerate() -> Vec<Display> {
    vec![Display { id: r"\\.\DISPLAY1".into(), name: "Monitor principal".into(), primary: true }]
}
