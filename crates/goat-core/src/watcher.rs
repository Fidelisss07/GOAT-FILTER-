//! Detecta quando o jogo de um perfil abre/fecha olhando a lista de processos.
//! Só lê nomes de processos; nunca abre, injeta ou lê memória do jogo.

use crate::engine::Engine;
use crate::perf::PerfManager;
use crate::types::{GameState, GameStatus, Profile, Settings, Tuning};
use std::collections::HashSet;

/// Ticks (de ~0,5 s) até reaplicar depois que o jogo abre/volta ao foco: a
/// tela cheia às vezes reseta as cores durante a inicialização.
const REAPPLY_AFTER: u8 = 8;

struct Active {
    profile_id: String,
    /// Monitores alterados e como cada um estava antes.
    targets: Vec<(String, (Option<u8>, Tuning))>,
    reapply_in: u8,
    /// Perfil desfeito porque o jogo saiu do foco.
    suspended: bool,
}

fn status(state: GameState, profile: &Profile, message: Option<String>) -> GameStatus {
    GameStatus { state, profile_id: Some(profile.id.clone()), message }
}

fn restore_before(engine: &mut Engine, a: &Active) {
    for (id, before) in &a.targets {
        let target = before.0.or_else(|| engine.monitors().into_iter().find(|m| &m.id == id).and_then(|m| m.original));
        if let Some(v) = target {
            if let Err(e) = engine.apply_with(id, v, before.1) {
                log::warn!("Restaurar cores do jogo falhou: {e}");
            }
        }
    }
}

/// Monitores onde os perfis são aplicados: todos ou só o padrão.
pub fn target_monitors(settings: &Settings, engine: &Engine) -> Vec<String> {
    if settings.apply_all_monitors {
        let all = engine.monitor_ids();
        if !all.is_empty() {
            return all;
        }
    }
    settings
        .default_monitor
        .clone()
        .filter(|id| engine.has_monitor(id))
        .or_else(|| engine.primary_id())
        .into_iter()
        .collect()
}

/// Aplica o perfil em cada monitor; devolve o primeiro erro.
fn apply_profile(engine: &mut Engine, a: &Active, p: &Profile) -> Option<String> {
    let mut err = None;
    for (id, _) in &a.targets {
        if let Err(e) = engine.apply_with(id, p.vibrance, p.tuning) {
            err.get_or_insert(e);
        }
    }
    err
}

#[derive(Default)]
pub struct GameWatcher {
    active: Option<Active>,
}

/// Nomes de processo (minúsculos) que ativam um perfil.
pub fn process_names_for(executable: &str) -> Vec<String> {
    let file = executable.rsplit(['\\', '/']).next().unwrap_or(executable).trim().to_lowercase();
    if file.is_empty() {
        return vec![];
    }
    let mut v = vec![file.clone()];
    // O VALORANT.exe é o lançador; o jogo em si é o processo -Shipping.
    if file == "valorant.exe" {
        v.push("valorant-win64-shipping.exe".into());
    }
    v
}

impl GameWatcher {
    pub fn active_profile(&self) -> Option<&str> {
        self.active.as_ref().map(|a| a.profile_id.as_str())
    }

