//! Aplicativo Tauri: janela, bandeja, comandos da interface e o loop de detecção.

use goat_core::engine::Engine;
use goat_core::types::{GameState, GameStatus, MonitorInfo, Settings, Snapshot};
use goat_core::watcher::{running_processes, GameWatcher};
use goat_core::{backends, monitors, settings as store};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const MINIMIZED_ARG: &str = "--minimized";

struct AppState {
    engine: Mutex<Engine>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    game: Mutex<GameStatus>,
    watcher: Mutex<GameWatcher>,
}

type Shared<'a> = State<'a, Arc<AppState>>;

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // Um pânico em outra thread não pode impedir a restauração das cores.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------------------
// Comandos chamados pela interface (src/lib/native.ts)
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_snapshot(app: AppHandle, state: Shared) -> Snapshot {
    let mut settings = lock(&state.settings).clone();
    if let Ok(on) = app.autolaunch().is_enabled() {
        settings.start_with_windows = on;
    }
    let mut engine = lock(&state.engine);
    Snapshot {
        capabilities: engine.capabilities(),
        monitors: engine.monitors(),
        settings,
        game: lock(&state.game).clone(),
    }
}

#[tauri::command]
fn apply_vibrance(state: Shared, monitor_id: String, percent: u8) -> Result<MonitorInfo, String> {
    lock(&state.engine).apply(&monitor_id, percent)
}

#[tauri::command]
fn restore_monitor(state: Shared, monitor_id: String) -> Result<MonitorInfo, String> {
    lock(&state.engine).restore(&monitor_id)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: Shared, settings: Settings) -> Result<Settings, String> {
    let mut s = store::sanitize(settings);
    let auto = app.autolaunch();
    let was = auto.is_enabled().unwrap_or(false);
    if s.start_with_windows != was {
        let r = if s.start_with_windows { auto.enable() } else { auto.disable() };
        if let Err(e) = r {
            log::warn!("Autostart: {e}");
        }
    }
    // Sempre devolve o estado efetivo do Windows.
    s.start_with_windows = auto.is_enabled().unwrap_or(was);
    store::save(&state.settings_path, &s).map_err(|e| format!("não foi possível gravar as preferências: {e}"))?;
    *lock(&state.settings) = s.clone();
    Ok(s)
}

#[tauri::command]
fn executable_exists(path: String) -> bool {
    let p = PathBuf::from(path.trim());
    p.is_file() && p.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Janela e bandeja
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Abrir Goat Filter", true, None::<&str>)?;
    let restore = MenuItem::with_id(app, "restore", "Restaurar cores originais", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &restore, &quit])?;
    let mut tray = TrayIconBuilder::with_id("goat-tray")
        .tooltip("Goat Filter")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "restore" => {
                let st = app.state::<Arc<AppState>>();
                lock(&st.engine).restore_all();
                let list = lock(&st.engine).monitors();
                let _ = app.emit("monitors-changed", list);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Loop de fundo: jogo aberto/fechado e monitores conectados/desconectados
// ---------------------------------------------------------------------------

fn spawn_background(app: AppHandle, state: Arc<AppState>) {
    std::thread::Builder::new()
        .name("goat-watcher".into())
        .spawn(move || {
            let mut tick: u64 = 0;
            loop {
                std::thread::sleep(Duration::from_secs(1));
                tick += 1;

                if cfg!(windows) {
                    let procs = running_processes();
                    let settings = lock(&state.settings).clone();
                    let changed = {
                        let mut engine = lock(&state.engine);
                        lock(&state.watcher).tick(&procs, &settings, &mut engine)
                    };
                    if let Some(status) = changed {
                        *lock(&state.game) = status.clone();
                        let _ = app.emit("game-status", status);
                        let list = lock(&state.engine).monitors();
                        let _ = app.emit("monitors-changed", list);
                    }
                }

                if tick % 3 == 0 {
                    let displays = monitors::enumerate();
                    let mut engine = lock(&state.engine);
                    if engine.refresh(displays) {
                        let list = engine.monitors();
                        drop(engine);
                        let _ = app.emit("monitors-changed", list);
                    }
                }
            }
        })
        .expect("thread de detecção");
}

// ---------------------------------------------------------------------------

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let settings_path = dir.join("settings.json");
            let settings = store::load(&settings_path);

            let engine = Engine::new(
                backends::detect(),
                monitors::enumerate(),
                Some(dir.join("session.json")),
                !cfg!(windows),
            );
            let game = if cfg!(windows) {
                GameStatus::idle()
            } else {
                GameStatus {
                    state: GameState::Unavailable,
                    profile_id: None,
                    message: Some("Detecção de jogos disponível apenas no Windows.".into()),
                }
            };
            let state = Arc::new(AppState {
                engine: Mutex::new(engine),
                settings: Mutex::new(settings),
                settings_path,
                game: Mutex::new(game),
                watcher: Mutex::new(GameWatcher::default()),
            });
            app.manage(state.clone());
            build_tray(app)?;
            spawn_background(app.handle().clone(), state);

            if !std::env::args().any(|a| a == MINIMIZED_ARG) {
                show_main(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let st = window.app_handle().state::<Arc<AppState>>();
                if lock(&st.settings).minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            apply_vibrance,
            restore_monitor,
            save_settings,
            executable_exists
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Goat Filter");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let st = app.state::<Arc<AppState>>();
            let restore = lock(&st.settings).restore_on_exit;
            lock(&st.engine).end_session(restore);
        }
    });
}
