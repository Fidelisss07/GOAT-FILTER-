//! Matemática de cor: saturação, realce de uma cor específica e curvas de
//! brilho/contraste/gama. Tudo em funções puras, testadas em qualquer SO.
//!
//! Matrizes 3×3 em RGB linear, convenção coluna: `saída = M · entrada`.

use crate::types::{EmphasisColor, Tuning};

pub type Mat3 = [[f32; 3]; 3];

pub const IDENTITY: Mat3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

/// Pesos de luminância Rec.709 / sRGB.
pub const LUMA: [f32; 3] = [0.2126, 0.7152, 0.0722];

/// sRGB linear → XYZ (D65).
pub const SRGB_TO_XYZ: [[f64; 3]; 3] = [
    [0.4124564, 0.3575761, 0.1804375],
    [0.2126729, 0.7151522, 0.0721750],
    [0.0193339, 0.1191920, 0.9503041],
];

pub fn mul(a: &Mat3, b: &Mat3) -> Mat3 {
    let mut o = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            o[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    o
}

pub fn apply(m: &Mat3, c: [f32; 3]) -> [f32; 3] {
    let mut o = [0.0; 3];
    for i in 0..3 {
        o[i] = (0..3).map(|j| m[i][j] * c[j]).sum();
    }
    o
}

/// Distância de uma matriz até a identidade (0 = sem efeito).
pub fn strength(m: &Mat3) -> f32 {
    let mut s = 0.0;
    for i in 0..3 {
        for j in 0..3 {
            let d = m[i][j] - IDENTITY[i][j];
            s += d * d;
        }
    }
    s.sqrt()
}

pub fn is_identity(m: &Mat3) -> bool {
    strength(m) < 1e-4
}

/// Saturação uniforme: `s·I + (1−s)·1·wᵀ`. Mantém cinzas e luminância.
pub fn saturation(s: f32) -> Mat3 {
    let mut m = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = (1.0 - s) * LUMA[j] + if i == j { s } else { 0.0 };
        }
    }
    m
}

/// Cores de contorno de inimigo do Valorant (aproximadas, RGB linear).
pub fn emphasis_target(c: EmphasisColor) -> Option<[f32; 3]> {
    let srgb = match c {
        EmphasisColor::None => return None,
        EmphasisColor::Red => [0.92, 0.20, 0.22],
        EmphasisColor::Yellow => [0.93, 0.93, 0.05],
        EmphasisColor::Purple => [0.72, 0.22, 0.90],
    };
    Some(srgb.map(to_linear))
}

fn to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

/// Realce direcional: estica só o componente de cor na direção do alvo.
///
/// Com `c = (I − 1·wᵀ)·rgb` (a parte "colorida" do pixel) e `d` a parte
/// colorida da cor-alvo: `M = I + (k−1)·d·dᵀ/(dᵀd)·(I − 1·wᵀ)`.
/// Como `wᵀd = 0`, o brilho (Y) não muda; cores sem relação com o alvo
/// quase não mudam.
pub fn emphasis(color: EmphasisColor, k: f32) -> Mat3 {
    let Some(t) = emphasis_target(color) else { return IDENTITY };
    let y: f32 = (0..3).map(|i| LUMA[i] * t[i]).sum();
    let d = [t[0] - y, t[1] - y, t[2] - y];
    let dd: f32 = d.iter().map(|x| x * x).sum();
    if dd < 1e-8 {
        return IDENTITY;
    }
    // C = I − 1·wᵀ
    let mut c = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            c[i][j] = if i == j { 1.0 } else { 0.0 } - LUMA[j];
        }
    }
    let mut p = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            p[i][j] = (k - 1.0) * d[i] * d[j] / dd;
        }
    }
    let pc = mul(&p, &c);
    let mut m = IDENTITY;
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] += pc[i][j];
        }
    }
    m
}

/// Matriz final da camada Super: realce de cor depois da saturação.
pub fn super_matrix(saturation_factor: f32, tuning: &Tuning) -> Mat3 {
    let k = 1.0 + tuning.emphasis_strength.min(100) as f32 / 100.0;
    mul(&emphasis(tuning.emphasis, k), &saturation(saturation_factor))
}

/// Leva uma matriz RGB-linear para XYZ (usado pelo perfil MHC2): `P·M·P⁻¹`.
pub fn to_xyz(m: &Mat3) -> [[f64; 3]; 3] {
    let p = SRGB_TO_XYZ;
    let pi = invert(&p);
    let mf = m.map(|r| r.map(|v| v as f64));
    let a = mul64(&p, &mf);
    mul64(&a, &pi)
}

