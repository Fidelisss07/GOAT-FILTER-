//! Ferramentas dos clipes já salvos: cortar, comprimir para o Discord, versão
//! vertical (TikTok/Reels/Shorts), miniatura, limpeza automática e envio por
//! webhook do Discord. Só monta argumentos e faz contas (testável no Linux).

use crate::recorder::VideoEncoder;

fn s(v: impl ToString) -> String {
    v.to_string()
}

/// Duração ("Duration: 00:00:31.52") lida da saída do `ffmpeg -i`.
pub fn parse_duration(stderr: &str) -> Option<f64> {
    let t = stderr.split("Duration: ").nth(1)?.split(',').next()?;
    let p: Vec<f64> = t.split(':').filter_map(|x| x.trim().parse().ok()).collect();
    (p.len() == 3).then(|| p[0] * 3600.0 + p[1] * 60.0 + p[2])
}

/// Corte rápido (sem recodificar). Começa no quadro-chave mais próximo antes de `start`.
pub fn trim_args(input: &str, output: &str, start: f64, end: f64) -> Vec<String> {
    vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-ss"), format!("{start:.3}"), s("-to"), format!("{end:.3}"),
        s("-i"), s(input),
        s("-map"), s("0"), s("-c"), s("copy"), s("-avoid_negative_ts"), s("make_zero"),
        s("-movflags"), s("+faststart"),
        s(output),
    ]
}

/// Opções do codificador para recodificar um arquivo (quadros na memória).
fn encoder_args(enc: VideoEncoder, kbps: u32) -> Vec<String> {
    let mut a = match enc {
        VideoEncoder::Nvenc => vec![s("-c:v"), s("h264_nvenc"), s("-preset"), s("p5"), s("-rc"), s("vbr")],
        VideoEncoder::Amf => vec![s("-c:v"), s("h264_amf"), s("-quality"), s("quality"), s("-rc"), s("vbr_peak")],
        VideoEncoder::MfHw => vec![s("-c:v"), s("h264_mf"), s("-hw_encoding"), s("1"), s("-rate_control"), s("pc_vbr")],
        VideoEncoder::MfSw => vec![s("-c:v"), s("h264_mf"), s("-rate_control"), s("pc_vbr")],
    };
    a.extend([
        s("-b:v"), format!("{kbps}k"),
        s("-maxrate"), format!("{}k", kbps * 5 / 4),
        s("-bufsize"), format!("{}k", kbps * 2),
    ]);
    a
}

/// Taxa de vídeo para caber em `target_mb` (com folga de 8%) e a altura a usar.
/// Pouca taxa? Diminui a resolução para não ficar quadriculado.
pub fn fit_bitrate(duration: f64, target_mb: u32, audio_kbps: u32) -> (u32, Option<u32>) {
    let d = duration.max(1.0);
    let total_kbps = (target_mb as f64 * 8_000.0 * 0.92) / d;
    let v = (total_kbps - audio_kbps as f64).max(300.0) as u32;
    let height = match v {
        0..=1_499 => Some(480),
        1_500..=2_999 => Some(720),
        3_000..=5_999 => Some(1080),
        _ => None,
    };
    (v.min(20_000), height)
}

/// Comprime para caber em `target_mb` (Discord: 10 MB grátis).
pub fn compress_args(input: &str, output: &str, enc: VideoEncoder, duration: f64, target_mb: u32) -> Vec<String> {
    let audio = 96;
    let (kbps, height) = fit_bitrate(duration, target_mb, audio);
    let vf = match height {
        Some(h) => format!("scale=-2:'min({h},ih)':flags=bicubic,format=nv12"),
        None => s("format=nv12"),
    };
    let mut a = vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-i"), s(input),
        s("-map"), s("0:v:0"), s("-map"), s("0:a:0?"),
        s("-vf"), vf,
    ];
    a.extend(encoder_args(enc, kbps));
    a.extend([s("-c:a"), s("aac"), s("-b:a"), format!("{audio}k"), s("-movflags"), s("+faststart"), s(output)]);
    a
}

