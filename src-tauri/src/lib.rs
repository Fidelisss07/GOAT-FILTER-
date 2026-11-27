//! Aplicativo Tauri: janela, bandeja, comandos da interface e o loop de detecção.

use goat_core::engine::Engine;
mod recorder;
mod updater;

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

fn http_agent() -> Result<ureq::Agent, String> {
    // TLS nativo do Windows (SChannel): sem dependência em C.
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::AgentBuilder::new().tls_connector(Arc::new(tls)).build())
}

/// Consulta a versão mais nova.
/// 1º: `/download/latest.json` do site (o instalador também vem do site).
/// 2º: `latest.json` anexado à versão no GitHub (enquanto o repositório for público).
/// 3º: API do GitHub.
fn fetch_update() -> Result<goat_core::update::UpdateInfo, String> {
    use goat_core::update::SITE;
    let current = env!("CARGO_PKG_VERSION");
    let agent = http_agent()?;

    let site = format!("{SITE}/download/latest.json");
    match agent.get(&site).set("User-Agent", "goat-filter-update-check").timeout(Duration::from_secs(8)).call() {
        Ok(r) => {
            if let Ok(json) = r.into_json::<serde_json::Value>() {
                if let Some(u) = goat_core::update::from_site_manifest(current, SITE, &json) {
                    if u.installer_url.is_some() {
                        return Ok(u);
                    }
                }
            }
            log::info!("latest.json do site inválido; tentando o GitHub");
        }
        Err(e) => log::info!("site indisponível ({e}); tentando o GitHub"),
    }

    let manifest = format!("https://github.com/{REPO}/releases/latest/download/latest.json");
    match agent.get(&manifest).set("User-Agent", "goat-filter-update-check").timeout(Duration::from_secs(8)).call() {
        Ok(r) => {
            if let Ok(json) = r.into_json::<serde_json::Value>() {
                if let Some(u) = goat_core::update::from_manifest_json(current, REPO, &json) {
                    return Ok(u);
                }
            }
            log::info!("latest.json inválido; usando a API do GitHub");
        }
        Err(e) => log::info!("latest.json indisponível ({e}); usando a API do GitHub"),
    }

    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
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
            installer_url: None,
            installer_sha256: None,
        }),
        Err(ureq::Error::Status(403 | 429, _)) => {
            Err("o GitHub limitou as consultas por agora; tente de novo em até 1 hora".into())
        }
        Err(e) => Err(format!("sem conexão com o servidor de atualizações ({e})")),
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
    stats: Mutex<goat_core::tweaks::StatsSampler>,
    recorder: Arc<recorder::Recorder>,
    /// Apps fechados ao abrir o jogo (caminho completo) para reabrir depois.
    reopen: Mutex<Vec<String>>,
    /// Partida em andamento: jogo, início (ms), clipes, maior temperatura da GPU.
    session: Mutex<Option<(String, u64, u32, Option<u32>)>>,
    last_temp_alert: Mutex<Option<u64>>,
    history_path: PathBuf,
    /// Monitor com resolução esticada agora (nome GDI) e arquivo de segurança.
    stretched: Mutex<Option<String>>,
    stretch_marker: PathBuf,
}

/// Monitor usado pelos perfis: o escolhido nas configurações ou o principal.
fn game_monitor(settings: &Settings) -> Option<String> {
    let list = monitors::enumerate();
    settings
        .default_monitor
        .clone()
        .filter(|id| list.iter().any(|d| &d.id == id))
        .or_else(|| list.iter().find(|d| d.primary).map(|d| d.id.clone()))
}

/// Estica a tela para a resolução do perfil (temporário; volta com `unstretch`).
fn stretch(state: &AppState, gdi: &str, w: u32, h: u32) -> Result<(), String> {
    let hz = goat_core::tweaks::all_modes(gdi)
        .into_iter()
        .filter(|m| m.0 == w && m.1 == h)
        .map(|m| m.2)
        .max()
        .unwrap_or(60);
    goat_core::tweaks::set_resolution(gdi, w, h, hz)?;
    let _ = std::fs::write(&state.stretch_marker, gdi);
    *lock(&state.stretched) = Some(gdi.to_string());
    log::info!("Resolução esticada {w}x{h} @ {hz} Hz em {gdi}");
    Ok(())
}

fn unstretch(state: &AppState) {
    if let Some(gdi) = lock(&state.stretched).take() {
        if let Err(e) = goat_core::tweaks::reset_resolution(&gdi) {
            log::warn!("Voltar resolução: {e}");
        }
    }
    let _ = std::fs::remove_file(&state.stretch_marker);
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
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

/// Movimento bruto do mouse (contagens, como o Valorant lê) desde a última
/// chamada. `None` se o Raw Input não estiver disponível: a tela usa o do navegador.
#[tauri::command]
fn mouse_delta() -> Option<(i64, i64)> {
    if !goat_core::input::raw_mouse_ok() {
        return None;
    }
    Some(goat_core::input::take_mouse_delta())
}

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

/// Abre a página da versão nova no navegador (só links conhecidos do projeto).
#[tauri::command]
fn open_release(app: AppHandle, url: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let fallback = format!("{}/#novidades", goat_core::update::SITE);
    // Só abre endereços conhecidos: o GitHub do projeto, o site e o e-mail de suporte.
    let allowed = |u: &str| {
        u.starts_with(&format!("https://github.com/{REPO}/"))
            || u.starts_with("https://www.goatfilter.xyz/")
            || u == "mailto:suporte-contato@goatfilter.xyz"
    };
    let url = url.filter(|u| allowed(u)).unwrap_or(fallback);
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdaterState {
    /// Versão já baixada e conferida, esperando instalar.
    pending: Option<String>,
    /// Versão instalada (a portátil não se atualiza sozinha).
    installed: bool,
}

fn updates_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|d| d.join("updates"))
}

