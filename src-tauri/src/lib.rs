//! Aplicativo Tauri: janela, bandeja, comandos da interface e o loop de detecção.

use goat_core::engine::Engine;
use goat_core::perf::PerfManager;
use goat_core::types::{
    Bindings, GameState, GameStatus, MonitorHwState, MonitorInfo, Settings, Snapshot, SuperMethod, Tuning, DRIVER_MAX, SUPER_MAX,
    VALORANT_ID,
};
use goat_core::watcher::{process_snapshot, GameWatcher};
use goat_core::{backends, monitors, settings as store};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use std::str::FromStr;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const MINIMIZED_ARG: &str = "--minimized";
/// Repositório onde as versões são publicadas (aba Releases).
const REPO: &str = "Fidelisss07/GOAT-FILTER-";

fn fetch_update() -> Result<goat_core::update::UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION");
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    // TLS nativo do Windows (SChannel): sem dependência em C.
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new().tls_connector(Arc::new(tls)).build();
    match agent
        .get(&url)
        .set("User-Agent", "goat-filter-update-check")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(8))
        .call()
    {
        Ok(r) => {
            let json: serde_json::Value = r.into_json().map_err(|e| e.to_string())?;
            Ok(goat_core::update::from_release_json(current, &json))
        }
        // Nenhuma versão publicada ainda.
        Err(ureq::Error::Status(404, _)) => Ok(goat_core::update::UpdateInfo {
            current: current.into(),
            latest: None,
            available: false,
            url: None,
            notes: None,
        }),
        Err(e) => Err(format!("sem conexão com o GitHub ({e})")),
    }
}

