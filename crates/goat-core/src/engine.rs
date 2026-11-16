//! Junta as camadas: driver (0–100%) + Super (acima de 100%, ou tudo quando o
//! driver não tem vibrance) e garante a restauração dos valores originais.

use crate::backends::mapping::super_factor;
use crate::backends::{Detected, DriverVibrance, SuperLayer};
use crate::monitors::Display;
use crate::session::Session;
use crate::types::{Capabilities, DriverKind, MonitorInfo, SuperMethod, DRIVER_MAX, NEUTRAL, SUPER_MAX};
use std::collections::HashMap;
use std::path::PathBuf;

struct Mon {
    display: Display,
    driver: Option<usize>,
    current: Option<u8>,
    original: Option<u8>,
}

pub struct Engine {
    drivers: Vec<Box<dyn DriverVibrance>>,
    super_layer: Option<Box<dyn SuperLayer>>,
    super_reason: Option<String>,
    monitors: Vec<Mon>,
    session: Session,
    factors: HashMap<String, f32>,
    demo: bool,
}

impl Engine {
    pub fn new(detected: Detected, displays: Vec<Display>, session_path: Option<PathBuf>, demo: bool) -> Self {
        let (session, leftover) = Session::open(session_path);
        let mut e = Self {
            drivers: detected.drivers,
            super_layer: detected.super_layer,
            super_reason: detected.super_reason,
            monitors: Vec::new(),
            session,
            factors: HashMap::new(),
            demo,
        };
        // Sessão anterior não terminou direito (crash/desligamento): devolve as cores.
        for (display, value) in leftover.originals {
            if let Some(i) = e.driver_for(&display) {
                match e.drivers[i].set(&display, value) {
                    Ok(()) => log::info!("Restaurado {display} para {value}% após encerramento inesperado"),
                    Err(err) => log::warn!("Falha ao restaurar {display}: {err}"),
                }
            }
        }
        e.session.clear();
        e.refresh(displays);
        e
    }

    fn driver_for(&mut self, display: &str) -> Option<usize> {
        self.drivers.iter_mut().position(|d| d.supports(display))
    }

    /// Atualiza a lista de monitores (hotplug). Devolve true se mudou.
    pub fn refresh(&mut self, displays: Vec<Display>) -> bool {
        let old_ids: Vec<String> = self.monitors.iter().map(|m| m.display.id.clone()).collect();
        let mut old: HashMap<String, Mon> = self.monitors.drain(..).map(|m| (m.display.id.clone(), m)).collect();
        let mut next = Vec::new();
        for d in displays {
            if let Some(mut m) = old.remove(&d.id) {
                m.display = d;
                next.push(m);
                continue;
            }
            let driver = self.driver_for(&d.id);
            let current = match driver {
                Some(i) => self.drivers[i].get(&d.id).ok(),
                None => self.super_layer.as_ref().map(|_| NEUTRAL),
            };
            next.push(Mon { original: current, current, driver, display: d });
        }
        // Monitores que sumiram não contam mais na camada Super.
        for id in old.keys() {
            self.factors.remove(id);
        }
        self.monitors = next;
        if !old.is_empty() {
            let _ = self.push_super();
        }
        let new_ids: Vec<String> = self.monitors.iter().map(|m| m.display.id.clone()).collect();
        old_ids != new_ids
    }

    pub fn capabilities(&self) -> Capabilities {
        Capabilities {
            demo: self.demo,
            super_method: self.super_layer.as_ref().map(|s| s.method()).unwrap_or(SuperMethod::None),
            super_reason: self.super_reason.clone(),
        }
    }

    pub fn monitors(&mut self) -> Vec<MonitorInfo> {
        (0..self.monitors.len()).map(|i| self.info(i)).collect()
    }

    pub fn has_monitor(&self, id: &str) -> bool {
        self.monitors.iter().any(|m| m.display.id == id)
    }

    pub fn primary_id(&self) -> Option<String> {
        self.monitors.iter().find(|m| m.display.primary).or(self.monitors.first()).map(|m| m.display.id.clone())
    }

    pub fn current(&self, id: &str) -> Option<u8> {
        self.monitors.iter().find(|m| m.display.id == id).and_then(|m| m.current)
    }

