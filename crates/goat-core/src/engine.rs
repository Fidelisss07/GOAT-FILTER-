//! Junta as camadas: driver (0–100%) + Super (acima de 100%, ou tudo quando o
//! driver não tem vibrance) e garante a restauração dos valores originais.

use crate::backends::mapping::super_factor;
use crate::backends::{CurveControl, Detected, DriverVibrance, SuperLayer};
use crate::color::{self, Mat3, Ramp};
use crate::monitors::Display;
use crate::session::Session;
use crate::types::{Capabilities, DriverKind, MethodInfo, MonitorInfo, SuperMethod, Tuning, DRIVER_MAX, NEUTRAL, SUPER_MAX};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

struct Mon {
    display: Display,
    driver: Option<usize>,
    current: Option<u8>,
    original: Option<u8>,
    tuning: Tuning,
}

fn ramp_to_vec(r: &Ramp) -> Vec<u16> {
    r.iter().flatten().copied().collect()
}

fn vec_to_ramp(v: &[u16]) -> Option<Ramp> {
    if v.len() != 768 {
        return None;
    }
    let mut r = [[0u16; 256]; 3];
    for (i, x) in v.iter().enumerate() {
        r[i / 256][i % 256] = *x;
    }
    Some(r)
}

pub struct Engine {
    drivers: Vec<Box<dyn DriverVibrance>>,
    layers: Vec<Box<dyn SuperLayer>>,
    /// Índice da camada Super em uso.
    active: Option<usize>,
    super_reasons: Vec<(SuperMethod, String)>,
    monitors: Vec<Mon>,
    session: Session,
    matrices: BTreeMap<String, Mat3>,
    curves: Option<Box<dyn CurveControl>>,
    demo: bool,
}

