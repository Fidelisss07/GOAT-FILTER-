//! Aba Desempenho: ajustes reais e reversíveis do Windows aplicados enquanto
//! o jogo está aberto (aceleração do mouse, repetição do teclado, plano de
//! energia). Nada aqui toca no jogo nem simula teclas.
//!
//! Mouse e teclado são alterados só na sessão (sem gravar no perfil do
//! usuário): se o app travar, voltam ao normal no próximo login. O plano de
//! energia fica gravado, por isso o original vai para `perf.json` e é
//! restaurado na próxima abertura.

use crate::types::{PerfStatus, PerfTweaks};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// GUID do plano "Alto desempenho" do Windows.
pub const HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

pub trait SystemTweaks: Send {
    /// [limite1, limite2, aceleração]; aceleração 0 = desligada.
    fn mouse(&mut self) -> Result<[i32; 3], String>;
    fn set_mouse(&mut self, v: [i32; 3]) -> Result<(), String>;
    /// (atraso 0–3, velocidade 0–31).
    fn keyboard(&mut self) -> Result<(u32, u32), String>;
    fn set_keyboard(&mut self, delay: u32, speed: u32) -> Result<(), String>;
    fn power_scheme(&mut self) -> Result<String, String>;
    fn set_power_scheme(&mut self, guid: &str) -> Result<(), String>;
    fn game_mode(&mut self) -> Option<bool>;
    fn set_game_mode(&mut self, on: bool) -> Result<(), String>;
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
struct Saved {
    mouse: Option<[i32; 3]>,
    keyboard: Option<(u32, u32)>,
    power: Option<String>,
}

impl Saved {
    fn is_empty(&self) -> bool {
        self.mouse.is_none() && self.keyboard.is_none() && self.power.is_none()
    }
}

fn write_saved(path: &Option<PathBuf>, saved: &Saved) {
    let Some(p) = path else { return };
    if saved.is_empty() {
        let _ = std::fs::remove_file(p);
    } else if let Ok(s) = serde_json::to_string_pretty(saved) {
        let _ = std::fs::write(p, s);
    }
}

pub struct PerfManager {
    sys: Option<Box<dyn SystemTweaks>>,
    path: Option<PathBuf>,
    saved: Saved,
    applied: bool,
}

impl PerfManager {
    pub fn new(sys: Option<Box<dyn SystemTweaks>>, path: Option<PathBuf>) -> Self {
        let leftover: Saved = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut me = Self { sys, path, saved: leftover, applied: false };
        if !me.saved.is_empty() {
            log::info!("Desfazendo ajustes de desempenho de uma execução anterior");
            me.restore();
        }
        me
    }

    fn flush(&self) {
        write_saved(&self.path, &self.saved);
    }

    pub fn is_applied(&self) -> bool {
        self.applied
    }

    /// Aplica os ajustes ligados. Devolve os erros (um por ajuste que falhou).
    pub fn apply(&mut self, t: &PerfTweaks) -> Vec<String> {
        let mut errors = Vec::new();
        let Some(sys) = self.sys.as_mut() else {
            if t.mouse_accel_off || t.keyboard_fast || t.high_performance_power {
                errors.push("ajustes de desempenho indisponíveis neste sistema".into());
            }
            return errors;
        };
        if t.mouse_accel_off {
            match sys.mouse() {
                Ok(orig) => {
                    if self.saved.mouse.is_none() {
                        self.saved.mouse = Some(orig);
                    }
                    if let Err(e) = sys.set_mouse([0, 0, 0]) {
                        errors.push(format!("mouse: {e}"));
                    }
                }
                Err(e) => errors.push(format!("mouse: {e}")),
            }
        }
        if t.keyboard_fast {
            match sys.keyboard() {
                Ok(orig) => {
                    if self.saved.keyboard.is_none() {
                        self.saved.keyboard = Some(orig);
                    }
                    if let Err(e) = sys.set_keyboard(0, 31) {
                        errors.push(format!("teclado: {e}"));
                    }
                }
                Err(e) => errors.push(format!("teclado: {e}")),
            }
        }
        if t.high_performance_power {
            match sys.power_scheme() {
                Ok(orig) => {
                    if !orig.eq_ignore_ascii_case(HIGH_PERFORMANCE) {
                        if self.saved.power.is_none() {
                            self.saved.power = Some(orig);
                        }
                        // Grava antes de trocar: se travar no meio, dá para desfazer.
                        write_saved(&self.path, &self.saved);
                        if let Err(e) = sys.set_power_scheme(HIGH_PERFORMANCE) {
                            self.saved.power = None;
                            errors.push(format!("plano de energia: {e}"));
                        }
                    }
                }
                Err(e) => errors.push(format!("plano de energia: {e}")),
            }
        }
        self.flush();
        self.applied = true;
        for e in &errors {
            log::warn!("Desempenho: {e}");
        }
        errors
    }

    /// Volta tudo ao que estava antes.
    pub fn restore(&mut self) {
        if let Some(sys) = self.sys.as_mut() {
            if let Some(m) = self.saved.mouse.take() {
                let _ = sys.set_mouse(m);
            }
            if let Some((d, s)) = self.saved.keyboard.take() {
                let _ = sys.set_keyboard(d, s);
            }
            if let Some(p) = self.saved.power.take() {
                if let Err(e) = sys.set_power_scheme(&p) {
                    log::warn!("Restaurar plano de energia: {e}");
                }
            }
        }
        self.saved = Saved::default();
        self.applied = false;
        self.flush();
    }

