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
    let friendly: HashMap<String, String> = friendly_names();
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

/// Nome do modelo (ex.: "Redragon ...") via DisplayConfig.
#[cfg(windows)]
fn friendly_names() -> std::collections::HashMap<String, String> {
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
            out.insert(w(&src.viewGdiDeviceName), w(&tgt.monitorFriendlyDeviceName));
        }
    }
    out
}

#[cfg(not(windows))]
pub fn enumerate() -> Vec<Display> {
    vec![Display { id: r"\\.\DISPLAY1".into(), name: "Monitor principal".into(), primary: true }]
}