/// Versão vertical 1080x1920: recorta o centro da tela (onde fica a mira).
pub fn vertical_args(input: &str, output: &str, enc: VideoEncoder) -> Vec<String> {
    let mut a = vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-i"), s(input),
        s("-map"), s("0:v:0"), s("-map"), s("0:a:0?"),
        s("-vf"), s("crop='min(iw,ih*9/16)':ih,scale=1080:1920:flags=bicubic,format=nv12"),
    ];
    a.extend(encoder_args(enc, 10_000));
    a.extend([s("-c:a"), s("aac"), s("-b:a"), s("160k"), s("-movflags"), s("+faststart"), s(output)]);
    a
}

/// Miniatura (JPEG pequeno) de um quadro perto do começo.
pub fn thumb_args(input: &str, output: &str) -> Vec<String> {
    vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-ss"), s("1"), s("-i"), s(input),
        s("-frames:v"), s("1"), s("-vf"), s("scale=320:-2"), s("-q:v"), s("6"),
        s("-f"), s("image2"), s(output),
    ]
}

/// Teste rápido de um codificador com quadros na memória (usado para recodificar).
pub fn encoder_probe_args(enc: VideoEncoder) -> Vec<String> {
    let mut a = vec![
        s("-hide_banner"), s("-loglevel"), s("error"),
        s("-f"), s("lavfi"), s("-i"), s("color=c=black:s=320x240:d=0.3"),
        s("-vf"), s("format=nv12"),
    ];
    a.extend(encoder_args(enc, 1_000));
    a.extend([s("-f"), s("null"), s("-")]);
    a
}

/// Nome novo válido para um clipe ("Ace no Ascent" → "Ace no Ascent.mp4").
pub fn clean_clip_name(name: &str) -> Option<String> {
    let base = name.trim().trim_end_matches(".mp4").trim_end_matches(".MP4").trim();
    let cleaned: String = base
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().chars().take(120).collect::<String>();
    let upper = cleaned.to_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "LPT1", "LPT2"];
    if cleaned.is_empty() || reserved.contains(&upper.as_str()) {
        return None;
    }
    Some(format!("{cleaned}.mp4"))
}

/// Um clipe para a limpeza automática.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipFile {
    pub name: String,
    pub size: u64,
    /// Milissegundos desde 1970.
    pub modified: u64,
}

/// Clipes que a limpeza apaga: mais velhos que `keep_days` e, depois, os mais
/// velhos até a pasta caber em `max_gb`. Favoritos nunca são apagados. 0 = desligado.
pub fn clips_to_delete(clips: &[ClipFile], now_ms: u64, keep_days: u32, max_gb: u32, favorites: &[String]) -> Vec<String> {
    let mut list: Vec<&ClipFile> = clips.iter().filter(|c| !favorites.contains(&c.name)).collect();
    list.sort_by_key(|c| c.modified);
    let mut out = Vec::new();
    if keep_days > 0 {
        let limit = now_ms.saturating_sub(keep_days as u64 * 86_400_000);
        out.extend(list.iter().filter(|c| c.modified < limit).map(|c| c.name.clone()));
    }
    if max_gb > 0 {
        let cap = max_gb as u64 * 1_000_000_000;
        let mut total: u64 = clips.iter().filter(|c| !out.contains(&c.name)).map(|c| c.size).sum();
        for c in &list {
            if total <= cap {
                break;
            }
            if !out.contains(&c.name) {
                total = total.saturating_sub(c.size);
                out.push(c.name.clone());
            }
        }
    }
    out
}

/// Webhook do Discord aceito (só os endereços oficiais).
pub fn valid_discord_webhook(url: &str) -> bool {
    let u = url.trim();
    ["https://discord.com/api/webhooks/", "https://discordapp.com/api/webhooks/", "https://ptb.discord.com/api/webhooks/", "https://canary.discord.com/api/webhooks/"]
        .iter()
        .any(|p| u.starts_with(p) && u.len() > p.len() + 10)
        && !u.contains(char::is_whitespace)
}

/// Corpo multipart/form-data para enviar um arquivo ao webhook.
pub fn discord_multipart(boundary: &str, file_name: &str, bytes: &[u8], content: &str) -> Vec<u8> {
    let safe_name: String = file_name.chars().filter(|c| *c != '"' && *c != '\r' && *c != '\n').collect();
    let payload = serde_json::json!({ "content": content }).to_string();
    let mut b = Vec::with_capacity(bytes.len() + 512);
    b.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n{payload}\r\n"
        )
        .as_bytes(),
    );
    b.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"{safe_name}\"\r\nContent-Type: video/mp4\r\n\r\n"
        )
        .as_bytes(),
    );
    b.extend_from_slice(bytes);
    b.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    b
}

