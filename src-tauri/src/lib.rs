//! Aplicativo Tauri: janela, bandeja, comandos da interface e o loop de detecção.

use goat_core::engine::Engine;
use goat_core::types::{GameState, GameStatus, MonitorInfo, Settings, Snapshot, SuperMethod, Tuning, DRIVER_MAX, SUPER_MAX};
use goat_core::watcher::{process_snapshot, GameWatcher};
use goat_core::{backends, monitors, settings as store};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const MINIMIZED_ARG: &str = "--minimized";

struct AppState {
    engine: Mutex<Engine>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    game: Mutex<GameStatus>,
    watcher: Mutex<GameWatcher>,
    /// Valores guardados quando o filtro é desligado pelo atalho.
    paused: Mutex<Option<Vec<(String, u8)>>>,
}

#[derive(Clone, serde::Serialize)]
struct Notice {
    kind: &'static str,
    text: String,
}

fn notify(app: &AppHandle, kind: &'static str, text: impl Into<String>) {
    let _ = app.emit("notice", Notice { kind, text: text.into() });
}

fn emit_monitors(app: &AppHandle, state: &AppState) {
    let list = lock(&state.engine).monitors();
    let _ = app.emit("monitors-changed", list);
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

/// "Testar agora" do editor de perfis: vibrance + ajustes finos.
#[tauri::command]
fn apply_tuned(state: Shared, monitor_id: String, percent: u8, tuning: Tuning) -> Result<MonitorInfo, String> {
    lock(&state.engine).apply_with(&monitor_id, percent, tuning)
}

#[tauri::command]
fn export_profiles(state: Shared, path: String) -> Result<usize, String> {
    let profiles = lock(&state.settings).profiles.clone();
    std::fs::write(&path, store::export_profiles(&profiles)).map_err(|e| format!("não foi possível salvar: {e}"))?;
    Ok(profiles.len())
}

#[tauri::command]
fn import_profiles(state: Shared, path: String) -> Result<Settings, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("não foi possível ler: {e}"))?;
    let mut s = lock(&state.settings).clone();
    store::import_profiles(&raw, &mut s)?;
    store::save(&state.settings_path, &s).map_err(|e| format!("não foi possível gravar: {e}"))?;
    *lock(&state.settings) = s.clone();
    Ok(s)
}

#[tauri::command]
fn restore_monitor(state: Shared, monitor_id: String) -> Result<MonitorInfo, String> {
    lock(&state.engine).restore(&monitor_id)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: Shared, settings: Settings) -> Result<Settings, String> {
    let mut s = store::sanitize(settings);
    let before = lock(&state.settings).clone();

    if s.super_method != before.super_method {
        if let Err(e) = lock(&state.engine).set_method(s.super_method) {
            log::warn!("Trocar método: {e}");
            s.super_method = before.super_method;
        }
        emit_monitors(&app, &state);
    }
    if s.hotkeys != before.hotkeys {
        register_hotkeys(&app, s.hotkeys);
    }

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
// Atalhos globais (funcionam com o jogo em foco; usam RegisterHotKey)
// ---------------------------------------------------------------------------

fn shortcuts() -> [Shortcut; 3] {
    let m = Some(Modifiers::CONTROL | Modifiers::ALT);
    [Shortcut::new(m, Code::KeyG), Shortcut::new(m, Code::ArrowUp), Shortcut::new(m, Code::ArrowDown)]
}

fn register_hotkeys(app: &AppHandle, on: bool) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !on {
        return;
    }
    for sc in shortcuts() {
        if let Err(e) = gs.register(sc) {
            log::warn!("Atalho {sc:?} indisponível: {e}");
            notify(app, "error", "Um atalho já está em uso por outro programa.");
        }
    }
}

fn target_monitor(state: &AppState) -> Option<String> {
    let wanted = lock(&state.settings).default_monitor.clone();
    let engine = lock(&state.engine);
    wanted.filter(|id| engine.has_monitor(id)).or_else(|| engine.primary_id())
}