    pub fn status(&mut self) -> PerfStatus {
        let applied = self.applied;
        let Some(sys) = self.sys.as_mut() else { return PerfStatus::default() };
        let kb = sys.keyboard().ok();
        PerfStatus {
            supported: true,
            mouse_accel: sys.mouse().ok().map(|m| m[2] != 0),
            keyboard_delay: kb.map(|k| k.0),
            keyboard_speed: kb.map(|k| k.1),
            power_high: sys.power_scheme().ok().map(|g| g.eq_ignore_ascii_case(HIGH_PERFORMANCE)),
            game_mode: sys.game_mode(),
            applied,
        }
    }

    pub fn set_game_mode(&mut self, on: bool) -> Result<(), String> {
        self.sys.as_mut().ok_or("indisponível")?.set_game_mode(on)
    }
}

/// Implementação falsa para testes e para rodar fora do Windows.
#[derive(Clone)]
pub struct MockSystem {
    pub state: std::sync::Arc<std::sync::Mutex<([i32; 3], (u32, u32), String, bool)>>,
    pub power_fails: bool,
}

impl Default for MockSystem {
    fn default() -> Self {
        Self {
            state: std::sync::Arc::new(std::sync::Mutex::new(([6, 10, 1], (1, 20), "balanced".into(), true))),
            power_fails: false,
        }
    }
}

impl SystemTweaks for MockSystem {
    fn mouse(&mut self) -> Result<[i32; 3], String> {
        Ok(self.state.lock().unwrap().0)
    }
    fn set_mouse(&mut self, v: [i32; 3]) -> Result<(), String> {
        self.state.lock().unwrap().0 = v;
        Ok(())
    }
    fn keyboard(&mut self) -> Result<(u32, u32), String> {
        Ok(self.state.lock().unwrap().1)
    }
    fn set_keyboard(&mut self, d: u32, s: u32) -> Result<(), String> {
        self.state.lock().unwrap().1 = (d, s);
        Ok(())
    }
    fn power_scheme(&mut self) -> Result<String, String> {
        Ok(self.state.lock().unwrap().2.clone())
    }
    fn set_power_scheme(&mut self, g: &str) -> Result<(), String> {
        if self.power_fails {
            return Err("plano não existe neste PC".into());
        }
        self.state.lock().unwrap().2 = g.into();
        Ok(())
    }
    fn game_mode(&mut self) -> Option<bool> {
        Some(self.state.lock().unwrap().3)
    }
    fn set_game_mode(&mut self, on: bool) -> Result<(), String> {
        self.state.lock().unwrap().3 = on;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all() -> PerfTweaks {
        PerfTweaks { mouse_accel_off: true, keyboard_fast: true, high_performance_power: true }
    }

    #[test]
    fn applies_and_restores() {
        let sys = MockSystem::default();
        let mut p = PerfManager::new(Some(Box::new(sys.clone())), None);
        assert!(p.apply(&all()).is_empty());
        {
            let s = sys.state.lock().unwrap();
            assert_eq!(s.0, [0, 0, 0]);
            assert_eq!(s.1, (0, 31));
            assert_eq!(s.2, HIGH_PERFORMANCE);
        }
        assert!(p.status().applied);
        // aplicar de novo não perde o original
        p.apply(&all());
        p.restore();
        let s = sys.state.lock().unwrap();
        assert_eq!(s.0, [6, 10, 1]);
        assert_eq!(s.1, (1, 20));
        assert_eq!(s.2, "balanced");
    }

    #[test]
    fn only_enabled_tweaks_change() {
        let sys = MockSystem::default();
        let mut p = PerfManager::new(Some(Box::new(sys.clone())), None);
        p.apply(&PerfTweaks { mouse_accel_off: true, ..Default::default() });
        let s = sys.state.lock().unwrap();
        assert_eq!(s.0, [0, 0, 0]);
        assert_eq!(s.1, (1, 20));
        assert_eq!(s.2, "balanced");
    }

    #[test]
    fn power_failure_is_reported() {
        let sys = MockSystem { power_fails: true, ..Default::default() };
        let mut p = PerfManager::new(Some(Box::new(sys.clone())), None);
        let errs = p.apply(&all());
        assert_eq!(errs.len(), 1);
        assert!(errs[0].contains("plano de energia"));
        p.restore();
        assert_eq!(sys.state.lock().unwrap().2, "balanced");
    }

    #[test]
    fn crash_recovery_restores_power_plan() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("perf.json");
        let sys = MockSystem::default();
        {
            let mut p = PerfManager::new(Some(Box::new(sys.clone())), Some(path.clone()));
            p.apply(&all());
            std::mem::forget(p);
        }
        assert_eq!(sys.state.lock().unwrap().2, HIGH_PERFORMANCE);
        let _p = PerfManager::new(Some(Box::new(sys.clone())), Some(path.clone()));
        assert_eq!(sys.state.lock().unwrap().2, "balanced");
        assert!(!path.exists());
    }
}
