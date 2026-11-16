//! Ajustes do Windows usados pela aba Desempenho.

use crate::perf::SystemTweaks;
use windows::core::{w, GUID};
use windows::Win32::Foundation::{HLOCAL, LocalFree, ERROR_SUCCESS};
use windows::Win32::System::Power::{PowerGetActiveScheme, PowerSetActiveScheme};
use windows::Win32::System::Registry::{RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD};
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPI_GETKEYBOARDDELAY, SPI_GETKEYBOARDSPEED, SPI_GETMOUSE,
    SPI_SETKEYBOARDDELAY, SPI_SETKEYBOARDSPEED, SPI_SETMOUSE, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

/// Só avisa os programas da mudança; não grava no perfil do usuário.
/// Assim, se o app travar, mouse e teclado voltam ao normal no próximo login.
const SESSION_ONLY: SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS = SPIF_SENDCHANGE;

pub struct WinSystem;

fn guid_to_string(g: &GUID) -> String {
    format!(
        "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        g.data1, g.data2, g.data3, g.data4[0], g.data4[1], g.data4[2], g.data4[3], g.data4[4], g.data4[5], g.data4[6],
        g.data4[7]
    )
}

fn parse_guid(s: &str) -> Option<GUID> {
    let hex: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if hex.len() != 32 {
        return None;
    }
    u128::from_str_radix(&hex, 16).ok().map(GUID::from_u128)
}

impl SystemTweaks for WinSystem {
    fn mouse(&mut self) -> Result<[i32; 3], String> {
        let mut v = [0i32; 3];
        unsafe { SystemParametersInfoW(SPI_GETMOUSE, 0, Some(v.as_mut_ptr() as _), Default::default()) }
            .map_err(|e| e.to_string())?;
        Ok(v)
    }

    fn set_mouse(&mut self, mut v: [i32; 3]) -> Result<(), String> {
        unsafe { SystemParametersInfoW(SPI_SETMOUSE, 0, Some(v.as_mut_ptr() as _), SESSION_ONLY) }.map_err(|e| e.to_string())
    }

    fn keyboard(&mut self) -> Result<(u32, u32), String> {
        let (mut d, mut s) = (0u32, 0u32);
        unsafe {
            SystemParametersInfoW(SPI_GETKEYBOARDDELAY, 0, Some(&mut d as *mut u32 as _), Default::default())
                .map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_GETKEYBOARDSPEED, 0, Some(&mut s as *mut u32 as _), Default::default())
                .map_err(|e| e.to_string())?;
        }
        Ok((d, s))
    }

    fn set_keyboard(&mut self, delay: u32, speed: u32) -> Result<(), String> {
        unsafe {
            SystemParametersInfoW(SPI_SETKEYBOARDDELAY, delay.min(3), None, SESSION_ONLY).map_err(|e| e.to_string())?;
            SystemParametersInfoW(SPI_SETKEYBOARDSPEED, speed.min(31), None, SESSION_ONLY).map_err(|e| e.to_string())
        }
    }

    fn power_scheme(&mut self) -> Result<String, String> {
        unsafe {
            let mut p: *mut GUID = std::ptr::null_mut();
            let r = PowerGetActiveScheme(None, &mut p);
            if r != ERROR_SUCCESS || p.is_null() {
                return Err(format!("erro {}", r.0));
            }
            let s = guid_to_string(&*p);
            let _ = LocalFree(HLOCAL(p as _));
            Ok(s)
        }
    }

    fn set_power_scheme(&mut self, guid: &str) -> Result<(), String> {
        let g = parse_guid(guid).ok_or("GUID inválido")?;
        let r = unsafe { PowerSetActiveScheme(None, Some(&g)) };
        if r == ERROR_SUCCESS {
            Ok(())
        } else {
            Err("o Windows não tem o plano \"Alto desempenho\" ativo neste PC".into())
        }
    }

    fn game_mode(&mut self) -> Option<bool> {
        let mut v = 0u32;
        let mut len = 4u32;
        let r = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!(r"Software\Microsoft\GameBar"),
                w!("AutoGameModeEnabled"),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut v as *mut u32 as _),
                Some(&mut len),
            )
        };
        // Sem o valor gravado, o Windows 10/11 usa o padrão: ligado.
        Some(if r == ERROR_SUCCESS { v != 0 } else { true })
    }

    fn set_game_mode(&mut self, on: bool) -> Result<(), String> {
        let v: u32 = on as u32;
        let r = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                w!(r"Software\Microsoft\GameBar"),
                w!("AutoGameModeEnabled"),
                REG_DWORD.0,
                Some(&v as *const u32 as _),
                4,
            )
        };
        if r == ERROR_SUCCESS { Ok(()) } else { Err(format!("erro {}", r.0)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn guid_roundtrip() {
        let g = parse_guid(crate::perf::HIGH_PERFORMANCE).unwrap();
        assert_eq!(guid_to_string(&g), crate::perf::HIGH_PERFORMANCE);
    }
}
