//! Conversão entre a porcentagem do Goat Filter (0–100, 50 = normal) e os
//! níveis nativos de cada driver. Funções puras, testáveis em qualquer SO.

use crate::types::NEUTRAL;

/// Converte para uma escala com um ponto neutro no meio:
/// 0% → `min`, 50% → `neutral`, 100% → `max`.
pub fn percent_to_level(percent: u8, min: i32, neutral: i32, max: i32) -> i32 {
    let p = percent.min(100) as f64;
    let n = NEUTRAL as f64;
    let v = if p <= n {
        min as f64 + (neutral - min) as f64 * (p / n)
    } else {
        neutral as f64 + (max - neutral) as f64 * ((p - n) / (100.0 - n))
    };
    (v.round() as i32).clamp(min.min(max), max.max(min))
}

pub fn level_to_percent(level: i32, min: i32, neutral: i32, max: i32) -> u8 {
    let l = level.clamp(min, max) as f64;
    let n = NEUTRAL as f64;
    let p = if l <= neutral as f64 {
        if neutral == min { n } else { n * (l - min as f64) / (neutral - min) as f64 }
    } else if max == neutral {
        n
    } else {
        n + (100.0 - n) * (l - neutral as f64) / (max - neutral) as f64
    };
    p.round().clamp(0.0, 100.0) as u8
}

/// Fator da matriz Super para um valor 0–200 do Goat Filter.
/// Igual a `matrixFactor` em `src/lib/vibrance.ts`.
pub fn super_factor(percent: u8, has_driver: bool) -> f32 {
    let p = percent.min(200) as f32;
    if has_driver {
        if p <= 100.0 { 1.0 } else { 1.0 + (p - 100.0) / 100.0 }
    } else if p <= 50.0 {
        p / 50.0
    } else {
        1.0 + (p - 50.0) / 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_ex_range_symmetric() {
        // NVAPI DVC "Ex": -63..63, padrão 0.
        assert_eq!(percent_to_level(0, -63, 0, 63), -63);
        assert_eq!(percent_to_level(50, -63, 0, 63), 0);
        assert_eq!(percent_to_level(100, -63, 0, 63), 63);
        assert_eq!(percent_to_level(75, -63, 0, 63), 32);
        assert_eq!(level_to_percent(63, -63, 0, 63), 100);
        assert_eq!(level_to_percent(0, -63, 0, 63), 50);
    }

    #[test]
    fn nvidia_legacy_range_has_no_below_normal() {
        // DVC antigo: 0..63, onde 0 já é o "normal".
        assert_eq!(percent_to_level(20, 0, 0, 63), 0);
        assert_eq!(percent_to_level(100, 0, 0, 63), 63);
        assert_eq!(level_to_percent(0, 0, 0, 63), 50);
    }

    #[test]
    fn amd_saturation_range() {
        // ADL: 0..200, padrão 100.
        assert_eq!(percent_to_level(50, 0, 100, 200), 100);
        assert_eq!(percent_to_level(100, 0, 100, 200), 200);
        assert_eq!(percent_to_level(25, 0, 100, 200), 50);
        assert_eq!(level_to_percent(150, 0, 100, 200), 75);
    }

    #[test]
    fn roundtrip() {
        for p in 0..=100u8 {
            let l = percent_to_level(p, -63, 0, 63);
            let back = level_to_percent(l, -63, 0, 63);
            assert!((back as i32 - p as i32).abs() <= 1, "{p} -> {l} -> {back}");
        }
    }

    #[test]
    fn super_factor_rules() {
        assert_eq!(super_factor(75, true), 1.0);
        assert_eq!(super_factor(100, true), 1.0);
        assert!((super_factor(150, true) - 1.5).abs() < 1e-6);
        assert!((super_factor(200, true) - 2.0).abs() < 1e-6);
        assert_eq!(super_factor(50, false), 1.0);
        assert!((super_factor(0, false)).abs() < 1e-6);
        assert!((super_factor(200, false) - 2.5).abs() < 1e-6);
    }
}