#[tauri::command]
fn updater_state(app: AppHandle) -> UpdaterState {
    let pending = updates_dir(&app).and_then(|d| updater::pending(&d)).map(|p| p.version);
    UpdaterState { pending, installed: updater::is_installed() }
}

/// "Reiniciar e atualizar agora": devolve as cores, instala e reabre.
#[tauri::command]
fn install_update_now(app: AppHandle, state: Shared) -> Result<(), String> {
    let dir = updates_dir(&app).ok_or("pasta de atualização indisponível")?;
    let p = updater::pending(&dir).ok_or("nenhuma atualização baixada")?;
    let restore = lock(&state.settings).restore_on_exit;
    lock(&state.engine).end_session(restore);
    lock(&state.perf).restore();
    updater::launch(&p, false)?;
    app.exit(0);
    Ok(())
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    percent: u8,
}

/// Baixa a atualização avisando a interface do progresso.
fn download_with_progress(app: &AppHandle, info: &goat_core::update::UpdateInfo) -> Result<updater::Pending, String> {
    let dir = updates_dir(app).ok_or("pasta de atualização indisponível")?;
    let _ = app.emit("update-progress", Progress { percent: 0 });
    let h = app.clone();
    let p = updater::download(&dir, info, move |percent| {
        let _ = h.emit("update-progress", Progress { percent });
    })?;
    let _ = app.emit("update-ready", p.version.clone());
    Ok(p)
}

/// Com a janela fechada (só na bandeja) e nenhum jogo aberto, instala na
/// hora e o app volta sozinho, já atualizado e minimizado.
fn install_if_idle(app: &AppHandle, p: &updater::Pending) -> bool {
    let state = app.state::<Arc<AppState>>();
    let visible = app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(true);
    let playing = matches!(lock(&state.game).state, GameState::Active | GameState::Paused);
    if visible || playing {
        return false;
    }
    let restore = lock(&state.settings).restore_on_exit;
    lock(&state.engine).end_session(restore);
    lock(&state.perf).restore();
    match updater::launch(p, true) {
        Ok(()) => {
            app.exit(0);
            true
        }
        Err(e) => {
            log::warn!("Instalar atualização: {e}");
            false
        }
    }
}

/// "Atualizar agora": baixa (com progresso), instala e reabre o app.
#[tauri::command]
async fn update_now(app: AppHandle) -> Result<(), String> {
    if !updater::is_installed() {
        return Err("a versão portátil não se atualiza sozinha; baixe a nova pela página de downloads".into());
    }
    let h = app.clone();
    let pending = tauri::async_runtime::spawn_blocking(move || -> Result<updater::Pending, String> {
        let dir = updates_dir(&h).ok_or("pasta de atualização indisponível")?;
        if let Some(p) = updater::pending(&dir) {
            return Ok(p);
        }
        let info = fetch_update()?;
        if !info.available {
            return Err("você já está na versão mais recente".into());
        }
        download_with_progress(&h, &info)
    })
    .await
    .map_err(|e| e.to_string())??;
    let state = app.state::<Arc<AppState>>();
    let restore = lock(&state.settings).restore_on_exit;
    lock(&state.engine).end_session(restore);
    lock(&state.perf).restore();
    updater::launch(&pending, false)?;
    app.exit(0);
    Ok(())
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorMode {
    monitor_id: String,
    name: String,
    mode: Option<goat_core::tweaks::DisplayMode>,
}

/// Taxa atual e máxima de cada monitor.
#[tauri::command]
fn display_modes(state: Shared) -> Vec<MonitorMode> {
    let list = lock(&state.engine).monitors();
    list.into_iter()
        .map(|m| MonitorMode { mode: goat_core::tweaks::display_mode(&m.id), monitor_id: m.id, name: m.name })
        .collect()
}

#[tauri::command]
fn set_refresh_rate(monitor_id: String, hz: u32) -> Result<(), String> {
    goat_core::tweaks::set_refresh(&monitor_id, hz)
}

#[tauri::command]
fn windows_tweaks() -> goat_core::tweaks::WindowsTweaks {
    goat_core::tweaks::windows_tweaks()
}

#[tauri::command]
fn set_game_dvr(on: bool) -> Result<goat_core::tweaks::WindowsTweaks, String> {
    goat_core::tweaks::set_game_dvr(on)?;
    Ok(goat_core::tweaks::windows_tweaks())
}

/// Pede permissão de administrador; vale depois de reiniciar o PC.
#[tauri::command]
fn request_hags(on: bool) -> Result<(), String> {
    goat_core::tweaks::request_hags(on)
}

#[tauri::command]
fn heavy_apps() -> Vec<goat_core::tweaks::HeavyApp> {
    let (procs, _) = process_snapshot();
    goat_core::tweaks::heavy_apps(&procs)
}

#[tauri::command]
fn close_apps_now(names: Vec<String>) -> usize {
    goat_core::tweaks::close_apps(&names)
}

#[tauri::command]
fn system_stats(state: Shared) -> goat_core::tweaks::SystemStats {
    lock(&state.stats).sample()
}

/// Abre uma página das Configurações do Windows (só as usadas pelo app).
#[tauri::command]
fn open_windows_settings(app: AppHandle, page: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    const ALLOWED: &[&str] = &["ms-settings:notifications", "ms-settings:display-advancedgraphics", "ms-settings:gaming-gamemode"];
    if !ALLOWED.contains(&page.as_str()) {
        return Err("página não permitida".into());
    }
    app.opener().open_url(page, None::<&str>).map_err(|e| e.to_string())
}

/// "Aquecer e jogar": abre o jogo do perfil (Valorant pelo Riot Client).
#[tauri::command]
fn launch_game(state: Shared, profile_id: String) -> Result<(), String> {
    let exe = lock(&state.settings)
        .profiles
        .iter()
        .find(|p| p.id == profile_id)
        .map(|p| p.executable.clone())
        .ok_or("perfil não encontrado")?;
    goat_core::games::launch_game(&exe)
}

#[tauri::command]
async fn find_games() -> Vec<goat_core::games::FoundGame> {
    tauri::async_runtime::spawn_blocking(goat_core::games::find_installed_games).await.unwrap_or_default()
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
fn import_profiles(app: AppHandle, state: Shared, path: String) -> Result<Settings, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("não foi possível ler: {e}"))?;
    let mut s = lock(&state.settings).clone();
    store::import_profiles(&raw, &mut s)?;
    store::save(&state.settings_path, &s).map_err(|e| format!("não foi possível gravar: {e}"))?;
    *lock(&state.settings) = s.clone();
    refresh_tray(&app);
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
    refresh_tray(&app);
    Ok(s)
}