    fn info(&mut self, i: usize) -> MonitorInfo {
        let (id, driver) = (self.monitors[i].display.id.clone(), self.monitors[i].driver);
        let driver_default = driver.and_then(|d| self.drivers[d].default_percent(&id));
        let m = &self.monitors[i];
        let original = self.session.original(&id).or(m.original);
        MonitorInfo {
            id,
            name: m.display.name.clone(),
            primary: m.display.primary,
            driver: driver.map(|d| self.drivers[d].kind()).unwrap_or(DriverKind::None),
            current: m.current,
            driver_default,
            original,
        }
    }

    fn index(&self, id: &str) -> Result<usize, String> {
        self.monitors
            .iter()
            .position(|m| m.display.id == id)
            .ok_or_else(|| "Monitor desconectado.".to_string())
    }

    /// Aplica um valor 0–200 do Goat Filter em um monitor.
    pub fn apply(&mut self, id: &str, percent: u8) -> Result<MonitorInfo, String> {
        let i = self.index(id)?;
        let p = percent.min(SUPER_MAX);
        let driver = self.monitors[i].driver;
        let factor = super_factor(p, driver.is_some());
        let needs_super = (factor - 1.0).abs() > 1e-4;
        if needs_super && self.super_layer.is_none() {
            return Err(match driver {
                Some(_) => "Super Vibrance indisponível neste PC: o limite é 100%.".into(),
                None => "Este monitor não tem Digital Vibrance no driver e a camada Super está indisponível.".into(),
            });
        }

        if let Some(d) = driver {
            if self.session.original(id).is_none() {
                let before = self.drivers[d].get(id).ok().or(self.monitors[i].current.map(|c| c.min(DRIVER_MAX)));
                if let Some(b) = before {
                    self.session.remember(id, b);
                }
            }
            self.drivers[d].set(id, p.min(DRIVER_MAX)).map_err(|e| format!("Driver: {e}"))?;
        }

        let previous = self.factors.insert(id.to_string(), factor);
        if let Err(e) = self.push_super() {
            match previous {
                Some(f) => self.factors.insert(id.to_string(), f),
                None => self.factors.remove(id),
            };
            if driver.is_some() {
                // A parte do driver já foi aplicada; reflete o valor real.
                self.monitors[i].current = Some(p.min(DRIVER_MAX));
            }
            return Err(format!("Super Vibrance: {e}"));
        }
        self.monitors[i].current = Some(p);
        Ok(self.info(i))
    }

    /// "Restaurar padrão": padrão do driver; sem driver, o valor anterior.
    pub fn restore(&mut self, id: &str) -> Result<MonitorInfo, String> {
        let i = self.index(id)?;
        let target = match self.monitors[i].driver {
            Some(d) => self.drivers[d].default_percent(id),
            None => None,
        }
        .or(self.session.original(id))
        .or(self.monitors[i].original)
        .unwrap_or(NEUTRAL);
        self.apply(id, target)
    }

    /// Devolve tudo como estava antes do Goat Filter (sair do app).
    pub fn restore_all(&mut self) {
        for (display, value) in self.session.originals() {
            if let Some(i) = self.monitors.iter().position(|m| m.display.id == display) {
                if let Some(d) = self.monitors[i].driver {
                    if self.drivers[d].set(&display, value).is_ok() {
                        self.monitors[i].current = Some(value);
                    }
                }
            } else if let Some(d) = self.driver_for(&display) {
                let _ = self.drivers[d].set(&display, value);
            }
        }
        self.factors.clear();
        let _ = self.push_super();
        for m in self.monitors.iter_mut().filter(|m| m.driver.is_none()) {
            m.current = Some(NEUTRAL);
        }
        self.session.clear();
    }

    /// Saída normal do app. Com `restore`, devolve as cores originais; sem,
    /// mantém o driver como está e só encerra a sessão (para a próxima
    /// abertura não "restaurar" algo que o usuário quis manter).
    pub fn end_session(&mut self, restore: bool) {
        if restore {
            self.restore_all();
        } else {
            self.factors.clear();
            let _ = self.push_super();
            self.session.clear();
        }
    }