fn mul64(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut o = [[0.0; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            o[i][j] = (0..3).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    o
}

fn invert(m: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let [[a, b, c], [d, e, f], [g, h, i]] = *m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    let r = 1.0 / det;
    [
        [(e * i - f * h) * r, (c * h - b * i) * r, (b * f - c * e) * r],
        [(f * g - d * i) * r, (a * i - c * g) * r, (c * d - a * f) * r],
        [(d * h - e * g) * r, (b * g - a * h) * r, (a * e - b * d) * r],
    ]
}

// ---------------------------------------------------------------------------
// Curvas (gamma ramp do Windows)
// ---------------------------------------------------------------------------

/// Rampa de 256 entradas por canal, 0–65535.
pub type Ramp = [[u16; 256]; 3];

pub fn tuning_has_curve(t: &Tuning) -> bool {
    t.brightness != 0 || t.contrast != 100 || t.gamma != 100
}

/// Curva de brilho (−50..50), contraste (50..150 %) e gama (50..200 → 0,5..2,0).
/// Gama acima de 1 clareia as sombras (ajuda em cantos escuros).
pub fn curve(t: &Tuning) -> Ramp {
    let b = t.brightness.clamp(-50, 50) as f32 / 100.0;
    let c = t.contrast.clamp(50, 150) as f32 / 100.0;
    let g = t.gamma.clamp(50, 200) as f32 / 100.0;
    let mut ramp = [[0u16; 256]; 3];
    for i in 0..256 {
        let x = i as f32 / 255.0;
        let v = x.powf(1.0 / g);
        let v = ((v - 0.5) * c + 0.5 + b).clamp(0.0, 1.0);
        let out = (v * 65535.0).round() as u16;
        for ch in ramp.iter_mut() {
            ch[i] = out;
        }
    }
    ramp
}

pub fn identity_ramp() -> Ramp {
    let mut r = [[0u16; 256]; 3];
    for i in 0..256 {
        for ch in r.iter_mut() {
            ch[i] = (i as u32 * 257) as u16;
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: [f32; 3], b: [f32; 3]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-4)
    }
    fn luma(c: [f32; 3]) -> f32 {
        (0..3).map(|i| LUMA[i] * c[i]).sum()
    }

    #[test]
    fn neutral_tuning_is_identity() {
        assert!(is_identity(&super_matrix(1.0, &Tuning::default())));
        assert!(!tuning_has_curve(&Tuning::default()));
        assert_eq!(curve(&Tuning::default())[0][128], identity_ramp()[0][128]);
    }

    #[test]
    fn emphasis_boosts_target_and_keeps_luminance() {
        let m = emphasis(EmphasisColor::Red, 2.0);
        let red = emphasis_target(EmphasisColor::Red).unwrap();
        let out = apply(&m, red);
        assert!((luma(out) - luma(red)).abs() < 1e-4);
        assert!(out[0] > red[0] && out[1] < red[1]);
        // cinza intacto
        assert!(close(apply(&m, [0.4, 0.4, 0.4]), [0.4, 0.4, 0.4]));
    }

    #[test]
    fn emphasis_affects_target_more_than_other_colors() {
        let m = emphasis(EmphasisColor::Yellow, 2.0);
        let gain = |c: [f32; 3]| {
            let y = luma(c);
            let o = apply(&m, c);
            let before: f32 = c.iter().map(|v| (v - y).powi(2)).sum::<f32>().sqrt();
            let after: f32 = o.iter().map(|v| (v - y).powi(2)).sum::<f32>().sqrt();
            after / before
        };
        let yellow = emphasis_target(EmphasisColor::Yellow).unwrap();
        let blue_green = [0.05, 0.3, 0.6];
        assert!(gain(yellow) > 1.9);
        assert!(gain(blue_green) < gain(yellow));
    }

    #[test]
    fn xyz_saturation_matches_mhc2_formula() {
        let s = 1.6;
        let m = to_xyz(&saturation(s));
        let expected = crate::backends::icc::saturation_matrix_xyz(s as f64);
        for i in 0..3 {
            for j in 0..3 {
                assert!((m[i][j] - expected[i][j]).abs() < 2e-3, "{i}{j}: {} vs {}", m[i][j], expected[i][j]);
            }
        }
    }

    #[test]
    fn gamma_above_one_lifts_shadows() {
        let t = Tuning { gamma: 150, ..Tuning::default() };
        let r = curve(&t);
        assert!(r[0][40] > identity_ramp()[0][40]);
        assert_eq!(r[0][0], 0);
        assert_eq!(r[0][255], 65535);
    }
}