/// Base64 padrão (miniaturas para a interface).
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Bipe curto (WAV 16 bits mono) tocado ao salvar um clipe.
pub fn beep_wav(freq: f32, ms: u32, volume: f32) -> Vec<u8> {
    let rate = 44_100u32;
    let n = rate * ms / 1000;
    let mut pcm = Vec::with_capacity(n as usize * 2);
    for i in 0..n {
        let t = i as f32 / rate as f32;
        // Envelope suave para não estalar.
        let env = (i.min(n - i) as f32 / (rate as f32 * 0.01)).min(1.0);
        let v = (t * freq * std::f32::consts::TAU).sin() * volume * env;
        pcm.extend_from_slice(&((v * i16::MAX as f32) as i16).to_le_bytes());
    }
    let mut w = Vec::with_capacity(44 + pcm.len());
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes()); // PCM
    w.extend_from_slice(&1u16.to_le_bytes()); // mono
    w.extend_from_slice(&rate.to_le_bytes());
    w.extend_from_slice(&(rate * 2).to_le_bytes());
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    w.extend(pcm);
    w
}

/// Toca o bipe sem travar (Windows).
#[cfg(windows)]
pub fn play_beep() {
    use std::sync::OnceLock;
    use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY, SND_NODEFAULT};
    static WAV: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = WAV.get_or_init(|| {
        // Dois bipes curtos subindo: "salvou".
        let a = beep_wav(880.0, 70, 0.25);
        let b = beep_wav(1320.0, 90, 0.25);
        let mut pcm = a[44..].to_vec();
        pcm.extend(std::iter::repeat_n(0u8, 44_100 * 2 * 30 / 1000));
        pcm.extend_from_slice(&b[44..]);
        let mut w = a[..44].to_vec();
        w[4..8].copy_from_slice(&(36 + pcm.len() as u32).to_le_bytes());
        w[40..44].copy_from_slice(&(pcm.len() as u32).to_le_bytes());
        w.extend(pcm);
        w
    });
    unsafe {
        let _ = PlaySoundW(
            windows::core::PCWSTR(wav.as_ptr() as *const u16),
            None,
            SND_MEMORY | SND_ASYNC | SND_NODEFAULT,
        );
    }
}

