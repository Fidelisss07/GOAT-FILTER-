//! Botões laterais do mouse (4 e 5) como atalho de clipe, e o movimento bruto
//! do mouse para o treino de mira.
//!
//! Usa Raw Input do Windows numa janela invisível do próprio Goat Filter: só
//! LÊ os cliques e o movimento, não bloqueia nem muda nada. O jogo continua
//! recebendo tudo normalmente (no Valorant os botões laterais vêm sem função).
//!
//! O movimento bruto é o mesmo que o Valorant usa: contagens do sensor, sem
//! aceleração do Windows e sem efeito da escala de tela (125%, 150%...).

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

static DX: AtomicI64 = AtomicI64::new(0);
static DY: AtomicI64 = AtomicI64::new(0);
static RAW_OK: AtomicBool = AtomicBool::new(false);

/// Soma de movimento relativo (contagens do mouse).
pub fn add_mouse_delta(dx: i64, dy: i64) {
    DX.fetch_add(dx, Ordering::Relaxed);
    DY.fetch_add(dy, Ordering::Relaxed);
}

/// Pega e zera o movimento acumulado desde a última leitura.
pub fn take_mouse_delta() -> (i64, i64) {
    (DX.swap(0, Ordering::Relaxed), DY.swap(0, Ordering::Relaxed))
}

/// O Raw Input do mouse está funcionando?
pub fn raw_mouse_ok() -> bool {
    RAW_OK.load(Ordering::Relaxed)
}

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
                // Movimento relativo (MOUSE_MOVE_ABSOLUTE = 1 é de tablet/área remota: ignora).
                let move_flags: u16 = std::mem::transmute_copy(&raw.data.mouse.usFlags);
                if move_flags & 0x01 == 0 {
                    add_mouse_delta(raw.data.mouse.lLastX as i64, raw.data.mouse.lLastY as i64);
                }
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
        RAW_OK.store(true, Ordering::Relaxed);
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
    fn movimento_acumula_e_zera() {
        let _ = take_mouse_delta();
        add_mouse_delta(10, -3);
        add_mouse_delta(5, 1);
        assert_eq!(take_mouse_delta(), (15, -2));
        assert_eq!(take_mouse_delta(), (0, 0));
    }

    #[test]
    fn nomes() {
        assert_eq!(button_name(4), Some("Mouse4"));
        assert_eq!(button_name(1), None);
        assert!(is_mouse_binding("Mouse5"));
        assert!(!is_mouse_binding("F8"));
    }
}