// ---------------------------------------------------------------------------
// Gravação (replay instantâneo e gameplay)
// ---------------------------------------------------------------------------

#[tauri::command]
fn recorder_status(state: Shared) -> recorder::RecorderStatus {
    state.recorder.status()
}

#[tauri::command]
async fn save_clip(app: AppHandle, seconds: Option<u32>) -> Result<String, String> {
    let st = app.state::<Arc<AppState>>().inner().clone();
    let secs = seconds.unwrap_or_else(|| lock(&st.settings).recorder.clip_seconds);
    let rec = st.recorder.clone();
    let colors = clip_colors(&st);
    let r = tauri::async_runtime::spawn_blocking(move || rec.save_clip(secs, colors)).await.map_err(|e| e.to_string())?;
    finish_export(&app, &st, r, true)
}

#[tauri::command]
fn start_recording(app: AppHandle, state: Shared) -> Result<(), String> {
    state.recorder.start_recording()?;
    notify(&app, "ok", tr(&state, "Gravando…", "Recording…"));
    Ok(())
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<String, String> {
    let st = app.state::<Arc<AppState>>().inner().clone();
    let rec = st.recorder.clone();
    let colors = clip_colors(&st);
    let r = tauri::async_runtime::spawn_blocking(move || rec.stop_recording(colors)).await.map_err(|e| e.to_string())?;
    finish_export(&app, &st, r, false)
}

/// Saturação do filtro aplicado agora no monitor principal, para os clipes
/// saírem com as mesmas cores da tela (a captura não vê o vibrance).
fn clip_colors(st: &AppState) -> Option<f32> {
    if !lock(&st.settings).recorder.clip_colors {
        return None;
    }
    let e = lock(&st.engine);
    let p = e.current(&e.primary_id()?)?;
    let f = goat_core::clips::vibrance_saturation(p);
    ((f - 1.0).abs() > 0.03).then_some(f)
}

/// Aviso no app e no Windows depois de salvar um vídeo.
fn finish_export(app: &AppHandle, st: &AppState, r: Result<PathBuf, String>, clip: bool) -> Result<String, String> {
    use tauri_plugin_notification::NotificationExt;
    match r {
        Ok(p) => {
            let rec = lock(&st.settings).recorder.clone();
            if rec.save_sound {
                goat_core::clips::play_beep();
            }
            st.recorder.cleanup(&rec);
            if let Some(sess) = lock(&st.session).as_mut() {
                sess.2 += 1;
            }
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            let title = if clip { tr(st, "Clipe salvo", "Clip saved") } else { tr(st, "Gravação salva", "Recording saved") };
            notify(app, "ok", format!("{title}: {name}"));
            let _ = app.notification().builder().title(title).body(&name).show();
            let _ = app.emit("clips-changed", ());
            Ok(p.to_string_lossy().into_owned())
        }
        Err(e) => {
            notify(app, "error", e.clone());
            let _ = app.notification().builder().title("Goat Filter").body(&e).show();
            Err(e)
        }
    }
}

#[tauri::command]
async fn test_recording(app: AppHandle) -> recorder::DiagReport {
    let st = app.state::<Arc<AppState>>().inner().clone();
    let s = lock(&st.settings).recorder.clone();
    let rec = st.recorder.clone();
    tauri::async_runtime::spawn_blocking(move || rec.diagnose(&s))
        .await
        .unwrap_or_else(|_| recorder::DiagReport { items: vec![], text: "falhou".into() })
}

#[tauri::command]
fn list_clips(state: Shared) -> Vec<recorder::ClipInfo> {
    state.recorder.list_clips()
}

#[tauri::command]
fn open_clip(app: AppHandle, state: Shared, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = state.recorder.checked_clip(&path)?;
    app.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_clip(app: AppHandle, state: Shared, path: Option<String>) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    match path {
        Some(p) => {
            let p = state.recorder.checked_clip(&p)?;
            app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
        }
        None => {
            let dir = state.recorder.folder();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
        }
    }
}

#[tauri::command]
fn delete_clip(state: Shared, path: String) -> Result<(), String> {
    state.recorder.delete(&path)
}

#[tauri::command]
async fn clip_thumbnail(app: AppHandle, path: String) -> Option<String> {
    let rec = app.state::<Arc<AppState>>().recorder.clone();
    tauri::async_runtime::spawn_blocking(move || rec.thumbnail(&path)).await.ok().flatten()
}

/// Libera a pasta dos clipes (só ela) para o player do editor de corte.
#[tauri::command]
fn allow_clip_folder(app: AppHandle, state: Shared) -> Result<(), String> {
    let dir = state.recorder.folder();
    app.asset_protocol_scope().allow_directory(&dir, false).map_err(|e| e.to_string())
}

#[tauri::command]
fn clip_markers(state: Shared, path: String) -> Vec<f64> {
    state.recorder.markers(&path)
}

#[tauri::command]
fn rename_clip(app: AppHandle, state: Shared, path: String, name: String) -> Result<String, String> {
    let p = state.recorder.rename(&path, &name)?;
    // Favorito acompanha o nome novo.
    let old = PathBuf::from(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let new = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let mut s = lock(&state.settings).clone();
    if let Some(f) = s.recorder.favorites.iter_mut().find(|f| **f == old) {
        *f = new;
        let s = store::sanitize(s);
        let _ = store::save(&state.settings_path, &s);
        *lock(&state.settings) = s;
    }
    let _ = app.emit("clips-changed", ());
    Ok(p.to_string_lossy().into_owned())
}

/// Ferramentas demoradas (corte, compressão, vertical) rodam fora da interface.
async fn clip_tool(
    app: AppHandle,
    f: impl FnOnce(&recorder::Recorder) -> Result<PathBuf, String> + Send + 'static,
) -> Result<String, String> {
    let rec = app.state::<Arc<AppState>>().recorder.clone();
    let p = tauri::async_runtime::spawn_blocking(move || f(&rec)).await.map_err(|e| e.to_string())??;
    let _ = app.emit("clips-changed", ());
    Ok(p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn trim_clip(app: AppHandle, path: String, start: f64, end: f64) -> Result<String, String> {
    clip_tool(app, move |r| r.trim(&path, start, end)).await
}

#[tauri::command]
async fn compress_clip(app: AppHandle, path: String, mb: u32) -> Result<String, String> {
    let mb = mb.clamp(5, 500);
    clip_tool(app, move |r| r.compress(&path, mb)).await
}

#[tauri::command]
async fn vertical_clip(app: AppHandle, path: String) -> Result<String, String> {
    clip_tool(app, move |r| r.vertical(&path)).await
}

#[tauri::command]
async fn send_clip_discord(app: AppHandle, path: String) -> Result<(), String> {
    let st = app.state::<Arc<AppState>>().inner().clone();
    let hook = lock(&st.settings).recorder.discord_webhook.clone();
    let rec = st.recorder.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let agent = http_agent()?;
        rec.send_discord(&path, &hook, &agent)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("clips-changed", ());
    Ok(())
}

#[tauri::command]
fn add_marker(app: AppHandle, state: Shared) -> Result<f64, String> {
    let at = state.recorder.add_marker()?;
    notify(&app, "ok", format!("{} {}", tr(&state, "Marcador em", "Marker at"), format_secs(at)));
    Ok(at)
}

fn format_secs(s: f64) -> String {
    let s = s.max(0.0) as u64;
    format!("{:02}:{:02}", s / 60, s % 60)
}

#[tauri::command]
async fn list_microphones(app: AppHandle) -> Vec<String> {
    let rec = app.state::<Arc<AppState>>().recorder.clone();
    tauri::async_runtime::spawn_blocking(move || rec.microphones()).await.unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Cuidados (v1.9): limpeza e histórico
// ---------------------------------------------------------------------------

#[tauri::command]
async fn clean_caches(app: AppHandle, apply: bool) -> Result<goat_core::care::CacheReport, String> {
    let st = app.state::<Arc<AppState>>().inner().clone();
    if apply && lock(&st.session).is_some() {
        return Err(tr(&st, "Feche o jogo antes de limpar.", "Close the game before cleaning."));
    }
    tauri::async_runtime::spawn_blocking(move || {
        goat_core::care::clean_caches(&goat_core::care::cache_dirs(), apply, std::time::SystemTime::now())
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryView {
    summary: goat_core::care::HistorySummary,
    recent: Vec<goat_core::care::SessionRecord>,
}

/// `offset_minutes`: fuso local em minutos (positivo a leste de UTC).
#[tauri::command]
fn game_history(state: Shared, offset_minutes: i64) -> HistoryView {
    let all = goat_core::care::load_history(&state.history_path);
    let summary = goat_core::care::summarize(&all, now_ms(), offset_minutes * 60_000);
    let recent = all.iter().rev().take(10).cloned().collect();
    HistoryView { summary, recent }
}

// ---------------------------------------------------------------------------
// Conforto (v1.11): voltar ao normal e backup
// ---------------------------------------------------------------------------

/// Desfaz tudo o que o Goat Filter mudou: cores, ajustes de mouse/teclado/energia
/// e para a gravação.
#[tauri::command]
fn reset_everything(app: AppHandle, state: Shared) {
    lock(&state.engine).restore_all();
    *lock(&state.paused) = None;
    lock(&state.perf).restore();
    state.recorder.shutdown();
    unstretch(&state);
    emit_monitors(&app, &state);
    notify(&app, "ok", tr(&state, "Tudo voltou ao normal.", "Everything is back to normal."));
}

#[tauri::command]
fn export_settings(state: Shared, path: String) -> Result<(), String> {
    let s = lock(&state.settings).clone();
    std::fs::write(&path, store::export_all(&s)).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_settings(app: AppHandle, state: Shared, path: String) -> Result<Settings, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let s = store::import_all(&text)?;
    save_settings(app, state, s)
}

/// Liga/desliga o replay pela bandeja.
fn toggle_replay(app: &AppHandle) {
    let st = app.state::<Arc<AppState>>();
    let mut s = lock(&st.settings).clone();
    s.recorder.replay = !s.recorder.replay;
    if store::save(&st.settings_path, &s).is_ok() {
        let on = s.recorder.replay;
        *lock(&st.settings) = s.clone();
        let _ = app.emit("settings-changed", s);
        refresh_tray(app);
        notify(
            app,
            "ok",
            if on { tr(&st, "Replay instantâneo ligado", "Instant replay on") } else { tr(&st, "Replay instantâneo desligado", "Instant replay off") },
        );
    }
}

// ---------------------------------------------------------------------------
// Resolução esticada
// ---------------------------------------------------------------------------

/// Resoluções que dá para esticar no monitor do jogo.
#[tauri::command]
fn stretch_options(state: Shared) -> Vec<goat_core::tweaks::Resolution> {
    let settings = lock(&state.settings).clone();
    let Some(gdi) = game_monitor(&settings) else { return vec![] };
    let modes = goat_core::tweaks::all_modes(&gdi);
    // Nativa = o maior modo do monitor.
    let native = modes.iter().map(|m| (m.0, m.1)).max_by_key(|m| m.0 as u64 * m.1 as u64).unwrap_or((1920, 1080));
    goat_core::tweaks::stretch_choices(&modes, native)
}

/// Estica por 10 segundos para conferir e volta sozinho.
#[tauri::command]
fn test_stretch(app: AppHandle, state: Shared, width: u32, height: u32) -> Result<(), String> {
    if lock(&state.stretched).is_some() {
        return Err(tr(&state, "A tela já está esticada.", "The screen is already stretched."));
    }
    let settings = lock(&state.settings).clone();
    let gdi = game_monitor(&settings).ok_or("monitor não encontrado")?;
    stretch(&state, &gdi, width, height)?;
    let st = state.inner().clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(10));
        // Só volta se o jogo não abriu nesse meio-tempo.
        if lock(&st.session).is_none() {
            unstretch(&st);
            let _ = app.emit("monitors-changed", lock(&st.engine).monitors());
        }
    });
    Ok(())
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
        if text.trim().is_empty() || goat_core::input::is_mouse_binding(text) {
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

/// Idioma das mensagens nativas: "en" ou "pt" ("auto" segue o Windows).
fn lang_en(state: &AppState) -> bool {
    match lock(&state.settings).language.as_str() {
        "en" => true,
        "pt" => false,
        _ => !sys_locale::get_locale().map(|l| l.to_lowercase().starts_with("pt")).unwrap_or(true),
    }
}

fn tr(state: &AppState, pt: &str, en: &str) -> String {
    if lang_en(state) { en.to_string() } else { pt.to_string() }
}

/// Monitores alvo dos atalhos e da bandeja (padrão ou todos).
fn targets(state: &AppState) -> Vec<String> {
    let settings = lock(&state.settings).clone();
    let engine = lock(&state.engine);
    goat_core::watcher::target_monitors(&settings, &engine)
}

fn apply_profile_now(app: &AppHandle, profile_id: &str) {
    let state = app.state::<Arc<AppState>>();
    let Some(p) = lock(&state.settings).profiles.iter().find(|p| p.id == profile_id).cloned() else { return };
    let mut err = None;
    for id in targets(&state) {
        if let Err(e) = lock(&state.engine).apply_with(&id, p.vibrance, p.tuning) {
            err.get_or_insert(e);
        }
    }
    *lock(&state.paused) = None;
    match err {
        None => notify(app, "ok", format!("{}: {} ({}%)", tr(&state, "Perfil", "Profile"), p.name, p.vibrance)),
        Some(e) => notify(app, "error", e),
    }
    emit_monitors(app, &state);
}

/// Ações compartilhadas por atalhos e bandeja.
fn run_action(app: &AppHandle, action: &str) {
    let state = app.state::<Arc<AppState>>();
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
                    drop(paused);
                    notify(app, "ok", tr(&state, "Goat Filter ligado", "Goat Filter on"));
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
                    drop(paused);
                    notify(
                        app,
                        "info",
                        tr(&state, "Goat Filter desligado (aperte de novo para ligar)", "Goat Filter off (press again to turn on)"),
                    );
                }
            }
        }
        "vibranceUp" | "vibranceDown" => {
            let ids = targets(&state);
            if ids.is_empty() {
                return;
            }
            let mut engine = lock(&state.engine);
            let max = if engine.method() == SuperMethod::None { DRIVER_MAX } else { SUPER_MAX };
            let cur = engine.current(&ids[0]).unwrap_or(50) as i16;
            let next = (cur + if action == "vibranceUp" { 10 } else { -10 }).clamp(0, max as i16) as u8;
            let mut err = None;
            for id in &ids {
                if let Err(e) = engine.apply(id, next) {
                    err.get_or_insert(e);
                }
            }
            drop(engine);
            *lock(&state.paused) = None;
            match err {
                None => notify(app, "ok", format!("Vibrance: {next}%")),
                Some(e) => notify(app, "error", e),
            }
        }
        "nextProfile" => {
            let profiles = lock(&state.settings).profiles.clone();
            if profiles.is_empty() {
                return;
            }
            let i = {
                let mut n = lock(&state.next_profile);
                *n = (*n + 1) % profiles.len();
                *n
            };
            apply_profile_now(app, &profiles[i].id);
            return;
        }
        "saveClip" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let st = app.state::<Arc<AppState>>().inner().clone();
                let secs = lock(&st.settings).recorder.clip_seconds;
                let _ = finish_export(&app, &st, st.recorder.save_clip(secs, clip_colors(&st)), true);
            });
            return;
        }
        "addMarker" => {
            if let Err(e) = state.recorder.add_marker().map(|at| {
                notify(app, "ok", format!("{} {}", tr(&state, "Marcador em", "Marker at"), format_secs(at)));
            }) {
                notify(app, "error", e);
            }
            return;
        }
        "toggleRecord" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let st = app.state::<Arc<AppState>>().inner().clone();
                if st.recorder.recording() {
                    let _ = finish_export(&app, &st, st.recorder.stop_recording(clip_colors(&st)), false);
                } else {
                    match st.recorder.start_recording() {
                        Ok(()) => {
                            use tauri_plugin_notification::NotificationExt;
                            let t = tr(&st, "Gravando… aperte de novo para parar", "Recording… press again to stop");
                            notify(&app, "ok", t.clone());
                            let _ = app.notification().builder().title("Goat Filter").body(t).show();
                        }
                        Err(e) => notify(&app, "error", e),
                    }
                }
                let _ = app.emit("recorder-changed", ());
            });
            return;
        }
        _ => return,
    }
    emit_monitors(app, &state);
}