    /// Chamado a cada ~0,5 s. `foreground` é o executável da janela em primeiro
    /// plano (minúsculo), quando conhecido. Devolve `Some` quando o estado muda.
    pub fn tick(
        &mut self,
        running: &HashSet<String>,
        foreground: Option<&str>,
        settings: &Settings,
        engine: &mut Engine,
        perf: &mut PerfManager,
    ) -> Option<GameStatus> {
        // Junta erros das cores e dos ajustes de desempenho numa mensagem só.
        let join = |a: Option<String>, b: Vec<String>| -> Option<String> {
            let mut all: Vec<String> = a.into_iter().collect();
            all.extend(b.into_iter().map(|e| format!("Desempenho: {e}")));
            (!all.is_empty()).then(|| all.join(" · "))
        };
        if let Some(a) = self.active.as_mut() {
            let profile = settings.profiles.iter().find(|p| p.id == a.profile_id);
            let names = profile.map(|p| process_names_for(&p.executable)).unwrap_or_default();
            let still_running = names.iter().any(|n| running.contains(n));
            if still_running {
                let p = profile.unwrap();
                // Desconhecido = considera em foco (nunca desliga à toa).
                let focused = foreground.map(|f| names.iter().any(|n| n == f)).unwrap_or(true);
                if p.focus_only && !focused && !a.suspended {
                    restore_before(engine, a);
                    perf.restore();
                    a.suspended = true;
                    return Some(status(GameState::Paused, p, None));
                }
                if a.suspended && (focused || !p.focus_only) {
                    a.suspended = false;
                    a.reapply_in = REAPPLY_AFTER;
                    let msg = apply_profile(engine, a, p);
                    let perf_errs = perf.apply(&settings.perf);
                    return Some(status(GameState::Active, p, join(msg, perf_errs)));
                }
                if !a.suspended && a.reapply_in > 0 {
                    a.reapply_in -= 1;
                    if a.reapply_in == 0 {
                        if let Some(e) = apply_profile(engine, a, p) {
                            log::warn!("Reaplicar perfil falhou: {e}");
                        }
                    }
                }
                return None;
            }
            // Jogo fechou.
            let a = self.active.take().unwrap();
            let restore = profile.map(|p| p.restore_on_close).unwrap_or(true);
            if restore && !a.suspended {
                restore_before(engine, &a);
            }
            perf.restore();
            return Some(GameStatus::idle());
        }

        let profile = settings
            .profiles
            .iter()
            .filter(|p| p.apply_on_open)
            .find(|p| process_names_for(&p.executable).iter().any(|n| running.contains(n)))?;

        let ids = target_monitors(settings, engine);
        if ids.is_empty() {
            return None;
        }
        let targets: Vec<(String, (Option<u8>, Tuning))> = ids
            .into_iter()
            .map(|id| {
                let before = (engine.current(&id), engine.tuning(&id).unwrap_or_default());
                (id, before)
            })
            .collect();
        let names = process_names_for(&profile.executable);
        let focused = foreground.map(|f| names.iter().any(|n| n == f)).unwrap_or(true);
        if profile.focus_only && !focused {
            self.active = Some(Active { profile_id: profile.id.clone(), targets, reapply_in: 0, suspended: true });
            return Some(status(GameState::Paused, profile, None));
        }
        let a = Active { profile_id: profile.id.clone(), targets, reapply_in: REAPPLY_AFTER, suspended: false };
        let message = apply_profile(engine, &a, profile);
        let perf_errs = perf.apply(&settings.perf);
        let message = join(message, perf_errs);
        self.active = Some(a);
        Some(status(GameState::Active, profile, message))
    }
}

/// Processos em execução (nomes minúsculos) e o executável da janela em
/// primeiro plano. Não abre handle de nenhum processo: só compara o PID da
/// janela da frente com a lista do sistema.
#[cfg(windows)]
pub fn process_snapshot() -> (HashSet<String>, Option<String>) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};

    let mut set = HashSet::new();
    let mut fg_name = None;
    unsafe {
        let mut fg_pid = 0u32;
        let hwnd = GetForegroundWindow();
        if !hwnd.0.is_null() {
            GetWindowThreadProcessId(hwnd, Some(&mut fg_pid));
        }
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return (set, None) };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let end = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                let name = String::from_utf16_lossy(&e.szExeFile[..end]).to_lowercase();
                if fg_pid != 0 && e.th32ProcessID == fg_pid {
                    fg_name = Some(name.clone());
                }
                set.insert(name);
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    (set, fg_name)
}

