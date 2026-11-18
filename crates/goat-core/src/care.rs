//! Cuidados com o PC (aba Desempenho, v1.9): limpeza de arquivos temporários e
//! do cache de shaders, histórico das sessões de jogo e aviso de temperatura.
//! Nada aqui mexe no jogo.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Pastas limpas: temporários do Windows e caches de shader das placas.
/// O jogo recria o cache de shader sozinho (a primeira partida pode carregar um
/// pouco mais devagar). Só arquivos com mais de um dia são apagados.
pub fn cache_dirs() -> Vec<(String, PathBuf)> {
    let mut v = Vec::new();
    if let Some(t) = std::env::var_os("TEMP") {
        v.push(("Arquivos temporários".to_string(), PathBuf::from(t)));
    }
    if let Some(l) = std::env::var_os("LOCALAPPDATA") {
        let l = PathBuf::from(l);
        v.push(("Cache de shaders da NVIDIA".to_string(), l.join("NVIDIA").join("DXCache")));
        v.push(("Cache de shaders da NVIDIA (OpenGL)".to_string(), l.join("NVIDIA").join("GLCache")));
        v.push(("Cache de shaders da AMD".to_string(), l.join("AMD").join("DxCache")));
        v.push(("Cache de shaders do DirectX".to_string(), l.join("D3DSCache")));
    }
    v
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheGroup {
    pub name: String,
    pub files: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheReport {
    pub groups: Vec<CacheGroup>,
    pub bytes: u64,
    /// Bytes realmente apagados (0 na prévia).
    pub freed: u64,
}

/// Arquivos com mais de `min_age` dentro de `dir` (sem seguir atalhos).
fn old_files(dir: &Path, now: SystemTime, min_age: Duration, out: &mut Vec<(PathBuf, u64)>, depth: u32) {
    if depth > 12 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let p = e.path();
        if ft.is_dir() {
            old_files(&p, now, min_age, out, depth + 1);
        } else if let Ok(m) = e.metadata() {
            let old = m.modified().ok().and_then(|t| now.duration_since(t).ok()).map(|age| age >= min_age).unwrap_or(false);
            if old {
                out.push((p, m.len()));
            }
        }
    }
}

/// Mede (e, com `apply`, apaga) o que pode ser limpo. Arquivos em uso são pulados.
pub fn clean_caches(dirs: &[(String, PathBuf)], apply: bool, now: SystemTime) -> CacheReport {
    let mut rep = CacheReport::default();
    for (name, dir) in dirs {
        let mut files = Vec::new();
        old_files(dir, now, Duration::from_secs(86_400), &mut files, 0);
        let mut g = CacheGroup { name: name.clone(), ..Default::default() };
        for (p, len) in files {
            g.files += 1;
            g.bytes += len;
            if apply && std::fs::remove_file(&p).is_ok() {
                rep.freed += len;
            }
        }
        rep.bytes += g.bytes;
        if g.files > 0 {
            rep.groups.push(g);
        }
    }
    rep
}

/// Uma partida (do jogo abrir até fechar).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub game: String,
    pub start: u64,
    pub end: u64,
    pub clips: u32,
    pub max_gpu_temp: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySummary {
    /// Minutos jogados nos últimos 7 dias.
    pub week_minutes: u64,
    pub week_sessions: u32,
    pub week_clips: u32,
    /// Maior temperatura da GPU registrada nos últimos 7 dias.
    pub week_max_temp: Option<u32>,
    /// Minutos por dia (últimos 7, o último é hoje).
    pub days: Vec<u64>,
}

pub const HISTORY_LIMIT: usize = 500;

pub fn load_history(path: &Path) -> Vec<SessionRecord> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Acrescenta uma sessão (partidas de menos de 1 minuto não contam).
pub fn push_history(path: &Path, rec: SessionRecord) -> std::io::Result<()> {
    if rec.end <= rec.start || rec.end - rec.start < 60_000 {
        return Ok(());
    }
    let mut v = load_history(path);
    v.push(rec);
    if v.len() > HISTORY_LIMIT {
        let cut = v.len() - HISTORY_LIMIT;
        v.drain(..cut);
    }
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    std::fs::write(path, serde_json::to_string(&v).unwrap_or_default())
}

/// Resumo da semana. `day_offset_ms` = fuso local (para separar os dias).
pub fn summarize(records: &[SessionRecord], now: u64, day_offset_ms: i64) -> HistorySummary {
    const DAY: u64 = 86_400_000;
    let local = |t: u64| (t as i64 + day_offset_ms).max(0) as u64;
    let today = local(now) / DAY;
    let mut s = HistorySummary { days: vec![0; 7], ..Default::default() };
    for r in records {
        let day = local(r.start) / DAY;
        if day + 6 < today || day > today {
            continue;
        }
        let mins = (r.end.saturating_sub(r.start)) / 60_000;
        s.week_minutes += mins;
        s.week_sessions += 1;
        s.week_clips += r.clips;
        s.week_max_temp = s.week_max_temp.max(r.max_gpu_temp);
        s.days[(6 - (today - day)) as usize] += mins;
    }
    s
}

/// Aviso de temperatura: acima do limite e, no máximo, uma vez a cada 10 min.
pub fn should_alert(temp: Option<u32>, threshold: u32, last_alert: Option<u64>, now: u64) -> bool {
    match temp {
        Some(t) if threshold > 0 && t >= threshold => last_alert.is_none_or(|l| now.saturating_sub(l) >= 600_000),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    fn touch(p: &Path, bytes: usize, age_days: u64) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, vec![0u8; bytes]).unwrap();
        let t = SystemTime::now() - Duration::from_secs(age_days * 86_400 + 60);
        File::options().write(true).open(p).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn limpa_so_arquivos_antigos() {
        let d = tempfile::tempdir().unwrap();
        let tmp = d.path().join("tmp");
        let nv = d.path().join("nv");
        touch(&tmp.join("velho.txt"), 1000, 3);
        touch(&tmp.join("sub/velho2.bin"), 500, 10);
        std::fs::write(tmp.join("novo.txt"), vec![0u8; 700]).unwrap();
        touch(&nv.join("shader.bin"), 2000, 2);
        let dirs = vec![("Temp".to_string(), tmp.clone()), ("NV".to_string(), nv.clone()), ("Nada".to_string(), d.path().join("x"))];

        let prev = clean_caches(&dirs, false, SystemTime::now());
        assert_eq!(prev.bytes, 3500);
        assert_eq!(prev.freed, 0);
        assert_eq!(prev.groups.len(), 2);
        assert_eq!(prev.groups[0].files, 2);
        assert!(tmp.join("velho.txt").exists());

        let done = clean_caches(&dirs, true, SystemTime::now());
        assert_eq!(done.freed, 3500);
        assert!(!tmp.join("velho.txt").exists());
        assert!(!nv.join("shader.bin").exists());
        assert!(tmp.join("novo.txt").exists(), "arquivo recente fica");
    }

    #[test]
    fn historico_e_resumo() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("h.json");
        let day = 86_400_000u64;
        let now = 20_000 * day + 12 * 3_600_000; // meio-dia
        let r = |start: u64, mins: u64, clips: u32, t: Option<u32>| SessionRecord {
            game: "Valorant".into(),
            start,
            end: start + mins * 60_000,
            clips,
            max_gpu_temp: t,
        };
        push_history(&p, r(now - 2 * 3_600_000, 90, 3, Some(71))).unwrap();
        push_history(&p, r(now - 2 * day, 45, 1, Some(80))).unwrap();
        push_history(&p, r(now - 10 * day, 200, 9, Some(90))).unwrap(); // fora da semana
        push_history(&p, r(now - 1000, 0, 0, None)).unwrap(); // menos de 1 min: ignorada
        let h = load_history(&p);
        assert_eq!(h.len(), 3);
        let s = summarize(&h, now, 0);
        assert_eq!(s.week_minutes, 135);
        assert_eq!(s.week_sessions, 2);
        assert_eq!(s.week_clips, 4);
        assert_eq!(s.week_max_temp, Some(80));
        assert_eq!(s.days, vec![0, 0, 0, 0, 45, 0, 90]);
    }

    #[test]
    fn historico_tem_limite() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("h.json");
        let many: Vec<SessionRecord> = (0..HISTORY_LIMIT as u64)
            .map(|i| SessionRecord { game: "x".into(), start: i * 100_000, end: i * 100_000 + 90_000, clips: 0, max_gpu_temp: None })
            .collect();
        std::fs::write(&p, serde_json::to_string(&many).unwrap()).unwrap();
        push_history(&p, SessionRecord { game: "novo".into(), start: 1, end: 120_001, clips: 0, max_gpu_temp: None }).unwrap();
        let h = load_history(&p);
        assert_eq!(h.len(), HISTORY_LIMIT);
        assert_eq!(h.last().unwrap().game, "novo");
    }

    #[test]
    fn aviso_de_temperatura() {
        assert!(should_alert(Some(86), 85, None, 0));
        assert!(!should_alert(Some(84), 85, None, 0));
        assert!(!should_alert(Some(90), 0, None, 0), "0 desliga");
        assert!(!should_alert(None, 85, None, 0));
        assert!(!should_alert(Some(90), 85, Some(1_000), 500_000), "espera 10 min");
        assert!(should_alert(Some(90), 85, Some(1_000), 700_000));
    }
}