fn on_hotkey(app: &AppHandle, sc: &Shortcut) {
    let state = app.state::<Arc<AppState>>();
    let Some(action) = lock(&state.hotkeys).iter().find(|(s, _)| s == sc).map(|(_, a)| *a) else { return };
    run_action(app, action);
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

/// Menu da bandeja: liga/desliga, perfis, restaurar, abrir e sair.
fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    use tauri::menu::{IsMenuItem, PredefinedMenuItem, Submenu};
    let state = app.state::<Arc<AppState>>();
    let profiles = lock(&state.settings).profiles.clone();
    let items: Vec<MenuItem<tauri::Wry>> = profiles
        .iter()
        .map(|p| MenuItem::with_id(app, format!("profile:{}", p.id), format!("{} ({}%)", p.name, p.vibrance), true, None::<&str>))
        .collect::<Result<_, _>>()?;
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<tauri::Wry>).collect();
    let profiles_menu = Submenu::with_items(app, tr(&state, "Aplicar perfil", "Apply profile"), !items.is_empty(), &refs)?;
    let toggle = MenuItem::with_id(app, "toggle", tr(&state, "Ligar / desligar filtro", "Turn filter on / off"), true, None::<&str>)?;
    let replay_on = lock(&state.settings).recorder.replay;
    let clip = MenuItem::with_id(app, "clip", tr(&state, "Salvar clipe agora", "Save clip now"), replay_on, None::<&str>)?;
    let replay = MenuItem::with_id(
        app,
        "replay",
        if replay_on {
            tr(&state, "Desligar replay instantâneo", "Turn off instant replay")
        } else {
            tr(&state, "Ligar replay instantâneo", "Turn on instant replay")
        },
        recorder::engine_available(),
        None::<&str>,
    )?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let restore = MenuItem::with_id(app, "restore", tr(&state, "Restaurar cores originais", "Restore original colors"), true, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", tr(&state, "Abrir Goat Filter", "Open Goat Filter"), true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", tr(&state, "Sair", "Quit"), true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&toggle, &profiles_menu, &sep0, &clip, &replay, &sep1, &restore, &open, &sep2, &quit])
}

