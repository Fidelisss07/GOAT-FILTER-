//! Detecta quando o jogo de um perfil abre/fecha olhando a lista de processos.
//! Só lê nomes de processos; nunca abre, injeta ou lê memória do jogo.

use crate::engine::Engine;
use crate::types::{GameState, GameStatus, Settings};
use std::collections::HashSet;

/// Ticks (de ~1 s) até reaplicar depois que o jogo abre: a tela cheia
/// às vezes reseta as cores durante a inicialização.
const REAPPLY_AFTER: u8 = 4;

struct Active {
    profile_id: String,
    monitor_id: String,
    before: Option<u8>,
    reapply_in: u8,
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

    /// Chamado a cada ~1 s. Devolve `Some` quando o estado muda.
    pub fn tick(&mut self, running: &HashSet<String>, settings: &Settings, engine: &mut Engine) -> Option<GameStatus> {
        if let Some(a) = self.active.as_mut() {
            let profile = settings.profiles.iter().find(|p| p.id == a.profile_id);
            let still_running = profile
                .map(|p| process_names_for(&p.executable).iter().any(|n| running.contains(n)))
                .unwrap_or(false);
            if still_running {
                if a.reapply_in > 0 {
                    a.reapply_in -= 1;
                    if a.reapply_in == 0 {
                        if let Some(p) = profile {
                            if let Err(e) = engine.apply(&a.monitor_id, p.vibrance) {
                                log::warn!("Reaplicar perfil falhou: {e}");
                            }
                        }
                    }
                }
                return None;
            }
            // Jogo fechou.
            let a = self.active.take().unwrap();
            let restore = profile.map(|p| p.restore_on_close).unwrap_or(true);
            if restore {
                let target = a.before.or_else(|| engine.monitors().into_iter().find(|m| m.id == a.monitor_id).and_then(|m| m.original));
                if let Some(v) = target {
                    if let Err(e) = engine.apply(&a.monitor_id, v) {
                        log::warn!("Restaurar ao fechar falhou: {e}");
                    }
                }
            }
            return Some(GameStatus::idle());
        }

        let profile = settings
            .profiles
            .iter()
            .filter(|p| p.apply_on_open)
            .find(|p| process_names_for(&p.executable).iter().any(|n| running.contains(n)))?;

        let monitor_id = settings
            .default_monitor
            .clone()
            .filter(|id| engine.has_monitor(id))
            .or_else(|| engine.primary_id())?;
        let before = engine.current(&monitor_id);
        let message = engine.apply(&monitor_id, profile.vibrance).err();
        self.active = Some(Active {
            profile_id: profile.id.clone(),
            monitor_id,
            before,
            reapply_in: REAPPLY_AFTER,
        });
        Some(GameStatus { state: GameState::Active, profile_id: Some(profile.id.clone()), message })
    }
}

/// Nomes (minúsculos) dos processos em execução.
#[cfg(windows)]
pub fn running_processes() -> HashSet<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut set = HashSet::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return set };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let end = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
                set.insert(String::from_utf16_lossy(&e.szExeFile[..end]).to_lowercase());
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    set
}

#[cfg(not(windows))]
pub fn running_processes() -> HashSet<String> {
    HashSet::new()
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
        assert!(w.tick(&procs(&["explorer.exe"]), &s, &mut e).is_none());
        let st = w.tick(&procs(&["valorant-win64-shipping.exe"]), &s, &mut e).unwrap();
        assert_eq!(st.state, GameState::Active);
        assert_eq!(drv.level("D1"), Some(75));
        // fechou → restaura o que estava antes
        let st = w.tick(&procs(&["explorer.exe"]), &s, &mut e).unwrap();
        assert_eq!(st.state, GameState::Idle);
        assert_eq!(drv.level("D1"), Some(50));
    }

    #[test]
    fn respects_toggles() {
        let (drv, mut e, mut s) = setup();
        s.profiles[0].restore_on_close = false;
        let mut w = GameWatcher::default();
        w.tick(&procs(&["valorant.exe"]), &s, &mut e);
        w.tick(&procs(&[]), &s, &mut e);
        assert_eq!(drv.level("D1"), Some(75));

        s.profiles[0].apply_on_open = false;
        let mut w = GameWatcher::default();
        assert!(w.tick(&procs(&["valorant.exe"]), &s, &mut e).is_none());
    }

    #[test]
    fn names_from_path() {
        assert_eq!(process_names_for(r"C:\Riot Games\VALORANT\live\VALORANT.exe").len(), 2);
        assert_eq!(process_names_for(r"D:\Games\cs2.exe"), vec!["cs2.exe".to_string()]);
        assert!(process_names_for("").is_empty());
    }
}