struct AppState {
    engine: Mutex<Engine>,
    settings: Mutex<Settings>,
    settings_path: PathBuf,
    game: Mutex<GameStatus>,
    watcher: Mutex<GameWatcher>,
    /// Valores guardados quando o filtro é desligado pelo atalho.
    paused: Mutex<Option<Vec<(String, u8, Tuning)>>>,
    /// Atalhos registrados agora e a ação de cada um.
    hotkeys: Mutex<Vec<(Shortcut, &'static str)>>,
    /// Índice do último perfil escolhido pelo atalho "próximo perfil".
    next_profile: Mutex<usize>,
    perf: Mutex<PerfManager>,
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

/// Valores atuais do próprio monitor (DDC/CI). Lento: a interface chama sob demanda.
#[tauri::command]
async fn monitor_hw(app: AppHandle, monitor_id: String) -> Result<MonitorHwState, String> {
    let state = app.state::<Arc<AppState>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || lock(&state.engine).monitor_hw(&monitor_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn check_update() -> Result<goat_core::update::UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(fetch_update).await.map_err(|e| e.to_string())?
}

/// Abre a página da versão nova no navegador (só links do GitHub do projeto).
#[tauri::command]
fn open_release(app: AppHandle, url: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let fallback = format!("https://github.com/{REPO}/releases/latest");
    let url = url.filter(|u| u.starts_with(&format!("https://github.com/{REPO}/"))).unwrap_or(fallback);
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").into()
}

/// Estado atual de mouse, teclado, energia e Modo de Jogo (aba Desempenho).
#[tauri::command]
fn perf_status(state: Shared) -> goat_core::types::PerfStatus {
    lock(&state.perf).status()
}

/// Liga/desliga o Modo de Jogo do Windows (configuração permanente do usuário).
#[tauri::command]
fn set_game_mode(state: Shared, on: bool) -> Result<goat_core::types::PerfStatus, String> {
    let mut p = lock(&state.perf);
    p.set_game_mode(on)?;
    Ok(p.status())
}

#[tauri::command]
fn find_valorant() -> Option<String> {
    goat_core::games::find_valorant()
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
    if s.hotkeys != before.hotkeys || s.bindings != before.bindings {
        let errs = register_hotkeys(&app, &s);
        if !errs.is_empty() {
            notify(&app, "error", format!("Atalhos: {}", errs.join(" · ")));
        }
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

/// Lê as teclas configuradas. Devolve (atalho, ação) e os erros de leitura.
fn parse_bindings(b: &Bindings) -> (Vec<(Shortcut, &'static str)>, Vec<String>) {
    let mut ok = Vec::new();
    let mut errs = Vec::new();
    for (action, text) in b.all() {
        if text.trim().is_empty() {
            continue;
        }
        match Shortcut::from_str(text) {
            Ok(sc) => ok.push((sc, action)),
            Err(_) => errs.push(format!("tecla inválida: {text}")),
        }
    }
    (ok, errs)
}

/// Registra os atalhos atuais. Devolve as teclas que não puderam ser usadas.
fn register_hotkeys(app: &AppHandle, settings: &Settings) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let state = app.state::<Arc<AppState>>();
    lock(&state.hotkeys).clear();
    if !settings.hotkeys {
        return vec![];
    }
    let (list, mut errs) = parse_bindings(&settings.bindings);
    for (sc, action) in list {
        match gs.register(sc) {
            Ok(()) => lock(&state.hotkeys).push((sc, action)),
            Err(e) => {
                log::warn!("Atalho {sc:?} indisponível: {e}");
                errs.push(format!("{} já está em uso por outro programa", shortcut_label(&sc)));
            }
        }
    }
    errs
}

fn shortcut_label(sc: &Shortcut) -> String {
    let s = sc.into_string();
    s.replace("control", "Ctrl").replace("alt", "Alt").replace("shift", "Shift").replace("Key", "").replace("Arrow", "")
}

fn target_monitor(state: &AppState) -> Option<String> {
    let wanted = lock(&state.settings).default_monitor.clone();
    let engine = lock(&state.engine);
    wanted.filter(|id| engine.has_monitor(id)).or_else(|| engine.primary_id())
}

fn on_hotkey(app: &AppHandle, sc: &Shortcut) {
    let state = app.state::<Arc<AppState>>();
    let Some(action) = lock(&state.hotkeys).iter().find(|(s, _)| s == sc).map(|(_, a)| *a) else { return };
    match action {
        "toggle" => {
            let mut paused = lock(&state.paused);
            let mut engine = lock(&state.engine);
            match paused.take() {
                Some(values) => {
                    for (id, v, t) in values {
                        let _ = engine.apply_with(&id, v, t);
                    }
                    drop(engine);
                    notify(app, "ok", "Goat Filter ligado");
                }
                None => {
                    let values: Vec<(String, u8, Tuning)> = engine
                        .monitors()
                        .into_iter()
                        .filter_map(|m| match (m.current, m.original) {
                            (Some(c), o) if Some(c) != o || m.tuning != Tuning::default() => Some((m.id, c, m.tuning)),
                            _ => None,
                        })
                        .collect();
                    engine.restore_all();
                    *paused = Some(values);
                    drop(engine);
                    notify(app, "info", "Goat Filter desligado (aperte o atalho de novo para ligar)");
                }
            }
        }
        "vibranceUp" | "vibranceDown" => {
            let Some(id) = target_monitor(&state) else { return };
            let mut engine = lock(&state.engine);
            let max = if engine.method() == SuperMethod::None { DRIVER_MAX } else { SUPER_MAX };
            let cur = engine.current(&id).unwrap_or(50) as i16;
            let next = (cur + if action == "vibranceUp" { 10 } else { -10 }).clamp(0, max as i16) as u8;
            let r = engine.apply(&id, next);
            drop(engine);
            *lock(&state.paused) = None;
            match r {
                Ok(_) => notify(app, "ok", format!("Vibrance: {next}%")),
                Err(e) => notify(app, "error", e),
            }
        }
        "nextProfile" => {
            let Some(id) = target_monitor(&state) else { return };
            let profiles = lock(&state.settings).profiles.clone();
            if profiles.is_empty() {
                return;
            }
            let i = {
                let mut n = lock(&state.next_profile);
                *n = (*n + 1) % profiles.len();
                *n
            };
            let p = &profiles[i];
            let r = lock(&state.engine).apply_with(&id, p.vibrance, p.tuning);
            *lock(&state.paused) = None;
            match r {
                Ok(_) => notify(app, "ok", format!("Perfil: {} ({}%)", p.name, p.vibrance)),
                Err(e) => notify(app, "error", e),
            }
        }
        _ => {}
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
                        let mut perf = lock(&state.perf);
                        lock(&state.watcher).tick(&procs, foreground.as_deref(), &settings, &mut engine, &mut perf)
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec![MINIMIZED_ARG])))
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let settings_path = dir.join("settings.json");
            let mut settings = store::load(&settings_path);

            // Valorant fora de C:\Riot Games? Corrige o caminho sozinho.
            if let Some(p) = settings.profiles.iter_mut().find(|p| p.id == VALORANT_ID) {
                if !std::path::Path::new(&p.executable).is_file() {
                    if let Some(found) = goat_core::games::find_valorant() {
                        log::info!("Valorant encontrado em {found}");
                        p.executable = found;
                        let _ = store::save(&settings_path, &settings);
                    }
                }
            }

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
            // (atalhos registrados depois que o estado existe)
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
                hotkeys: Mutex::new(Vec::new()),
                next_profile: Mutex::new(0),
                perf: Mutex::new(PerfManager::new(backends::system_tweaks(), Some(dir.join("perf.json")))),
            });
            app.manage(state.clone());
            let state_for_keys = state.clone();
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
            let errs = register_hotkeys(app.handle(), &lock(&state_for_keys.settings).clone());
            if !errs.is_empty() {
                log::warn!("Atalhos: {errs:?}");
            }
            spawn_background(app.handle().clone(), state);

            // Verifica atualização uma vez, alguns segundos depois de abrir.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                match fetch_update() {
                    Ok(u) if u.available => {
                        log::info!("Nova versão disponível: {:?}", u.latest);
                        notify(&handle, "info", format!("Nova versão {} disponível — veja em Configurações › Sobre", u.latest.clone().unwrap_or_default()));
                        let _ = handle.emit("update-available", u);
                    }
                    Ok(_) => {}
                    Err(e) => log::info!("Verificação de atualização: {e}"),
                }
            });

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
            monitor_hw,
            perf_status,
            set_game_mode,
            find_valorant,
            check_update,
            open_release,
            open_logs,
            app_version,
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
            lock(&st.perf).restore();
        }
    });
}
