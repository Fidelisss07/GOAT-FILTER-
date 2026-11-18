//! Botões laterais do mouse (4 e 5) como atalho de clipe.
//!
//! Usa Raw Input do Windows numa janela invisível do próprio Goat Filter: só
//! LÊ os cliques, não bloqueia nem muda nada. O jogo continua recebendo o
//! botão normalmente (no Valorant os botões laterais vêm sem função).

/// Nome do botão no formato dos atalhos.
pub fn button_name(button: u8) -> Option<&'static str> {
    match button {
        4 => Some("Mouse4"),
        5 => Some("Mouse5"),
        _ => None,
    }
}

pub fn is_mouse_binding(b: &str) -> bool {
    matches!(b, "Mouse4" | "Mouse5")
}

/// Fica escutando os botões 4/5 numa thread própria e chama `on_press`.
#[cfg(windows)]
pub fn spawn_mouse_listener(on_press: impl Fn(u8) + Send + 'static) {
    use std::cell::RefCell;
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
        RID_INPUT, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WM_INPUT, WNDCLASSW, WS_OVERLAPPED,
    };

    // RI_MOUSE_BUTTON_4_DOWN / RI_MOUSE_BUTTON_5_DOWN
    const B4_DOWN: u16 = 0x0040;
    const B5_DOWN: u16 = 0x0100;

    thread_local! {
        static CALLBACK: RefCell<Option<Box<dyn Fn(u8)>>> = RefCell::new(None);
    }

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_INPUT {
            let mut raw = RAWINPUT::default();
            let mut size = std::mem::size_of::<RAWINPUT>() as u32;
            let n = GetRawInputData(
                HRAWINPUT(lp.0 as *mut _),
                RID_INPUT,
                Some(&mut raw as *mut _ as *mut _),
                &mut size,
                std::mem::size_of::<RAWINPUTHEADER>() as u32,
            );
            if n != u32::MAX && raw.header.dwType == RIM_TYPEMOUSE.0 {
                let flags = raw.data.mouse.Anonymous.Anonymous.usButtonFlags;
                let pressed = if flags & B4_DOWN != 0 {
                    Some(4)
                } else if flags & B5_DOWN != 0 {
                    Some(5)
                } else {
                    None
                };
                if let Some(b) = pressed {
                    CALLBACK.with(|c| {
                        if let Some(cb) = c.borrow().as_ref() {
                            cb(b);
                        }
                    });
                }
            }
        }
        DefWindowProcW(hwnd, msg, wp, lp)
    }

    let _ = std::thread::Builder::new().name("goat-mouse-buttons".into()).spawn(move || unsafe {
        CALLBACK.with(|c| *c.borrow_mut() = Some(Box::new(on_press)));
        let Ok(inst) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: inst.into(), lpszClassName: w!("GoatFilterMouse"), ..Default::default() };
        RegisterClassW(&class);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("GoatFilterMouse"),
            w!(""),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            HWND_MESSAGE,
            None,
            inst,
            None,
        ) else {
            log::warn!("Botões do mouse: não foi possível criar a janela");
            return;
        };
        let dev = RAWINPUTDEVICE { usUsagePage: 0x01, usUsage: 0x02, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd };
        if RegisterRawInputDevices(&[dev], std::mem::size_of::<RAWINPUTDEVICE>() as u32).is_err() {
            log::warn!("Botões do mouse: Raw Input indisponível");
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    });
}

#[cfg(not(windows))]
pub fn spawn_mouse_listener(_on_press: impl Fn(u8) + Send + 'static) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomes() {
        assert_eq!(button_name(4), Some("Mouse4"));
        assert_eq!(button_name(1), None);
        assert!(is_mouse_binding("Mouse5"));
        assert!(!is_mouse_binding("F8"));
    }
}