    /// A camada Super é global: usa o fator mais distante de 1.0.
    fn push_super(&mut self) -> Result<(), String> {
        let f = self
            .factors
            .values()
            .copied()
            .fold(1.0f32, |acc, f| if (f - 1.0).abs() > (acc - 1.0).abs() { f } else { acc });
        match self.super_layer.as_mut() {
            Some(s) => s.set_factor(f).map_err(|e| e.to_string()),
            None if (f - 1.0).abs() > 1e-4 => Err("indisponível".into()),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::mock::{MockDriver, MockSuper};

    fn displays() -> Vec<Display> {
        vec![
            Display { id: "D1".into(), name: "Redragon".into(), primary: true },
            Display { id: "D2".into(), name: "Notebook".into(), primary: false },
        ]
    }

    fn engine(drv: &MockDriver, sup: Option<&MockSuper>, path: Option<PathBuf>) -> Engine {
        Engine::new(
            Detected {
                drivers: vec![Box::new(drv.clone())],
                super_layer: sup.map(|s| Box::new(s.clone()) as Box<dyn SuperLayer>),
                super_reason: None,
            },
            displays(),
            path,
            false,
        )
    }

    #[test]
    fn driver_range_only_uses_driver() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        let m = e.apply("D1", 80).unwrap();
        assert_eq!(m.current, Some(80));
        assert_eq!(drv.level("D1"), Some(80));
        assert_eq!(sup.get(), 1.0);
    }

    #[test]
    fn above_100_goes_to_super_layer() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        e.apply("D1", 150).unwrap();
        assert_eq!(drv.level("D1"), Some(100));
        assert!((sup.get() - 1.5).abs() < 1e-6);
        e.apply("D1", 90).unwrap();
        assert_eq!(sup.get(), 1.0);
    }

    #[test]
    fn monitor_without_driver_uses_universal_layer() {
        let drv = MockDriver::with(&[("D1", 50)]); // D2 sem driver (ex.: Intel)
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        let info = e.monitors();
        assert_eq!(info[1].driver, DriverKind::None);
        assert_eq!(info[1].current, Some(50));
        e.apply("D2", 100).unwrap();
        assert!((sup.get() - 1.5).abs() < 1e-6);
    }

    #[test]
    fn super_unavailable_limits_to_100() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let mut e = engine(&drv, None, None);
        assert!(e.apply("D1", 100).is_ok());
        assert!(e.apply("D1", 120).is_err());
        assert!(e.apply("D2", 80).is_err());
    }

    #[test]
    fn restore_all_returns_original_values() {
        let drv = MockDriver::with(&[("D1", 63)]);
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        e.apply("D1", 100).unwrap();
        e.apply("D1", 180).unwrap();
        e.restore_all();
        assert_eq!(drv.level("D1"), Some(63));
        assert_eq!(sup.get(), 1.0);
    }

    #[test]
    fn restore_uses_driver_default() {
        let drv = MockDriver::with(&[("D1", 70)]);
        let mut e = engine(&drv, Some(&MockSuper::default()), None);
        e.apply("D1", 90).unwrap();
        let m = e.restore("D1").unwrap();
        assert_eq!(m.current, Some(50));
        assert_eq!(m.original, Some(70));
    }

    #[test]
    fn crash_recovery_restores_previous_session() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let drv = MockDriver::with(&[("D1", 55)]);
        {
            let mut e = engine(&drv, Some(&MockSuper::default()), Some(path.clone()));
            e.apply("D1", 100).unwrap();
            std::mem::forget(e); // simula crash: nada de restore_all
        }
        assert_eq!(drv.level("D1"), Some(100));
        let _e = engine(&drv, Some(&MockSuper::default()), Some(path.clone()));
        assert_eq!(drv.level("D1"), Some(55));
        assert!(!path.exists());
    }

    #[test]
    fn driver_failure_is_reported() {
        let drv = MockDriver::with(&[("D1", 50)]);
        *drv.fail_writes.lock().unwrap() = true;
        let mut e = engine(&drv, Some(&MockSuper::default()), None);
        assert!(e.apply("D1", 80).unwrap_err().contains("Driver"));
        assert_eq!(e.current("D1"), Some(50));
    }

    #[test]
    fn unplugged_monitor_is_dropped() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        e.apply("D2", 150).unwrap();
        assert!(e.refresh(vec![displays()[0].clone()]));
        assert_eq!(sup.get(), 1.0);
        assert!(e.apply("D2", 60).is_err());
        assert_eq!(e.primary_id().as_deref(), Some("D1"));
    }
}