#[cfg(not(windows))]
pub fn play_beep() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duracao() {
        assert_eq!(parse_duration("  Duration: 00:01:02.50, start: 1.4"), Some(62.5));
        assert_eq!(parse_duration("nada"), None);
    }

    #[test]
    fn corte_sem_recodificar() {
        let a = trim_args("a.mp4", "b.mp4", 3.0, 12.25).join(" ");
        assert!(a.contains("-ss 3.000 -to 12.250 -i a.mp4"));
        assert!(a.contains("-c copy"));
    }

    #[test]
    fn cabe_no_discord() {
        // 30 s em 10 MB: ~2,4 Mbit/s de vídeo, em 720p.
        let (v, h) = fit_bitrate(30.0, 10, 96);
        assert!((2_200..=2_500).contains(&v), "{v}");
        assert_eq!(h, Some(720));
        let (_, h) = fit_bitrate(60.0, 10, 96);
        assert_eq!(h, Some(480));
        let (v, h) = fit_bitrate(10.0, 25, 96);
        assert_eq!(h, None);
        assert!(v <= 20_000);
        // Tamanho final estimado fica abaixo do limite.
        let (v, _) = fit_bitrate(35.0, 10, 96);
        assert!(((v + 96) as f64 * 35.0 / 8.0 / 1000.0) < 10.0);
    }

    #[test]
    fn comprimir_e_vertical() {
        let a = compress_args("a.mp4", "b.mp4", VideoEncoder::Nvenc, 30.0, 10).join(" ");
        assert!(a.contains("h264_nvenc"));
        assert!(a.contains("min(720,ih)"));
        assert!(a.contains("-b:a 96k"));
        let v = vertical_args("a.mp4", "v.mp4", VideoEncoder::MfHw).join(" ");
        assert!(v.contains("crop='min(iw,ih*9/16)':ih,scale=1080:1920"));
        assert!(v.contains("-hw_encoding 1"));
    }

    #[test]
    fn miniatura() {
        let a = thumb_args("a.mp4", "t.jpg").join(" ");
        assert!(a.contains("-frames:v 1"));
        assert!(a.ends_with("-f image2 t.jpg"));
    }

    #[test]
    fn nome_do_clipe() {
        assert_eq!(clean_clip_name("Ace no Ascent").as_deref(), Some("Ace no Ascent.mp4"));
        assert_eq!(clean_clip_name("a/b:c?.mp4").as_deref(), Some("abc.mp4"));
        assert_eq!(clean_clip_name("  ...  "), None);
        assert_eq!(clean_clip_name("con"), None);
        assert_eq!(clean_clip_name("").as_deref(), None);
    }

    #[test]
    fn limpeza_respeita_favoritos() {
        let day = 86_400_000;
        let now = 100 * day;
        let c = |n: &str, gb: u64, d: u64| ClipFile { name: n.into(), size: gb * 1_000_000_000, modified: now - d * day };
        let clips = vec![c("velho", 1, 40), c("fav", 1, 50), c("medio", 3, 10), c("novo", 3, 1)];
        let fav = vec!["fav".to_string()];
        assert_eq!(clips_to_delete(&clips, now, 30, 0, &fav), vec!["velho"]);
        // Limite 5 GB: tira o velho (1) e o médio (3) → sobra 4 GB.
        assert_eq!(clips_to_delete(&clips, now, 0, 5, &fav), vec!["velho", "medio"]);
        assert!(clips_to_delete(&clips, now, 0, 0, &fav).is_empty());
    }

    #[test]
    fn webhook_e_multipart() {
        assert!(valid_discord_webhook("https://discord.com/api/webhooks/123456/abcdefghijk"));
        assert!(!valid_discord_webhook("https://evil.com/api/webhooks/123"));
        assert!(!valid_discord_webhook("https://discord.com/api/webhooks/"));
        assert!(!valid_discord_webhook("http://discord.com/api/webhooks/123456/abcdefghijk"));
        let body = discord_multipart("XYZ", "clip\".mp4", b"DATA", "Olha essa!");
        let t = String::from_utf8_lossy(&body);
        assert!(t.starts_with("--XYZ\r\n"));
        assert!(t.contains("{\"content\":\"Olha essa!\"}"));
        assert!(t.contains("filename=\"clip.mp4\""));
        assert!(t.contains("\r\n\r\nDATA\r\n--XYZ--\r\n"));
    }

    #[test]
    fn base64_padrao() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn bipe_wav_valido() {
        let w = beep_wav(880.0, 100, 0.3);
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(&w[8..12], b"WAVE");
        assert_eq!(w.len(), 44 + 4410 * 2);
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()) as usize, w.len() - 44);
    }

    /// Ponta a ponta com o FFmpeg do sistema: corta, comprime e faz miniatura.
    #[test]
    fn ferramentas_com_ffmpeg_real() {
        use std::process::Command;
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.mp4");
        let st = Command::new("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=8"])
            .args(["-f", "lavfi", "-i", "sine=duration=8", "-c:v", "mpeg4", "-g", "30", "-c:a", "aac", "-shortest"])
            .arg(&src)
            .output()
            .unwrap();
        assert!(st.status.success(), "{}", String::from_utf8_lossy(&st.stderr));
        let p = |x: &std::path::Path| x.to_str().unwrap().to_string();
        let cut = dir.path().join("cut.mp4");
        let r = Command::new("ffmpeg").args(trim_args(&p(&src), &p(&cut), 2.0, 6.0)).output().unwrap();
        assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        let info = Command::new("ffmpeg").args(["-hide_banner", "-i", &p(&cut)]).output().unwrap();
        let d = parse_duration(&String::from_utf8_lossy(&info.stderr)).unwrap();
        assert!((3.5..=5.5).contains(&d), "{d}");
        let thumb = dir.path().join("t.jpg");
        let r = Command::new("ffmpeg").args(thumb_args(&p(&src), &p(&thumb))).output().unwrap();
        assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
        let jpg = std::fs::read(&thumb).unwrap();
        assert_eq!(&jpg[..2], &[0xFF, 0xD8]);
    }
}