/// Atualiza o menu quando perfis ou idioma mudam.
fn refresh_tray(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("goat-tray"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = tray_menu(app.handle())?;
    let mut tray = TrayIconBuilder::with_id("goat-tray")
        .tooltip("Goat Filter")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| {
            let id = e.id.as_ref();
            match id {
                "open" => show_main(app),
                "restore" => {
                    let st = app.state::<Arc<AppState>>();
                    lock(&st.engine).restore_all();
                    *lock(&st.paused) = None;
                    emit_monitors(app, &st);
                }
                "quit" => app.exit(0),
                "toggle" => run_action(app, "toggle"),
                "clip" => run_action(app, "saveClip"),
                "replay" => toggle_replay(app),
                _ => {
                    if let Some(pid) = id.strip_prefix("profile:") {
                        apply_profile_now(app, pid);
                    }
                }
            }
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

/// Aviso do Windows quando um perfil liga, pausa ou desliga.
fn notify_game(app: &AppHandle, state: &AppState, status: &GameStatus) {
    if !lock(&state.settings).notify {
        return;
    }
    use tauri_plugin_notification::NotificationExt;
    let profile = status
        .profile_id
        .as_ref()
        .and_then(|id| lock(&state.settings).profiles.iter().find(|p| &p.id == id).cloned());
    let body = match (status.state, &profile) {
        (GameState::Active, Some(p)) => format!("{} · {}%", p.name, p.vibrance),
        (GameState::Active, None) => tr(state, "Perfil ligado", "Profile on"),
        (GameState::Paused, _) => tr(state, "Jogo em segundo plano: cores normais", "Game in background: normal colors"),
        (GameState::Idle, _) => tr(state, "Jogo fechado: cores restauradas", "Game closed: colors restored"),
        (GameState::Unavailable, _) => return,
    };
    let _ = app.notification().builder().title("Goat Filter").body(body).show();
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
                        // Jogo acabou de abrir: fecha os apps escolhidos.
                        let was_active = matches!(lock(&state.game).state, GameState::Active | GameState::Paused);
                        if status.state == GameState::Active && !was_active && !settings.close_on_game.is_empty() {
                            let paths = if settings.reopen_apps {
                                goat_core::tweaks::running_paths(&settings.close_on_game)
                            } else {
                                Vec::new()
                            };
                            let n = goat_core::tweaks::close_apps(&settings.close_on_game);
                            if n > 0 {
                                log::info!("{n} app(s) fechados ao abrir o jogo");
                                *lock(&state.reopen) = paths;
                            }
                        }
                        // Começo e fim da partida (histórico e reabrir apps).
                        let is_on = matches!(status.state, GameState::Active | GameState::Paused);
                        if is_on && !was_active {
                            let prof = status.profile_id.as_ref().and_then(|id| settings.profiles.iter().find(|p| &p.id == id));
                            if let (Some(r), Some(gdi)) = (prof.and_then(|p| p.stretch), game_monitor(&settings)) {
                                if let Err(e) = stretch(&state, &gdi, r.width, r.height) {
                                    notify(&app, "error", format!("{}: {e}", tr(&state, "Resolução esticada", "Stretched resolution")));
                                }
                            }
                            let game = status
                                .profile_id
                                .as_ref()
                                .and_then(|id| settings.profiles.iter().find(|p| &p.id == id))
                                .map(|p| p.name.clone())
                                .unwrap_or_else(|| "Jogo".into());
                            *lock(&state.session) = Some((game, now_ms(), 0, None));
                        }
                        if !is_on && was_active {
                            unstretch(&state);
                            if let Some((game, start, clips, temp)) = lock(&state.session).take() {
                                let rec = goat_core::care::SessionRecord { game, start, end: now_ms(), clips, max_gpu_temp: temp };
                                if let Err(e) = goat_core::care::push_history(&state.history_path, rec) {
                                    log::warn!("Histórico: {e}");
                                }
                            }
                            let paths = std::mem::take(&mut *lock(&state.reopen));
                            if settings.reopen_apps && !paths.is_empty() {
                                let n = goat_core::tweaks::reopen(&paths);
                                log::info!("{n} app(s) reabertos depois do jogo");
                            }
                        }
                        notify_game(&app, &state, &status);
                        *lock(&state.game) = status.clone();
                        let _ = app.emit("game-status", status);
                        let list = lock(&state.engine).monitors();
                        let _ = app.emit("monitors-changed", list);
                    }
                }

                {
                    let rec = lock(&state.settings).recorder.clone();
                    let in_game = matches!(lock(&state.game).state, GameState::Active | GameState::Paused);
                    let mon = lock(&state.settings).default_monitor.clone();
                    state.recorder.tick(&rec, in_game, mon);
                }

                // Temperatura da GPU durante a partida (a cada 2 s).
                if tick % 4 == 0 && lock(&state.session).is_some() {
                    let temp = lock(&state.stats).sample().gpu_temp;
                    if let Some(sess) = lock(&state.session).as_mut() {
                        sess.3 = sess.3.max(temp);
                    }
                    let limit = lock(&state.settings).temp_alert;
                    let now = now_ms();
                    let last = *lock(&state.last_temp_alert);
                    if goat_core::care::should_alert(temp, limit, last, now) {
                        *lock(&state.last_temp_alert) = Some(now);
                        use tauri_plugin_notification::NotificationExt;
                        let body = format!(
                            "{} {}°C",
                            tr(&state, "A placa de vídeo está em", "Your graphics card is at"),
                            temp.unwrap_or_default()
                        );
                        notify(&app, "error", body.clone());
                        let _ = app.notification().builder().title("Goat Filter").body(body).show();
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
        .plugin(tauri_plugin_notification::init())
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

            // Atualização baixada na última vez? Instala agora, antes de mexer
            // em qualquer cor, e reabre já na versão nova.
            if let Some(udir) = updates_dir(app.handle()) {
                match updater::pending(&udir) {
                    Some(p) if settings.auto_update && updater::is_installed() => {
                        let minimized = std::env::args().any(|a| a == MINIMIZED_ARG);
                        match updater::launch(&p, minimized) {
                            Ok(()) => std::process::exit(0),
                            Err(e) => log::warn!("Não foi possível instalar a atualização: {e}"),
                        }
                    }
                    Some(_) => {}
                    None => updater::clear(&udir),
                }
            }
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
                stats: Mutex::new(Default::default()),
                recorder: recorder::Recorder::new(
                    app.path().app_local_data_dir().unwrap_or_else(|_| dir.clone()),
                    app.path()
                        .video_dir()
                        .unwrap_or_else(|_| dir.clone())
                        .join("Goat Filter"),
                ),
                reopen: Mutex::new(Vec::new()),
                session: Mutex::new(None),
                last_temp_alert: Mutex::new(None),
                history_path: dir.join("history.json"),
                stretched: Mutex::new(None),
                stretch_marker: dir.join("stretch.txt"),
            });
            app.manage(state.clone());
            // O PC desligou com a tela esticada? Volta ao normal.
            if let Ok(gdi) = std::fs::read_to_string(&state.stretch_marker) {
                let _ = goat_core::tweaks::reset_resolution(gdi.trim());
                let _ = std::fs::remove_file(&state.stretch_marker);
            }
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
            // Botões laterais do mouse (Raw Input: só lê, não bloqueia).
            let mouse_app = app.handle().clone();
            goat_core::input::spawn_mouse_listener(move |button| {
                let Some(name) = goat_core::input::button_name(button) else { return };
                let st = mouse_app.state::<Arc<AppState>>();
                let s = lock(&st.settings).clone();
                if !s.hotkeys {
                    return;
                }
                let action = s.bindings.all().into_iter().find(|(_, b)| *b == name).map(|(a, _)| a);
                if let Some(a) = action {
                    run_action(&mouse_app, a);
                }
            });
            {
                let st = state.clone();
                std::thread::spawn(move || {
                    let rec = lock(&st.settings).recorder.clone();
                    st.recorder.cleanup(&rec);
                });
            }
            spawn_background(app.handle().clone(), state);

            // Verifica atualização uma vez, alguns segundos depois de abrir.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                match fetch_update() {
                    Ok(u) if u.available => {
                        log::info!("Nova versão disponível: {:?}", u.latest);
                        let version = u.latest.clone().unwrap_or_default();
                        let _ = handle.emit("update-available", u.clone());
                        let auto = lock(&handle.state::<Arc<AppState>>().settings).auto_update;
                        if auto && updater::is_installed() {
                            match download_with_progress(&handle, &u) {
                                Ok(p) => {
                                    if !install_if_idle(&handle, &p) {
                                        notify(&handle, "ok", format!("Versão {} pronta — clique em Reiniciar e atualizar", p.version));
                                    }
                                }
                                Err(e) => {
                                    log::warn!("Atualização automática: {e}");
                                    notify(&handle, "info", format!("Nova versão {version} disponível"));
                                }
                            }
                        } else {
                            notify(&handle, "info", format!("Nova versão {version} disponível"));
                        }
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
            mouse_delta,
            get_snapshot,
            apply_vibrance,
            apply_tuned,
            monitor_hw,
            perf_status,
            set_game_mode,
            find_valorant,
            find_games,
            launch_game,
            display_modes,
            set_refresh_rate,
            windows_tweaks,
            set_game_dvr,
            request_hags,
            heavy_apps,
            close_apps_now,
            system_stats,
            open_windows_settings,
            check_update,
            open_release,
            open_logs,
            app_version,
            updater_state,
            install_update_now,
            update_now,
            export_profiles,
            import_profiles,
            restore_monitor,
            save_settings,
            recorder_status,
            save_clip,
            start_recording,
            stop_recording,
            list_clips,
            test_recording,
            open_clip,
            reveal_clip,
            delete_clip,
            clip_thumbnail,
            clip_markers,
            allow_clip_folder,
            rename_clip,
            trim_clip,
            compress_clip,
            vertical_clip,
            send_clip_discord,
            add_marker,
            list_microphones,
            clean_caches,
            game_history,
            reset_everything,
            stretch_options,
            test_stretch,
            export_settings,
            import_settings,
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
            st.recorder.shutdown();
            unstretch(&st);
        }
    });
}