#[cfg(not(windows))]
pub fn process_snapshot() -> (HashSet<String>, Option<String>) {
    (HashSet::new(), None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::mock::{MockDriver, MockSuper};
    use crate::backends::{Detected, SuperLayer};
    use crate::monitors::Display;

    fn setup() -> (MockDriver, Engine, Settings) {
        let drv = MockDriver::with(&[("D1", 50)]);
        let e = Engine::new(
            Detected {
                drivers: vec![Box::new(drv.clone())],
                super_layers: vec![Box::new(MockSuper::default()) as Box<dyn SuperLayer>],
                super_reasons: vec![],
                curves: None,
                hw: None,
            },
            vec![Display { id: "D1".into(), name: "M".into(), primary: true }],
            None,
            false,
        );
        (drv, e, Settings::default())
    }

    fn procs(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn valorant_shipping_process_triggers_profile() {
        let (drv, mut e, s) = setup();
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        assert!(w.tick(&procs(&["explorer.exe"]), None, &s, &mut e, &mut pm).is_none());
        let st = w.tick(&procs(&["valorant-win64-shipping.exe"]), None, &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Active);
        assert_eq!(drv.level("D1"), Some(75));
        // fechou → restaura o que estava antes
        let st = w.tick(&procs(&["explorer.exe"]), None, &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Idle);
        assert_eq!(drv.level("D1"), Some(50));
    }

    #[test]
    fn respects_toggles() {
        let (drv, mut e, mut s) = setup();
        s.profiles[0].restore_on_close = false;
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        w.tick(&procs(&["valorant.exe"]), None, &s, &mut e, &mut pm);
        w.tick(&procs(&[]), None, &s, &mut e, &mut pm);
        assert_eq!(drv.level("D1"), Some(75));

        s.profiles[0].apply_on_open = false;
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        assert!(w.tick(&procs(&["valorant.exe"]), None, &s, &mut e, &mut pm).is_none());
    }

    #[test]
    fn names_from_path() {
        assert_eq!(process_names_for(r"C:\Riot Games\VALORANT\live\VALORANT.exe").len(), 2);
        assert_eq!(process_names_for(r"D:\Games\cs2.exe"), vec!["cs2.exe".to_string()]);
        assert!(process_names_for("").is_empty());
    }

    #[test]
    fn focus_only_pauses_on_alt_tab() {
        let (drv, mut e, mut s) = setup();
        s.profiles[0].focus_only = true;
        let game = procs(&["valorant-win64-shipping.exe", "discord.exe"]);
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        let st = w.tick(&game, Some("valorant-win64-shipping.exe"), &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Active);
        assert_eq!(drv.level("D1"), Some(75));
        // alt-tab para o Discord
        let st = w.tick(&game, Some("discord.exe"), &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Paused);
        assert_eq!(drv.level("D1"), Some(50));
        assert!(w.tick(&game, Some("discord.exe"), &s, &mut e, &mut pm).is_none());
        // volta ao jogo
        let st = w.tick(&game, Some("valorant-win64-shipping.exe"), &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Active);
        assert_eq!(drv.level("D1"), Some(75));
        // fecha o jogo estando em segundo plano: já estava restaurado
        w.tick(&game, Some("discord.exe"), &s, &mut e, &mut pm);
        let st = w.tick(&procs(&["discord.exe"]), Some("discord.exe"), &s, &mut e, &mut pm).unwrap();
        assert_eq!(st.state, GameState::Idle);
        assert_eq!(drv.level("D1"), Some(50));
    }

    #[test]
    fn profile_tuning_is_applied_and_reverted() {
        let (_drv, mut e, mut s) = setup();
        s.profiles[0].tuning.gamma = 140;
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        w.tick(&procs(&["valorant.exe"]), None, &s, &mut e, &mut pm);
        assert_eq!(e.tuning("D1").unwrap().gamma, 140);
        w.tick(&procs(&[]), None, &s, &mut e, &mut pm);
        assert_eq!(e.tuning("D1").unwrap(), Tuning::default());
    }

    #[test]
    fn perf_tweaks_follow_the_game() {
        use crate::perf::MockSystem;
        let (_drv, mut e, mut s) = setup();
        s.perf.mouse_accel_off = true;
        s.profiles[0].focus_only = true;
        let sys = MockSystem::default();
        let mut pm = PerfManager::new(Some(Box::new(sys.clone())), None);
        let mut w = GameWatcher::default();
        let game = procs(&["valorant-win64-shipping.exe"]);
        w.tick(&game, Some("valorant-win64-shipping.exe"), &s, &mut e, &mut pm);
        assert_eq!(sys.state.lock().unwrap().0, [0, 0, 0]);
        // alt-tab: volta ao normal
        w.tick(&game, Some("chrome.exe"), &s, &mut e, &mut pm);
        assert_eq!(sys.state.lock().unwrap().0, [6, 10, 1]);
        // volta ao jogo e fecha
        w.tick(&game, Some("valorant-win64-shipping.exe"), &s, &mut e, &mut pm);
        assert_eq!(sys.state.lock().unwrap().0, [0, 0, 0]);
        w.tick(&procs(&[]), None, &s, &mut e, &mut pm);
        assert_eq!(sys.state.lock().unwrap().0, [6, 10, 1]);
    }

    #[test]
    fn all_monitors_option() {
        let drv = MockDriver::with(&[("D1", 50), ("D2", 40)]);
        let mut e = Engine::new(
            Detected {
                drivers: vec![Box::new(drv.clone())],
                super_layers: vec![Box::new(MockSuper::default()) as Box<dyn SuperLayer>],
                super_reasons: vec![],
                curves: None,
                hw: None,
            },
            vec![
                Display { id: "D1".into(), name: "A".into(), primary: true },
                Display { id: "D2".into(), name: "B".into(), primary: false },
            ],
            None,
            false,
        );
        let mut s = Settings::default();
        s.apply_all_monitors = true;
        let mut w = GameWatcher::default();
        let mut pm = PerfManager::new(None, None);
        w.tick(&procs(&["valorant.exe"]), None, &s, &mut e, &mut pm);
        assert_eq!(drv.level("D1"), Some(75));
        assert_eq!(drv.level("D2"), Some(75));
        w.tick(&procs(&[]), None, &s, &mut e, &mut pm);
        assert_eq!(drv.level("D1"), Some(50));
        assert_eq!(drv.level("D2"), Some(40));
    }
}
