//! Gerador de perfil de cor ICC v4 (sRGB) com a tag privada `MHC2` da Microsoft.
//!
//! No Windows 11 a matriz da MHC2 é aplicada pelo próprio pipeline de exibição
//! da GPU, depois que o jogo e o DWM já desenharam a imagem: não custa FPS, não
//! soma input lag e vale também em tela cheia exclusiva.
//!
//! Formato da tag MHC2 (bytes relativos ao início da tag):
//! ```text
//!  0  'MHC2'             4  reservado
//!  8  u32  entradas da LUT de regamma
//! 12  s15.16 luminância mínima (nits)   16  s15.16 luminância máxima (nits)
//! 20  u32  offset da matriz 3×4          24/28/32 u32 offsets das LUTs R/G/B
//!     matriz: 12 × s15.16 (linha a linha)
//!     LUT:    'sf32' + reservado + N × s15.16
//! ```
//! A matriz é aplicada no espaço XYZ (XYZ → XYZ).

const D50: [f64; 3] = [0.9642, 1.0, 0.8249];
/// Branco D65 em XYZ (Y = 1).
const D65: [f64; 3] = [0.95047, 1.0, 1.08883];
/// Primárias sRGB adaptadas para D50 (Bradford), como exige o ICC.
const SRGB_D50: [[f64; 3]; 3] = [
    [0.4361, 0.2225, 0.0139],
    [0.3851, 0.7169, 0.0971],
    [0.1431, 0.0606, 0.7141],
];
/// Matriz de adaptação cromática D65 → D50 (Bradford), tag `chad`.
const CHAD: [f64; 9] = [
    1.0478112, 0.0228866, -0.0501270, 0.0295424, 0.9904844, -0.0170491, -0.0092345, 0.0150436, 0.7521316,
];

/// Matriz de saturação no espaço XYZ.
///
/// Em RGB linear a saturação é `s·I + (1−s)·1·wᵀ` (w = pesos de luminância).
/// Levada para XYZ ela vira `s·I + (1−s)·W·e_Yᵀ`: cada cor se afasta (ou se
/// aproxima) do branco de mesma luminância Y. Cinzas e o brilho não mudam.
pub fn saturation_matrix_xyz(s: f64) -> [[f64; 4]; 3] {
    let mut m = [[0.0; 4]; 3];
    for (i, row) in m.iter_mut().enumerate() {
        row[i] = s;
        row[1] += (1.0 - s) * D65[i];
    }
    m
}

fn s15(v: f64) -> [u8; 4] {
    ((v * 65536.0).round() as i32).to_be_bytes()
}

fn pad4(v: &mut Vec<u8>) {
    while v.len() % 4 != 0 {
        v.push(0);
    }
}

fn mluc(text: &str) -> Vec<u8> {
    let utf16: Vec<u8> = text.encode_utf16().flat_map(|c| c.to_be_bytes()).collect();
    let mut v = Vec::new();
    v.extend_from_slice(b"mluc");
    v.extend_from_slice(&[0; 4]);
    v.extend_from_slice(&1u32.to_be_bytes());
    v.extend_from_slice(&12u32.to_be_bytes());
    v.extend_from_slice(b"enUS");
    v.extend_from_slice(&(utf16.len() as u32).to_be_bytes());
    v.extend_from_slice(&28u32.to_be_bytes());
    v.extend_from_slice(&utf16);
    pad4(&mut v);
    v
}

fn xyz(c: [f64; 3]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(b"XYZ ");
    v.extend_from_slice(&[0; 4]);
    for x in c {
        v.extend_from_slice(&s15(x));
    }
    v
}

/// Curva sRGB (parametricCurveType, função 3).
fn srgb_trc() -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(b"para");
    v.extend_from_slice(&[0; 4]);
    v.extend_from_slice(&3u16.to_be_bytes());
    v.extend_from_slice(&[0; 2]);
    for p in [2.4, 1.0 / 1.055, 0.055 / 1.055, 1.0 / 12.92, 0.04045] {
        v.extend_from_slice(&s15(p));
    }
    v
}

fn sf32(vals: &[f64]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(b"sf32");
    v.extend_from_slice(&[0; 4]);
    for x in vals {
        v.extend_from_slice(&s15(*x));
    }
    v
}

fn mhc2(matrix: [[f64; 4]; 3], lut_size: usize, min_nits: f64, max_nits: f64) -> Vec<u8> {
    let header = 36usize;
    let matrix_off = header;
    let lut_len = 8 + 4 * lut_size;
    let lut0 = matrix_off + 48;
    let mut v = Vec::new();
    v.extend_from_slice(b"MHC2");
    v.extend_from_slice(&[0; 4]);
    v.extend_from_slice(&(lut_size as u32).to_be_bytes());
    v.extend_from_slice(&s15(min_nits));
    v.extend_from_slice(&s15(max_nits));
    for off in [matrix_off, lut0, lut0 + lut_len, lut0 + 2 * lut_len] {
        v.extend_from_slice(&(off as u32).to_be_bytes());
    }
    for row in matrix {
        for x in row {
            v.extend_from_slice(&s15(x));
        }
    }
    // LUT identidade: não mexe na curva de gama.
    let ramp: Vec<f64> = (0..lut_size).map(|i| i as f64 / (lut_size - 1) as f64).collect();
    for _ in 0..3 {
        v.extend_from_slice(&sf32(&ramp));
    }
    v
}