impl Engine {
    pub fn new(detected: Detected, displays: Vec<Display>, session_path: Option<PathBuf>, demo: bool) -> Self {
        let (session, leftover) = Session::open(session_path);
        let mut e = Self {
            drivers: detected.drivers,
            active: (!detected.super_layers.is_empty()).then_some(0),
            layers: detected.super_layers,
            super_reasons: detected.super_reasons,
            monitors: Vec::new(),
            session,
            matrices: BTreeMap::new(),
            curves: detected.curves,
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
        for (display, ramp) in leftover.ramps {
            if let (Some(c), Some(r)) = (e.curves.as_mut(), vec_to_ramp(&ramp)) {
                if let Err(err) = c.set(&display, &r) {
                    log::warn!("Falha ao restaurar a curva de {display}: {err}");
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
                None => self.active.map(|_| NEUTRAL),
            };
            next.push(Mon { original: current, current, driver, display: d, tuning: Tuning::default() });
        }
        // Monitores que sumiram não contam mais na camada Super.
        for id in old.keys() {
            self.matrices.remove(id);
        }
        self.monitors = next;
        if !old.is_empty() {
            let _ = self.push_super();
        }
        let new_ids: Vec<String> = self.monitors.iter().map(|m| m.display.id.clone()).collect();
        old_ids != new_ids
    }

    pub fn capabilities(&self) -> Capabilities {
        let methods = [SuperMethod::Magnifier, SuperMethod::Mhc2]
            .into_iter()
            .map(|m| MethodInfo {
                method: m,
                available: self.layers.iter().any(|l| l.method() == m),
                reason: self.super_reasons.iter().find(|(x, _)| *x == m).map(|(_, r)| r.clone()),
            })
            .collect();
        let super_reason = match self.active {
            Some(_) => None,
            None => Some(match self.super_reasons.first() {
                Some((_, r)) => format!("Super Vibrance indisponível: {r}"),
                None => "Super Vibrance indisponível".into(),
            }),
        };
        Capabilities { demo: self.demo, super_method: self.method(), super_reason, methods, curves: self.curves.is_some() }
    }

    pub fn method(&self) -> SuperMethod {
        self.active.map(|i| self.layers[i].method()).unwrap_or(SuperMethod::None)
    }

    /// Troca o método da camada Super, levando junto os valores aplicados.
    pub fn set_method(&mut self, method: SuperMethod) -> Result<(), String> {
        let Some(next) = self.layers.iter().position(|l| l.method() == method) else {
            return Err("método indisponível neste PC".into());
        };
        if self.active == Some(next) {
            return Ok(());
        }
        let prev = self.active;
        if let Some(p) = prev {
            let _ = self.layers[p].apply(&BTreeMap::new());
        }
        self.active = Some(next);
        if let Err(e) = self.push_super() {
            let _ = self.layers[next].apply(&BTreeMap::new());
            self.active = prev;
            let _ = self.push_super();
            return Err(e);
        }
        Ok(())
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
            tuning: m.tuning,
        }
    }

    fn index(&self, id: &str) -> Result<usize, String> {
        self.monitors
            .iter()
            .position(|m| m.display.id == id)
            .ok_or_else(|| "Monitor desconectado.".to_string())
    }

    pub fn tuning(&self, id: &str) -> Option<Tuning> {
        self.monitors.iter().find(|m| m.display.id == id).map(|m| m.tuning)
    }

    /// Aplica um valor 0–200 do Goat Filter, mantendo os ajustes finos atuais.
    pub fn apply(&mut self, id: &str, percent: u8) -> Result<MonitorInfo, String> {
        let t = self.tuning(id).unwrap_or_default();
        self.apply_with(id, percent, t)
    }

    /// Aplica vibrance + ajustes finos (realce de cor, brilho, contraste, gama).
    pub fn apply_with(&mut self, id: &str, percent: u8, tuning: Tuning) -> Result<MonitorInfo, String> {
        let i = self.index(id)?;
        let tuning = tuning.sanitized();
        let p = percent.min(SUPER_MAX);
        let driver = self.monitors[i].driver;
        let factor = super_factor(p, driver.is_some());
        let matrix = color::super_matrix(factor, &tuning);
        let needs_super = !color::is_identity(&matrix);
        if needs_super && self.active.is_none() {
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

        let previous = self.matrices.insert(id.to_string(), matrix);
        if let Err(e) = self.push_super() {
            match previous {
                Some(f) => self.matrices.insert(id.to_string(), f),
                None => self.matrices.remove(id),
            };
            if driver.is_some() {
                // A parte do driver já foi aplicada; reflete o valor real.
                self.monitors[i].current = Some(p.min(DRIVER_MAX));
            }
            return Err(format!("Super Vibrance: {e}"));
        }
        self.monitors[i].current = Some(p);

        let curve_msg = self.apply_curve(i, &tuning).err();
        self.monitors[i].tuning = tuning;
        log::info!("Aplicado {id}: {p}% (fator Super {factor:.2}, ajustes {tuning:?})");
        match curve_msg {
            Some(e) => Err(format!("Vibrance aplicado, mas brilho/gama falhou: {e}")),
            None => Ok(self.info(i)),
        }
    }

    fn apply_curve(&mut self, i: usize, tuning: &Tuning) -> Result<(), String> {
        let id = self.monitors[i].display.id.clone();
        let want = color::tuning_has_curve(tuning);
        let had = self.session.ramp(&id).is_some();
        if !want && !had {
            return Ok(());
        }
        let Some(c) = self.curves.as_mut() else {
            return if want { Err("indisponível neste PC".into()) } else { Ok(()) };
        };
        if want {
            if !had {
                let orig = c.get(&id).unwrap_or_else(|_| color::identity_ramp());
                self.session.remember_ramp(&id, ramp_to_vec(&orig));
            }
            c.set(&id, &color::curve(tuning)).map_err(|e| e.to_string())
        } else {
            let orig = self.session.ramp(&id).and_then(|v| vec_to_ramp(v)).unwrap_or_else(color::identity_ramp);
            let r = c.set(&id, &orig).map_err(|e| e.to_string());
            if r.is_ok() {
                self.session.forget_ramp(&id);
            }
            r
        }
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
        self.apply_with(id, target, Tuning::default())
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
        if let Some(c) = self.curves.as_mut() {
            for (display, ramp) in self.session.ramps() {
                if let Some(r) = vec_to_ramp(&ramp) {
                    let _ = c.set(&display, &r);
                }
            }
        }
        self.matrices.clear();
        let _ = self.push_super();
        for m in self.monitors.iter_mut() {
            m.tuning = Tuning::default();
            if m.driver.is_none() {
                m.current = Some(NEUTRAL);
            }
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
            self.matrices.clear();
            let _ = self.push_super();
            self.session.clear();
        }
    }

    /// Envia os fatores por monitor para a camada Super ativa.
    fn push_super(&mut self) -> Result<(), String> {
        // Só monitores com efeito de fato entram no mapa.
        self.matrices.retain(|_, m| !color::is_identity(m));
        match self.active {
            Some(i) => self.layers[i].apply(&self.matrices).map_err(|e| e.to_string()),
            None if !self.matrices.is_empty() => Err("indisponível".into()),
            None => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::mock::{MockCurves, MockDriver, MockSuper};
    use crate::types::EmphasisColor;

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
                super_layers: sup.map(|s| Box::new(s.clone()) as Box<dyn SuperLayer>).into_iter().collect(),
                super_reasons: vec![],
                curves: Some(Box::new(MockCurves::default())),
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

    #[test]
    fn per_monitor_layer_gets_individual_factors() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::new(SuperMethod::Mhc2);
        let mut e = engine(&drv, Some(&sup), None);
        e.apply("D1", 150).unwrap();
        e.apply("D2", 100).unwrap();
        assert!((sup.of("D1") - 1.5).abs() < 1e-6);
        assert!((sup.of("D2") - 1.5).abs() < 1e-6);
        e.apply("D1", 80).unwrap();
        assert_eq!(sup.of("D1"), 1.0);
        assert!(!sup.factors.lock().unwrap().contains_key("D1"));
    }

    #[test]
    fn switching_method_moves_the_effect() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let mag = MockSuper::new(SuperMethod::Magnifier);
        let mhc = MockSuper::new(SuperMethod::Mhc2);
        let mut e = Engine::new(
            Detected {
                drivers: vec![Box::new(drv.clone())],
                super_layers: vec![Box::new(mag.clone()), Box::new(mhc.clone())],
                super_reasons: vec![],
                curves: None,
            },
            displays(),
            None,
            false,
        );
        assert_eq!(e.method(), SuperMethod::Magnifier);
        e.apply("D1", 170).unwrap();
        assert!((mag.get() - 1.7).abs() < 1e-6);
        e.set_method(SuperMethod::Mhc2).unwrap();
        assert_eq!(mag.get(), 1.0);
        assert!((mhc.of("D1") - 1.7).abs() < 1e-6);
        let caps = e.capabilities();
        assert_eq!(caps.super_method, SuperMethod::Mhc2);
        assert!(caps.methods.iter().all(|m| m.available));
    }

    #[test]
    fn unavailable_method_is_reported() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let mut e = Engine::new(
            Detected {
                drivers: vec![Box::new(drv)],
                super_layers: vec![Box::new(MockSuper::default())],
                super_reasons: vec![(SuperMethod::Mhc2, "requer Windows 11".into())],
                curves: None,
            },
            displays(),
            None,
            false,
        );
        assert!(e.set_method(SuperMethod::Mhc2).is_err());
        let caps = e.capabilities();
        let mhc = caps.methods.iter().find(|m| m.method == SuperMethod::Mhc2).unwrap();
        assert!(!mhc.available);
        assert_eq!(mhc.reason.as_deref(), Some("requer Windows 11"));
    }

    fn engine_with_curves(drv: &MockDriver, sup: &MockSuper, curves: &MockCurves, path: Option<PathBuf>) -> Engine {
        Engine::new(
            Detected {
                drivers: vec![Box::new(drv.clone())],
                super_layers: vec![Box::new(sup.clone())],
                super_reasons: vec![],
                curves: Some(Box::new(curves.clone())),
            },
            displays(),
            path,
            false,
        )
    }

    #[test]
    fn emphasis_uses_super_layer_even_below_100() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::default();
        let mut e = engine(&drv, Some(&sup), None);
        let t = Tuning { emphasis: EmphasisColor::Red, emphasis_strength: 80, ..Tuning::default() };
        let m = e.apply_with("D1", 80, t).unwrap();
        assert_eq!(drv.level("D1"), Some(80));
        assert_eq!(m.tuning.emphasis, EmphasisColor::Red);
        assert!(!color::is_identity(&sup.matrix("D1").unwrap()));
        // apply() mantém o realce
        e.apply("D1", 90).unwrap();
        assert!(sup.matrix("D1").is_some());
        // restaurar zera tudo
        e.restore("D1").unwrap();
        assert!(sup.matrix("D1").is_none());
    }