fn on_hotkey(app: &AppHandle, sc: &Shortcut) {
    let state = app.state::<Arc<AppState>>();
    let [toggle, up, down] = shortcuts();
    if sc == &toggle {
        let mut paused = lock(&state.paused);
        let mut engine = lock(&state.engine);
        match paused.take() {
            Some(values) => {
                for (id, v) in values {
                    let _ = engine.apply(&id, v);
                }
                drop(engine);
                notify(app, "ok", "Goat Filter ligado");
            }
            None => {
                let values: Vec<(String, u8)> = engine
                    .monitors()
                    .into_iter()
                    .filter_map(|m| match (m.current, m.original) {
                        (Some(c), o) if Some(c) != o => Some((m.id, c)),
                        _ => None,
                    })
                    .collect();
                engine.restore_all();
                *paused = Some(values);
                drop(engine);
                notify(app, "info", "Goat Filter desligado (Ctrl+Alt+G para ligar)");
            }
        }
    } else if sc == &up || sc == &down {
        let Some(id) = target_monitor(&state) else { return };
        let mut engine = lock(&state.engine);
        let max = if engine.method() == SuperMethod::None { DRIVER_MAX } else { SUPER_MAX };
        let cur = engine.current(&id).unwrap_or(50) as i16;
        let next = (cur + if sc == &up { 10 } else { -10 }).clamp(0, max as i16) as u8;
        let r = engine.apply(&id, next);
        drop(engine);
        *lock(&state.paused) = None;
        match r {
            Ok(_) => notify(app, "ok", format!("Vibrance: {next}%")),
            Err(e) => notify(app, "error", e),
        }
    }
    emit_monitors(app, &state);
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
                emit_monitors(app, &st);
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
                std::thread::sleep(Duration::from_millis(500));
                tick += 1;

                if cfg!(windows) {
                    let (procs, foreground) = process_snapshot();
                    let settings = lock(&state.settings).clone();
                    let changed = {
                        let mut engine = lock(&state.engine);
                        lock(&state.watcher).tick(&procs, foreground.as_deref(), &settings, &mut engine)
                    };
                    if let Some(status) = changed {
                        *lock(&state.game) = status.clone();
                        let _ = app.emit("game-status", status);
                        let list = lock(&state.engine).monitors();
                        let _ = app.emit("monitors-changed", list);
                    }
                }

                if tick % 6 == 0 {
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
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                    file_name: Some("goat-filter".into()),
                }))
                .max_file_size(1_000_000)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let settings_path = dir.join("settings.json");
            let settings = store::load(&settings_path);

            log::info!("Goat Filter {} iniciando", env!("CARGO_PKG_VERSION"));
            let mut engine = Engine::new(
                backends::detect(&dir),
                monitors::enumerate(),
                Some(dir.join("session.json")),
                !cfg!(windows),
            );
            {
                let caps = engine.capabilities();
                for m in &caps.methods {
                    log::info!("Super {:?}: disponível={} {:?}", m.method, m.available, m.reason);
                }
                for m in engine.monitors() {
                    log::info!("Monitor {} ({}): driver={:?} atual={:?}", m.id, m.name, m.driver, m.current);
                }
            }
            if settings.super_method != engine.method() {
                if let Err(e) = engine.set_method(settings.super_method) {
                    log::warn!("Método preferido indisponível: {e}");
                }
            }
            let hotkeys = settings.hotkeys;
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
                paused: Mutex::new(None),
            });
            app.manage(state.clone());
            build_tray(app)?;
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, sc, ev| {
                        if ev.state() == ShortcutState::Pressed {
                            on_hotkey(app, sc);
                        }
                    })
                    .build(),
            )?;
            register_hotkeys(app.handle(), hotkeys);
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
            apply_tuned,
            export_profiles,
            import_profiles,
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