/// Perfil sRGB completo com a matriz `matrix` na tag MHC2.
pub fn build_mhc2_profile(description: &str, matrix: [[f64; 4]; 3]) -> Vec<u8> {
    let trc = srgb_trc();
    let tags: Vec<(&[u8; 4], Vec<u8>)> = vec![
        (b"desc", mluc(description)),
        (b"cprt", mluc("Gerado pelo Goat Filter")),
        (b"wtpt", xyz(D50)),
        (b"rXYZ", xyz(SRGB_D50[0])),
        (b"gXYZ", xyz(SRGB_D50[1])),
        (b"bXYZ", xyz(SRGB_D50[2])),
        (b"rTRC", trc.clone()),
        (b"gTRC", trc.clone()),
        (b"bTRC", trc),
        (b"chad", sf32(&CHAD)),
        (b"lumi", xyz([0.0, 250.0, 0.0])),
        (b"MHC2", mhc2(matrix, 1024, 0.2, 250.0)),
    ];

    let table_len = 4 + 12 * tags.len();
    let mut offset = 128 + table_len;
    let mut table = Vec::new();
    let mut data = Vec::new();
    table.extend_from_slice(&(tags.len() as u32).to_be_bytes());
    for (sig, body) in &tags {
        table.extend_from_slice(*sig);
        table.extend_from_slice(&(offset as u32).to_be_bytes());
        table.extend_from_slice(&(body.len() as u32).to_be_bytes());
        data.extend_from_slice(body);
        pad4(&mut data);
        offset = 128 + table_len + data.len();
    }

    let total = 128 + table_len + data.len();
    let mut h = vec![0u8; 128];
    h[0..4].copy_from_slice(&(total as u32).to_be_bytes());
    h[8..12].copy_from_slice(&0x0430_0000u32.to_be_bytes()); // ICC 4.3
    h[12..16].copy_from_slice(b"mntr");
    h[16..20].copy_from_slice(b"RGB ");
    h[20..24].copy_from_slice(b"XYZ ");
    for (i, n) in [2026u16, 1, 1, 0, 0, 0].iter().enumerate() {
        h[24 + i * 2..26 + i * 2].copy_from_slice(&n.to_be_bytes());
    }
    h[36..40].copy_from_slice(b"acsp");
    h[40..44].copy_from_slice(b"MSFT");
    for (i, c) in D50.iter().enumerate() {
        h[68 + i * 4..72 + i * 4].copy_from_slice(&s15(*c));
    }

    let mut out = h;
    out.extend_from_slice(&table);
    out.extend_from_slice(&data);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u32_at(b: &[u8], o: usize) -> u32 {
        u32::from_be_bytes(b[o..o + 4].try_into().unwrap())
    }
    fn s15_at(b: &[u8], o: usize) -> f64 {
        i32::from_be_bytes(b[o..o + 4].try_into().unwrap()) as f64 / 65536.0
    }

    fn mul(m: &[[f64; 4]; 3], c: [f64; 3]) -> [f64; 3] {
        let mut o = [0.0; 3];
        for i in 0..3 {
            o[i] = (0..3).map(|j| m[i][j] * c[j]).sum::<f64>() + m[i][3];
        }
        o
    }

    #[test]
    fn identity_at_one() {
        let m = saturation_matrix_xyz(1.0);
        assert_eq!(m, [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]]);
    }

    #[test]
    fn white_and_luminance_preserved() {
        let m = saturation_matrix_xyz(1.7);
        let w = mul(&m, D65);
        for i in 0..3 {
            assert!((w[i] - D65[i]).abs() < 1e-9);
        }
        // vermelho sRGB (XYZ D65): Y igual, mais longe do branco
        let red = [0.4124, 0.2126, 0.0193];
        let r = mul(&m, red);
        assert!((r[1] - red[1]).abs() < 1e-9);
        assert!(r[0] > red[0] && r[2] < red[2]);
    }

    #[test]
    fn profile_is_well_formed() {
        let p = build_mhc2_profile("Goat Filter 150%", saturation_matrix_xyz(1.5));
        assert_eq!(u32_at(&p, 0) as usize, p.len());
        assert_eq!(&p[36..40], b"acsp");
        assert_eq!(p.len() % 4, 0);
        let n = u32_at(&p, 128) as usize;
        assert_eq!(n, 12);
        let mut found = None;
        for i in 0..n {
            let e = 132 + i * 12;
            let (off, size) = (u32_at(&p, e + 4) as usize, u32_at(&p, e + 8) as usize);
            assert_eq!(off % 4, 0, "tag alinhada");
            assert!(off + size <= p.len());
            if &p[e..e + 4] == b"MHC2" {
                found = Some((off, size));
            }
        }
        let (off, size) = found.expect("tag MHC2");
        let t = &p[off..off + size];
        assert_eq!(&t[0..4], b"MHC2");
        assert_eq!(u32_at(t, 8), 1024);
        let mo = u32_at(t, 20) as usize;
        assert!((s15_at(t, mo) - (1.5 + (1.0 - 1.5) * 0.0)).abs() < 1e-4); // m[0][0] = s
        assert!((s15_at(t, mo + 4) - (1.0 - 1.5) * D65[0]).abs() < 1e-4); // m[0][1]
        for k in 0..3 {
            let lo = u32_at(t, 24 + 4 * k) as usize;
            assert_eq!(&t[lo..lo + 4], b"sf32");
            assert!((s15_at(t, lo + 8 + 4 * 1023) - 1.0).abs() < 1e-4);
        }
        assert_eq!(off + u32_at(t, 32) as usize + 8 + 4 * 1024, off + size);
    }
}