    #[test]
    fn curves_are_applied_and_restored() {
        let drv = MockDriver::with(&[("D1", 50)]);
        let sup = MockSuper::default();
        let curves = MockCurves::default();
        let mut e = engine_with_curves(&drv, &sup, &curves, None);
        let t = Tuning { gamma: 150, brightness: 10, ..Tuning::default() };
        e.apply_with("D1", 75, t).unwrap();
        assert_ne!(curves.ramp("D1"), color::identity_ramp());
        e.apply_with("D1", 75, Tuning::default()).unwrap();
        assert_eq!(curves.ramp("D1"), color::identity_ramp());
    }

    #[test]
    fn curves_recovered_after_crash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("session.json");
        let drv = MockDriver::with(&[("D1", 50)]);
        let curves = MockCurves::default();
        {
            let mut e = engine_with_curves(&drv, &MockSuper::default(), &curves, Some(path.clone()));
            e.apply_with("D1", 60, Tuning { gamma: 180, ..Tuning::default() }).unwrap();
            std::mem::forget(e);
        }
        assert_ne!(curves.ramp("D1"), color::identity_ramp());
        let _e = engine_with_curves(&drv, &MockSuper::default(), &curves, Some(path.clone()));
        assert_eq!(curves.ramp("D1"), color::identity_ramp());
        assert!(!path.exists());
    }
}
