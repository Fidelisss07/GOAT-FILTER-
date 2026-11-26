//! Gravador leve: replay instantâneo ("salvar os últimos 30 s") e gravação
//! manual de gameplay.
//!
//! Como fica leve:
//! - a tela é capturada pela própria GPU (Desktop Duplication, filtro `ddagrab`)
//!   e o quadro vai direto para o codificador de vídeo da placa (NVIDIA NVENC,
//!   AMD AMF ou Media Foundation). O processador quase não trabalha;
//! - o vídeo é gravado em pedaços de 2 s num anel no disco. Salvar um clipe é só
//!   juntar os últimos pedaços, sem codificar de novo;
//! - por padrão o replay só fica ligado com o jogo aberto.
//!
//! Nada aqui abre ou mexe no processo do jogo: a captura é da área de trabalho
//! já composta pelo Windows, como faz o OBS.
//!
//! Este módulo só monta argumentos e escolhe pedaços (testável no Linux). Quem
//! inicia o FFmpeg e o áudio é o app (src-tauri/src/recorder.rs).

use serde::{Deserialize, Serialize};

/// Duração de cada pedaço do anel, em segundos.
pub const SEGMENT_SECS: u32 = 2;
/// Durações oferecidas na interface.
pub const CLIP_CHOICES: [u32; 7] = [15, 20, 25, 30, 35, 45, 60];
pub const HEIGHT_CHOICES: [u32; 3] = [720, 1080, 1440];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    /// Arquivos menores (bom para mandar no Discord/WhatsApp).
    Light,
    #[default]
    Balanced,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RecorderSettings {
    /// Replay instantâneo ligado.
    pub replay: bool,
    /// Replay só enquanto um jogo dos perfis está aberto.
    pub only_in_game: bool,
    /// Duração do clipe salvo pelo atalho (segundos).
    pub clip_seconds: u32,
    /// Altura máxima do vídeo (720, 1080 ou 1440 = 2K). Telas menores ficam no tamanho real.
    pub max_height: u32,
    pub fps: u32,
    pub quality: Quality,
    /// Som do PC (o que sai nos fones/caixas).
    pub system_audio: bool,
    /// Microfone (nome do dispositivo). Vazio = sem microfone.
    pub mic: String,
    /// Pasta dos clipes. Vazio = Vídeos\Goat Filter.
    pub folder: String,
    /// Bipe curto quando um clipe é salvo.
    pub save_sound: bool,
    /// Som do PC e microfone também em faixas separadas (para editar depois).
    pub separate_tracks: bool,
    /// Apaga clipes com mais de N dias (0 = nunca). Favoritos ficam.
    pub keep_days: u32,
    /// Limite da pasta em GB (0 = sem limite). Apaga os mais velhos.
    pub max_gb: u32,
    /// Webhook de um canal do Discord para enviar clipes.
    pub discord_webhook: String,
    /// Nomes dos clipes favoritos (nunca apagados pela limpeza).
    pub favorites: Vec<String>,
}

impl Default for RecorderSettings {
    fn default() -> Self {
        Self {
            replay: false,
            only_in_game: true,
            clip_seconds: 30,
            max_height: 1080,
            fps: 60,
            quality: Quality::Balanced,
            system_audio: true,
            mic: String::new(),
            folder: String::new(),
            save_sound: true,
            separate_tracks: false,
            keep_days: 0,
            max_gb: 0,
            discord_webhook: String::new(),
            favorites: Vec::new(),
        }
    }
}

impl RecorderSettings {
    pub fn sanitized(mut self) -> Self {
        self.clip_seconds = self.clip_seconds.clamp(5, 120);
        if !HEIGHT_CHOICES.contains(&self.max_height) {
            self.max_height = 1080;
        }
        if self.fps != 30 && self.fps != 60 {
            self.fps = 60;
        }
        self.mic = self.mic.trim().chars().take(200).collect();
        self.folder = self.folder.trim().chars().take(500).collect();
        self.keep_days = self.keep_days.min(3650);
        self.max_gb = self.max_gb.min(10_000);
        self.discord_webhook = self.discord_webhook.trim().to_string();
        if !self.discord_webhook.is_empty() && !crate::clips::valid_discord_webhook(&self.discord_webhook) {
            self.discord_webhook.clear();
        }
        self.favorites.retain(|f| !f.trim().is_empty());
        self.favorites.sort();
        self.favorites.dedup();
        self.favorites.truncate(1000);
        self
    }
}

/// Codificador de vídeo usado.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoEncoder {
    /// NVIDIA (chip de vídeo dedicado da placa).
    Nvenc,
    /// AMD.
    Amf,
    /// Media Foundation com hardware (Intel Quick Sync e outros).
    MfHw,
    /// Media Foundation por software (último recurso, usa o processador).
    MfSw,
}

impl VideoEncoder {
    pub fn label(self) -> &'static str {
        match self {
            Self::Nvenc => "NVIDIA NVENC",
            Self::Amf => "AMD AMF",
            Self::MfHw => "Intel / Windows (Media Foundation)",
            Self::MfSw => "Processador (software)",
        }
    }
    /// Usa a placa de vídeo para codificar.
    pub fn is_hardware(self) -> bool {
        self != Self::MfSw
    }
}

/// Caminho do quadro até o codificador.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FramePath {
    /// Tudo na GPU (redimensiona com o processador de vídeo do D3D11).
    Gpu,
    /// Copia o quadro para a memória e redimensiona no processador (reserva).
    Cpu,
}

/// De onde vem a imagem da tela.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    /// Windows Graphics Capture (como o OBS): recebe cada quadro que o Windows
    /// desenha, inclusive de jogo em tela cheia e com resolução esticada.
    Wgc,
    /// Desktop Duplication (reserva): em tela cheia o Windows às vezes só
    /// entrega uma imagem nova a cada vários segundos (vídeo "em fotos").
    #[default]
    Dda,
}

impl Source {
    pub fn label(self) -> &'static str {
        match self {
            Source::Wgc => "Windows Graphics Capture",
            Source::Dda => "Desktop Duplication",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pipeline {
    pub encoder: VideoEncoder,
    pub path: FramePath,
    #[serde(default)]
    pub source: Source,
}

const fn pl(source: Source, encoder: VideoEncoder, path: FramePath) -> Pipeline {
    Pipeline { encoder, path, source }
}

/// Ordem de tentativa: primeiro a captura do Windows Graphics Capture, depois o mais leve.
pub const PIPELINES: [Pipeline; 11] = [
    pl(Source::Wgc, VideoEncoder::Nvenc, FramePath::Gpu),
    pl(Source::Wgc, VideoEncoder::Amf, FramePath::Gpu),
    pl(Source::Wgc, VideoEncoder::MfHw, FramePath::Gpu),
    pl(Source::Wgc, VideoEncoder::MfSw, FramePath::Cpu),
    pl(Source::Dda, VideoEncoder::Nvenc, FramePath::Gpu),
    pl(Source::Dda, VideoEncoder::Amf, FramePath::Gpu),
    pl(Source::Dda, VideoEncoder::MfHw, FramePath::Gpu),
    pl(Source::Dda, VideoEncoder::Nvenc, FramePath::Cpu),
    pl(Source::Dda, VideoEncoder::Amf, FramePath::Cpu),
    pl(Source::Dda, VideoEncoder::MfHw, FramePath::Cpu),
    pl(Source::Dda, VideoEncoder::MfSw, FramePath::Cpu),
];

/// Tamanho do vídeo: a tela, limitada à altura escolhida, sempre em números pares.
pub fn output_size(screen_w: u32, screen_h: u32, max_h: u32) -> (u32, u32) {
    let even = |v: u32| (v.max(2) / 2) * 2;
    if screen_h <= max_h || screen_h == 0 {
        return (even(screen_w), even(screen_h));
    }
    let w = (screen_w as u64 * max_h as u64 + screen_h as u64 / 2) / screen_h as u64;
    (even(w as u32), even(max_h))
}

/// Taxa de bits do vídeo (kbit/s). 1080p60: 10, 16 ou 25 Mbit/s.
pub fn bitrate_kbps(w: u32, h: u32, fps: u32, q: Quality) -> u32 {
    let base = match q {
        Quality::Light => 10_000.0,
        Quality::Balanced => 16_000.0,
        Quality::High => 25_000.0,
    };
    let pixels = (w as f64 * h as f64) / (1920.0 * 1080.0);
    let motion = (fps.max(1) as f64 / 60.0).max(0.6);
    ((base * pixels * motion) as u32).clamp(2_500, 60_000)
}

/// Formato do som do PC entregue pelo app no stdin do FFmpeg (f32 intercalado).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub rate: u32,
    pub channels: u16,
}

/// Tudo o que define uma captura.
#[derive(Debug, Clone, PartialEq)]
pub struct CaptureSpec {
    pub pipeline: Pipeline,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    /// Saída do DXGI (0 = monitor principal na maioria dos PCs).
    pub output_idx: u32,
    /// HMONITOR do monitor (para o Windows Graphics Capture); 0 = o primeiro.
    pub hmonitor: u64,
    pub system_audio: Option<AudioFormat>,
    pub mic: Option<String>,
    /// Pasta dos pedaços (`seg-000001.ts`).
    pub segment_dir: String,
    /// Som do PC e microfone também em faixas separadas.
    pub separate_tracks: bool,
    /// Número do primeiro pedaço (continua a numeração depois de reiniciar).
    pub start_number: u64,
}

fn s(v: impl ToString) -> String {
    v.to_string()
}

/// Grafo do filtro de vídeo (entrada lavfi).
/// Limite da captura: o dobro do fps do vídeo (máx. 240).
///
/// Com o limite igual ao fps do vídeo, a tela chega a cada ~16,6 ms e um
/// quadro um pouco adiantado é descartado por "chegar cedo demais": metade
/// some e o vídeo de 60 fps sai com ~30 quadros diferentes por segundo
/// (travado). Capturando com folga, o `fps=` escolhe o quadro certo para
/// cada instante do vídeo.
pub fn capture_rate(fps: u32) -> u32 {
    (fps * 2).clamp(fps, 240)
}

pub fn video_graph(p: Pipeline, output_idx: u32, hmonitor: u64, w: u32, h: u32, fps: u32) -> String {
    let cap = capture_rate(fps);
    let grab = match p.source {
        Source::Dda => format!("ddagrab=output_idx={output_idx}:framerate={cap}:dup_frames=1:draw_mouse=1,fps={fps}"),
        // O WGC só entrega quadro quando a tela muda, com o horário certo de
        // cada um; o fps= completa o ritmo constante para o codificador.
        Source::Wgc => {
            let target = if hmonitor != 0 { format!("hmonitor={hmonitor}") } else { "monitor_idx=0".into() };
            format!("gfxcapture={target}:max_framerate={cap}:capture_cursor=1:display_border=0,fps={fps}")
        }
    };
    match p.path {
        FramePath::Gpu => format!("{grab},scale_d3d11=width={w}:height={h}:format=nv12"),
        FramePath::Cpu => format!("{grab},hwdownload,format=bgra,scale={w}:{h}:flags=fast_bilinear,format=nv12"),
    }
}

/// Opções do codificador. Um quadro-chave a cada pedaço para cortar sem recodificar.
pub fn video_codec_args(enc: VideoEncoder, kbps: u32, fps: u32) -> Vec<String> {
    let gop = fps * SEGMENT_SECS;
    let rate = [
        s("-b:v"),
        format!("{kbps}k"),
        s("-maxrate"),
        format!("{}k", kbps * 3 / 2),
        s("-bufsize"),
        format!("{}k", kbps * 2),
    ];
    let mut a: Vec<String> = match enc {
        VideoEncoder::Nvenc => vec![
            s("-c:v"), s("h264_nvenc"), s("-preset"), s("p4"), s("-tune"), s("hq"),
            s("-rc"), s("vbr"), s("-bf"), s("0"), s("-forced-idr"), s("1"),
        ],
        VideoEncoder::Amf => vec![
            s("-c:v"), s("h264_amf"), s("-usage"), s("transcoding"), s("-quality"), s("speed"),
            s("-rc"), s("vbr_peak"), s("-bf"), s("0"),
        ],
        VideoEncoder::MfHw => vec![s("-c:v"), s("h264_mf"), s("-hw_encoding"), s("1"), s("-rate_control"), s("pc_vbr")],
        VideoEncoder::MfSw => vec![s("-c:v"), s("h264_mf"), s("-rate_control"), s("pc_vbr")],
    };
    a.extend(rate);
    a.extend([s("-g"), s(gop), s("-force_key_frames"), format!("expr:gte(t,n_forced*{SEGMENT_SECS})")]);
    a
}

/// Partes de entrada/saída comuns (também usadas nos testes com vídeo sintético).
pub fn assemble(
    video_input: Vec<String>,
    video_codec: Vec<String>,
    system_audio: Option<AudioFormat>,
    mic: Option<&str>,
    segment_dir: &str,
    start_number: u64,
    separate_tracks: bool,
) -> Vec<String> {
    // -xerror: se a captura da tela falhar (tela cheia, troca de resolução), o
    // FFmpeg sai e o app reinicia; sem isso ele seguiria gravando só o áudio.
    let mut a = vec![s("-hide_banner"), s("-loglevel"), s("warning"), s("-xerror"), s("-y")];
    a.extend(video_input);
    let mut audio_inputs = 0;
    if let Some(f) = system_audio {
        a.extend([
            s("-thread_queue_size"), s("512"), s("-f"), s("f32le"), s("-ar"), s(f.rate),
            s("-ac"), s(f.channels), s("-i"), s("pipe:0"),
        ]);
        audio_inputs += 1;
    }
    if let Some(m) = mic {
        a.extend([
            s("-thread_queue_size"), s("512"), s("-f"), s("dshow"), s("-audio_buffer_size"), s("50"),
            s("-i"), format!("audio={m}"),
        ]);
        audio_inputs += 1;
    }
    a.extend([s("-map"), s("0:v")]);
    match audio_inputs {
        0 => a.push(s("-an")),
        1 => {
            a.extend([s("-map"), s("1:a"), s("-af"), s("aresample=async=1000")])
        }
        _ if separate_tracks => {
            // Faixa 1: mistura (a que os players tocam). 2: som do PC. 3: microfone.
            a.extend([
                s("-filter_complex"),
                s("[1:a]asplit=2[s1][s2];[2:a]asplit=2[m1][m2];[s1][m1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=async=1000[aout];[s2]aresample=async=1000[sys];[m2]aresample=async=1000[mic]"),
                s("-map"), s("[aout]"), s("-map"), s("[sys]"), s("-map"), s("[mic]"),
                s("-metadata:s:a:0"), s("title=Jogo + microfone"),
                s("-metadata:s:a:1"), s("title=Jogo"),
                s("-metadata:s:a:2"), s("title=Microfone"),
            ])
        }
        _ => {
            a.extend([
            s("-filter_complex"),
            s("[1:a][2:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=async=1000[aout]"),
            s("-map"),
            s("[aout]"),
        ])
        }
    }
    a.extend(video_codec);
    // Cabeçalho do vídeo em todo quadro-chave: cada pedaço abre sozinho.
    a.extend([s("-bsf:v"), s("dump_extra=freq=keyframe")]);
    if audio_inputs > 0 {
        a.extend([s("-c:a"), s("aac"), s("-b:a"), s("160k"), s("-ar"), s("48000"), s("-ac"), s("2")]);
    }
    a.extend([
        s("-max_muxing_queue_size"), s("512"),
        // Nunca segura mais de 2 s esperando uma faixa atrasada (o padrão é 10 s).
        s("-max_interleave_delta"), s("2000000"),
        s("-f"), s("segment"),
        s("-segment_time"), s(SEGMENT_SECS),
        s("-segment_format"), s("mpegts"),
        s("-segment_start_number"), s(start_number),
        s("-reset_timestamps"), s("0"),
        format!("{}/seg-%06d.ts", segment_dir.trim_end_matches(['/', '\\'])),
    ]);
    a
}

/// Argumentos do FFmpeg para a captura contínua.
pub fn capture_args(spec: &CaptureSpec) -> Vec<String> {
    let graph = video_graph(spec.pipeline, spec.output_idx, spec.hmonitor, spec.width, spec.height, spec.fps);
    assemble(
        vec![s("-f"), s("lavfi"), s("-i"), graph],
        video_codec_args(spec.pipeline.encoder, spec.bitrate_kbps, spec.fps),
        spec.system_audio,
        spec.mic.as_deref(),
        &spec.segment_dir,
        spec.start_number,
        spec.separate_tracks,
    )
}

/// Teste rápido (1 s) para descobrir o que a placa aceita. Com `out`, grava
/// um .ts para conferir se a imagem não sai preta.
pub fn probe_args(p: Pipeline, output_idx: u32, hmonitor: u64, w: u32, h: u32, fps: u32, out: Option<&str>) -> Vec<String> {
    let mut a = vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-f"), s("lavfi"), s("-i"), video_graph(p, output_idx, hmonitor, w, h, fps),
        s("-t"), s("1.2"), s("-an"),
    ];
    a.extend(video_codec_args(p.encoder, bitrate_kbps(w, h, fps, Quality::Balanced), fps));
    match out {
        Some(f) => a.extend([s("-f"), s("mpegts"), s(f)]),
        None => a.extend([s("-f"), s("null"), s("-")]),
    }
    a
}

/// Um quadro do vídeo reduzido a 16x9 em tons de cinza (para medir o brilho).
pub fn frame_check_args(input: &str, output: &str) -> Vec<String> {
    vec![
        s("-hide_banner"), s("-loglevel"), s("error"), s("-y"),
        s("-ss"), s("0.6"), s("-i"), s(input),
        s("-frames:v"), s("1"), s("-vf"), s("scale=16:9,format=gray"),
        s("-f"), s("rawvideo"), s(output),
    ]
}

/// Brilho médio e máximo (0–255) de um quadro em cinza.
pub fn brightness(gray: &[u8]) -> (f32, u8) {
    if gray.is_empty() {
        return (0.0, 0);
    }
    let sum: u64 = gray.iter().map(|&v| v as u64).sum();
    (sum as f32 / gray.len() as f32, *gray.iter().max().unwrap_or(&0))
}

/// A imagem tem conteúdo (não é tela preta)?
pub fn has_picture(gray: &[u8]) -> bool {
    let (mean, max) = brightness(gray);
    gray.len() >= 16 && (max > 24 || mean > 6.0)
}

/// Converte os pedaços juntados (.ts) em .mp4, sem recodificar.
/// `last_secs` corta para os últimos N segundos.
pub fn remux_args(input: &str, output: &str, last_secs: Option<u32>) -> Vec<String> {
    let mut a = vec![s("-hide_banner"), s("-loglevel"), s("error"), s("-y")];
    if let Some(n) = last_secs {
        a.extend([s("-sseof"), format!("-{n}")]);
    }
    a.extend([
        s("-i"), s(input),
        s("-map"), s("0"), s("-c"), s("copy"),
        s("-bsf:a"), s("aac_adtstoasc"),
        s("-movflags"), s("+faststart"),
        s(output),
    ]);
    a
}

pub fn segment_name(i: u64) -> String {
    format!("seg-{i:06}.ts")
}

pub fn parse_segment_index(name: &str) -> Option<u64> {
    name.strip_prefix("seg-")?.strip_suffix(".ts")?.parse().ok()
}

fn needed(seconds: u32) -> usize {
    seconds.div_ceil(SEGMENT_SECS) as usize
}

/// Pedaços para um clipe dos últimos `seconds` (o último ainda está sendo gravado).
/// `indices` em qualquer ordem.
pub fn clip_segments(indices: &[u64], seconds: u32) -> Vec<u64> {
    let mut v = indices.to_vec();
    v.sort_unstable();
    v.dedup();
    let take = needed(seconds) + 1;
    let start = v.len().saturating_sub(take);
    v[start..].to_vec()
}

/// Pedaços desde o início de uma gravação manual.
pub fn segments_since(indices: &[u64], from: u64) -> Vec<u64> {
    let mut v: Vec<u64> = indices.iter().copied().filter(|&i| i >= from).collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// Pedaços velhos que já podem ser apagados. Mantém o suficiente para o maior
/// clipe e tudo a partir de `protect_from` (gravação manual em andamento).
pub fn stale_segments(indices: &[u64], keep_seconds: u32, protect_from: Option<u64>) -> Vec<u64> {
    let mut v = indices.to_vec();
    v.sort_unstable();
    v.dedup();
    let keep = needed(keep_seconds) + 3;
    let cut = v.len().saturating_sub(keep);
    v[..cut].iter().copied().filter(|&i| protect_from.is_none_or(|p| i < p)).collect()
}

/// Segundos já guardados no anel (aproximado).
pub fn buffered_seconds(count: usize) -> u32 {
    (count.saturating_sub(1) as u32) * SEGMENT_SECS
}

/// Nome do arquivo: "Clipe 2026-11-18 21-03-05.mp4".
pub fn clip_file_name(prefix: &str, (y, mo, d, h, mi, se): (u16, u16, u16, u16, u16, u16)) -> String {
    format!("{prefix} {y:04}-{mo:02}-{d:02} {h:02}-{mi:02}-{se:02}.mp4")
}

/// Microfones listados pelo `ffmpeg -list_devices true -f dshow -i dummy`.
pub fn parse_dshow_audio(stderr: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in stderr.lines() {
        if !line.trim_end().ends_with("(audio)") {
            continue;
        }
        let Some(a) = line.find('"') else { continue };
        let Some(b) = line[a + 1..].find('"') else { continue };
        let name = line[a + 1..a + 1 + b].to_string();
        if !name.is_empty() && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// Últimas linhas úteis do log do FFmpeg para mostrar num erro.
pub fn error_tail(log: &str) -> Option<String> {
    let lines: Vec<&str> = log.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let tail = lines.iter().rev().take(2).rev().copied().collect::<Vec<_>>().join(" · ");
    (!tail.is_empty()).then(|| tail.chars().take(300).collect())
}

/// Data e hora local (para o nome dos arquivos).
pub fn local_time() -> (u16, u16, u16, u16, u16, u16) {
    #[cfg(windows)]
    {
        let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
        (t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
    }
    #[cfg(not(windows))]
    {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        civil(secs)
    }
}

/// Segundos desde 1970 (UTC) para data e hora.
pub fn civil(secs: u64) -> (u16, u16, u16, u16, u16, u16) {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Algoritmo de Howard Hinnant (days_from_civil invertido).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y as u16, m as u16, d as u16, (rem / 3600) as u16, (rem % 3600 / 60) as u16, (rem % 60) as u16)
}

/// Faz o processo filho (FFmpeg) morrer junto com o Goat Filter, mesmo se o
/// app fechar de repente: nada de gravação esquecida rodando escondida.
#[cfg(windows)]
pub fn tie_to_app(child: &std::process::Child) {
    use std::os::windows::io::AsRawHandle;
    use std::sync::OnceLock;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    static JOB: OnceLock<Option<usize>> = OnceLock::new();
    let job = JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(None, windows::core::PCWSTR::null()).ok()?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .ok()?;
        Some(job.0 as usize)
    });
    if let Some(job) = job {
        unsafe {
            let _ = AssignProcessToJobObject(HANDLE(*job as *mut std::ffi::c_void), HANDLE(child.as_raw_handle()));
        }
    }
}

#[cfg(not(windows))]
pub fn tie_to_app(_child: &std::process::Child) {}

/// Dá prioridade à captura: com a placa em 100% pelo jogo, o Windows atrasa
/// a cópia da tela e o clipe sai com quadros repetidos (travado). Sobe a
/// prioridade de processador do FFmpeg um nível e a de GPU para "alta"
/// (ou "acima do normal" se o Windows não deixar). Quase não custa FPS.
#[cfg(windows)]
pub fn boost_priority(child: &std::process::Child) -> Option<&'static str> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Threading::{SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS};
    let h = HANDLE(child.as_raw_handle());
    unsafe {
        let _ = SetPriorityClass(h, ABOVE_NORMAL_PRIORITY_CLASS);
        let lib = libloading::Library::new("gdi32.dll").ok()?;
        type SetGpuPrio = unsafe extern "system" fn(*mut std::ffi::c_void, i32) -> i32;
        let f: libloading::Symbol<SetGpuPrio> = lib.get(b"D3DKMTSetProcessSchedulingPriorityClass\0").ok()?;
        // 4 = HIGH, 3 = ABOVE_NORMAL (NTSTATUS 0 = ok).
        if f(h.0, 4) == 0 {
            return Some("alta");
        }
        if f(h.0, 3) == 0 {
            return Some("acima do normal");
        }
        None
    }
}

/// Memória privada (MB) de um processo filho, para vigiar o gravador.
#[cfg(windows)]
pub fn process_memory_mb(child: &std::process::Child) -> Option<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX};
    let mut c = PROCESS_MEMORY_COUNTERS_EX::default();
    c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
    unsafe {
        GetProcessMemoryInfo(HANDLE(child.as_raw_handle()), &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb).ok()?;
    }
    Some((c.PrivateUsage.max(c.WorkingSetSize) / (1024 * 1024)) as u64)
}

#[cfg(not(windows))]
pub fn process_memory_mb(_child: &std::process::Child) -> Option<u64> {
    None
}

/// Acima disto o gravador está acumulando algo (o normal é 100 a 300 MB).
pub const MEMORY_LIMIT_MB: u64 = 700;

#[cfg(not(windows))]
pub fn boost_priority(_child: &std::process::Child) -> Option<&'static str> {
    None
}

/// Do .ts gravado: horários (PTS, 90 kHz) de cada quadro de vídeo e se há som.
pub fn ts_scan(bytes: &[u8]) -> (Vec<i64>, bool) {
    let mut pmt: Option<u16> = None;
    let mut video: Option<u16> = None;
    let mut audio = false;
    let mut pts = Vec::new();
    for p in bytes.chunks_exact(188) {
        if p[0] != 0x47 {
            continue;
        }
        let start = p[1] & 0x40 != 0;
        let pid = (((p[1] & 0x1f) as u16) << 8) | p[2] as u16;
        let afc = (p[3] >> 4) & 3;
        let mut off = 4usize;
        if afc == 2 || afc == 3 {
            off += 1 + p[4] as usize;
        }
        if afc == 2 || off >= 188 {
            continue;
        }
        let pl = &p[off..];
        if pid == 0 && start && pmt.is_none() {
            // PAT: pula o pointer_field e o cabeçalho (8 bytes).
            let s = 1 + pl[0] as usize;
            if pl.len() >= s + 12 {
                pmt = Some((((pl[s + 10] & 0x1f) as u16) << 8) | pl[s + 11] as u16);
            }
        } else if Some(pid) == pmt && start && video.is_none() {
            let s = 1 + pl[0] as usize;
            if pl.len() < s + 12 {
                continue;
            }
            let sec_len = ((((pl[s + 1] & 0x0f) as usize) << 8) | pl[s + 2] as usize).min(pl.len() - s - 3);
            let info = ((((pl[s + 10] & 0x0f) as usize) << 8) | pl[s + 11] as usize) + s + 12;
            let end = s + 3 + sec_len.saturating_sub(4);
            let mut i = info;
            while i + 5 <= end {
                let ty = pl[i];
                let epid = (((pl[i + 1] & 0x1f) as u16) << 8) | pl[i + 2] as u16;
                let es = ((((pl[i + 3] & 0x0f) as usize) << 8) | pl[i + 4] as usize) + 5;
                match ty {
                    0x1b | 0x24 => video = Some(epid),
                    0x0f | 0x11 => audio = true,
                    _ => {}
                }
                i += es;
            }
        } else if Some(pid) == video && start && pl.len() >= 14 && pl[0] == 0 && pl[1] == 0 && pl[2] == 1 && pl[7] & 0x80 != 0 {
            let b = &pl[9..14];
            let v = (((b[0] >> 1) & 0x07) as i64) << 30
                | (b[1] as i64) << 22
                | ((b[2] >> 1) as i64) << 15
                | (b[3] as i64) << 7
                | (b[4] >> 1) as i64;
            pts.push(v);
        }
    }
    (pts, audio)
}

/// Ritmo dos quadros: (fps médio, % de intervalos fora do ritmo por mais de 25%).
pub fn frame_pacing(pts: &[i64], fps: u32) -> Option<(f32, f32)> {
    if pts.len() < 10 {
        return None;
    }
    let mut v = pts.to_vec();
    v.sort_unstable();
    let ideal = 90_000.0 / fps as f64;
    let d: Vec<f64> = v.windows(2).map(|w| (w[1] - w[0]) as f64).filter(|x| *x > 0.0).collect();
    if d.is_empty() {
        return None;
    }
    let span = (v[v.len() - 1] - v[0]) as f64 / 90_000.0;
    let avg_fps = if span > 0.0 { (v.len() - 1) as f64 / span } else { 0.0 };
    let off = d.iter().filter(|x| (*x - ideal).abs() > ideal * 0.25).count();
    Some((avg_fps as f32, off as f32 * 100.0 / d.len() as f32))
}

/// Tamanho dos quadros usados para medir a fluidez (cinza, 64x36).
pub const SMOOTH_W: usize = 64;
pub const SMOOTH_H: usize = 36;

/// Extrai todos os quadros do clipe em miniatura cinza (para contar repetidos).
pub fn smoothness_args(input: &str, out_raw: &str) -> Vec<String> {
    [
        "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-an",
        "-vf", "scale=64:36:flags=area,format=gray", "-f", "rawvideo", out_raw,
    ]
    .iter()
    .map(|x| x.to_string())
    .collect()
}

/// (quadros diferentes do anterior, total). Quadro repetido = travada.
pub fn count_unique(raw: &[u8]) -> (usize, usize) {
    let n = SMOOTH_W * SMOOTH_H;
    let frames: Vec<&[u8]> = raw.chunks_exact(n).collect();
    if frames.is_empty() {
        return (0, 0);
    }
    let mut unique = 1;
    for w in frames.windows(2) {
        let diff: u64 = w[0].iter().zip(w[1]).map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as u64).sum();
        // Média de diferença acima de 0,2 (de 255) = imagem mudou.
        if diff * 10 > (n as u64) * 2 {
            unique += 1;
        }
    }
    (unique, frames.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tamanho_limita_altura_e_mantem_proporcao() {
        assert_eq!(output_size(2560, 1440, 1440), (2560, 1440));
        assert_eq!(output_size(2560, 1440, 1080), (1920, 1080));
        assert_eq!(output_size(3840, 2160, 1440), (2560, 1440));
        assert_eq!(output_size(1920, 1080, 1440), (1920, 1080));
        assert_eq!(output_size(1366, 768, 720), (1280, 720));
        assert_eq!(output_size(1365, 767, 1080), (1364, 766));
    }

    #[test]
    fn taxa_de_bits_por_qualidade_e_tamanho() {
        assert_eq!(bitrate_kbps(1920, 1080, 60, Quality::Balanced), 16_000);
        assert!(bitrate_kbps(2560, 1440, 60, Quality::Balanced) > 25_000);
        assert!(bitrate_kbps(1920, 1080, 30, Quality::Light) < bitrate_kbps(1920, 1080, 60, Quality::Light));
        assert_eq!(bitrate_kbps(3840, 2160, 60, Quality::High), 60_000);
    }

    #[test]
    fn grafo_gpu_e_cpu() {
        let g = video_graph(PIPELINES[4], 0, 0, 2560, 1440, 60);
        assert!(g.starts_with("ddagrab=output_idx=0:framerate=120:dup_frames=1:draw_mouse=1,fps=60,"), "{g}");
        let w = video_graph(PIPELINES[0], 0, 65537, 1440, 1080, 60);
        assert!(w.starts_with("gfxcapture=hmonitor=65537:max_framerate=120:capture_cursor=1:display_border=0,fps=60,scale_d3d11=width=1440:height=1080"), "{w}");
        assert!(video_graph(PIPELINES[0], 0, 0, 1920, 1080, 60).starts_with("gfxcapture=monitor_idx=0"));
        assert!(g.ends_with("scale_d3d11=width=2560:height=1440:format=nv12"));
        let c = video_graph(Pipeline { encoder: VideoEncoder::MfSw, path: FramePath::Cpu, source: Source::Dda }, 1, 0, 1280, 720, 30);
        assert!(c.contains("hwdownload,format=bgra,scale=1280:720"));
        // Captura com folga (o dobro), nunca acima de 240.
        assert_eq!(capture_rate(30), 60);
        assert_eq!(capture_rate(60), 120);
        assert_eq!(capture_rate(144), 240);
    }

    #[test]
    fn codificador_tem_quadro_chave_por_pedaco() {
        let a = video_codec_args(VideoEncoder::Nvenc, 16_000, 60).join(" ");
        assert!(a.contains("-c:v h264_nvenc"));
        assert!(a.contains("-g 120"));
        assert!(a.contains("-b:v 16000k -maxrate 24000k -bufsize 32000k"));
        assert!(a.contains("expr:gte(t,n_forced*2)"));
        assert!(video_codec_args(VideoEncoder::MfHw, 8000, 30).join(" ").contains("-hw_encoding 1"));
        assert!(!video_codec_args(VideoEncoder::MfSw, 8000, 30).join(" ").contains("-hw_encoding"));
    }

    fn spec() -> CaptureSpec {
        CaptureSpec {
            pipeline: PIPELINES[0],
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 16_000,
            output_idx: 0,
            hmonitor: 0,
            system_audio: Some(AudioFormat { rate: 48_000, channels: 2 }),
            mic: None,
            segment_dir: r"C:\tmp\replay\".into(),
            separate_tracks: false,
            start_number: 42,
        }
    }

    #[test]
    fn captura_com_som_do_pc() {
        let a = capture_args(&spec());
        let j = a.join(" ");
        assert!(j.contains("-f f32le -ar 48000 -ac 2 -i pipe:0"));
        assert!(j.contains("-map 0:v -map 1:a"));
        assert!(j.contains("-c:a aac"));
        assert!(j.contains("-segment_start_number 42"));
        assert_eq!(a.last().unwrap(), r"C:\tmp\replay/seg-%06d.ts");
    }

    #[test]
    fn captura_com_microfone_mistura() {
        let mut sp = spec();
        sp.mic = Some("Microfone (Realtek)".into());
        let j = capture_args(&sp).join(" ");
        assert!(j.contains("-i audio=Microfone (Realtek)"));
        assert!(j.contains("amix=inputs=2"));
        assert!(j.contains("-map [aout]"));
    }

    #[test]
    fn faixas_separadas() {
        let mut sp = spec();
        sp.mic = Some("Mic".into());
        sp.separate_tracks = true;
        let j = capture_args(&sp).join(" ");
        assert!(j.contains("asplit=2"));
        assert!(j.contains("-map [aout] -map [sys] -map [mic]"));
        assert!(j.contains("title=Microfone"));
        // Sem microfone não tem o que separar.
        sp.mic = None;
        assert!(!capture_args(&sp).join(" ").contains("asplit"));
    }

    #[test]
    fn captura_sem_som() {
        let mut sp = spec();
        sp.system_audio = None;
        let a = capture_args(&sp);
        assert!(a.contains(&"-an".to_string()));
        assert!(!a.contains(&"-c:a".to_string()));
    }

    #[test]
    fn so_microfone_usa_entrada_1() {
        let mut sp = spec();
        sp.system_audio = None;
        sp.mic = Some("Mic".into());
        let j = capture_args(&sp).join(" ");
        assert!(j.contains("-map 1:a"));
        assert!(!j.contains("pipe:0"));
    }

    #[test]
    fn teste_da_placa_e_brilho() {
        let a = probe_args(PIPELINES[4], 2, 0, 1920, 1080, 60, Some("p.ts")).join(" ");
        assert!(a.contains("ddagrab=output_idx=2"));
        assert!(a.ends_with("-f mpegts p.ts"));
        assert!(probe_args(PIPELINES[0], 0, 0, 1920, 1080, 60, None).join(" ").ends_with("-f null -"));
        let f = frame_check_args("p.ts", "f.raw").join(" ");
        assert!(f.contains("scale=16:9,format=gray"));
        assert!(!has_picture(&[0u8; 144]));
        assert!(!has_picture(&[3u8; 144]));
        let mut img = [10u8; 144];
        img[5] = 200;
        assert!(has_picture(&img));
        assert_eq!(brightness(&[0, 100]), (50.0, 100));
    }

    #[test]
    fn captura_sai_se_a_tela_falhar() {
        assert!(capture_args(&spec()).contains(&"-xerror".to_string()));
    }

    #[test]
    fn remux_corta_o_fim() {
        let a = remux_args("in.ts", "out.mp4", Some(30)).join(" ");
        assert!(a.contains("-sseof -30 -i in.ts"));
        assert!(a.contains("-c copy"));
        assert!(a.ends_with("+faststart out.mp4"));
        assert!(!remux_args("in.ts", "out.mp4", None).join(" ").contains("sseof"));
    }

    #[test]
    fn ritmo_dos_quadros() {
        let even: Vec<i64> = (0..120).map(|i| i * 1500).collect();
        let (f, off) = frame_pacing(&even, 60).unwrap();
        assert!((f - 60.0).abs() < 0.1 && off == 0.0);
        // Ritmo irregular: alterna 15,6 ms e 31,2 ms.
        let mut t = 0i64;
        let jit: Vec<i64> = (0..120).map(|i| { t += if i % 2 == 0 { 1404 } else { 2808 }; t }).collect();
        let (_, off) = frame_pacing(&jit, 60).unwrap();
        assert!(off > 40.0);
        assert!(frame_pacing(&[1, 2], 60).is_none());
    }

    #[test]
    fn le_horarios_do_ts() {
        // PAT → PMT (pid 0x1000) → vídeo H.264 (0x100) e AAC (0x101); 2 quadros.
        fn pkt(pid: u16, start: bool, payload: &[u8]) -> Vec<u8> {
            let mut p = vec![0x47, ((start as u8) << 6) | (pid >> 8) as u8, pid as u8, 0x10];
            p.extend_from_slice(payload);
            p.resize(188, 0xff);
            p
        }
        let pat = [0u8, 0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xf0, 0x00, 0, 0, 0, 0];
        let pmt = [0u8, 0x02, 0xb0, 0x17, 0, 1, 0xc1, 0, 0, 0xe1, 0x00, 0xf0, 0x00,
            0x1b, 0xe1, 0x00, 0xf0, 0x00, 0x0f, 0xe1, 0x01, 0xf0, 0x00, 0, 0, 0, 0];
        fn pes(pts: i64) -> Vec<u8> {
            vec![0, 0, 1, 0xe0, 0, 0, 0x80, 0x80, 5,
                0x21 | (((pts >> 30) & 7) << 1) as u8, (pts >> 22) as u8, 0x01 | (((pts >> 15) & 0x7f) << 1) as u8,
                (pts >> 7) as u8, 0x01 | ((pts & 0x7f) << 1) as u8]
        }
        let ts = [pkt(0, true, &pat), pkt(0x1000, true, &pmt), pkt(0x100, true, &pes(126_000)), pkt(0x100, true, &pes(127_500))].concat();
        let (pts, audio) = ts_scan(&ts);
        assert_eq!(pts, vec![126_000, 127_500]);
        assert!(audio);
    }

    #[test]
    fn mede_fluidez() {
        let n = SMOOTH_W * SMOOTH_H;
        let a = vec![10u8; n];
        let mut b = vec![10u8; n];
        b[..200].iter_mut().for_each(|x| *x = 200);
        let mut noise = a.clone();
        noise[0] = 13; // ruído de compressão: conta como repetido
        let raw = [a.clone(), a.clone(), noise, b.clone(), b.clone(), a.clone()].concat();
        assert_eq!(count_unique(&raw), (3, 6));
        assert_eq!(count_unique(&[]), (0, 0));
        let s = smoothness_args("c.mp4", "q.raw").join(" ");
        assert!(s.contains("-i c.mp4 -an -vf scale=64:36:flags=area,format=gray -f rawvideo q.raw"));
    }

    #[test]
    fn nomes_dos_pedacos() {
        assert_eq!(segment_name(7), "seg-000007.ts");
        assert_eq!(parse_segment_index("seg-000123.ts"), Some(123));
        assert_eq!(parse_segment_index("ffmpeg.log"), None);
        assert_eq!(parse_segment_index("seg-abc.ts"), None);
    }

    #[test]
    fn escolhe_pedacos_do_clipe() {
        let idx: Vec<u64> = (10..40).rev().collect();
        // 30 s = 15 pedaços + o que está sendo gravado
        let c = clip_segments(&idx, 30);
        assert_eq!(c.len(), 16);
        assert_eq!(*c.first().unwrap(), 24);
        assert_eq!(*c.last().unwrap(), 39);
        // 15 s = 8 pedaços + 1
        assert_eq!(clip_segments(&idx, 15).len(), 9);
        // pouco gravado ainda: devolve o que tem
        assert_eq!(clip_segments(&[1, 2], 30), vec![1, 2]);
        assert!(clip_segments(&[], 30).is_empty());
    }

    #[test]
    fn limpeza_mantem_janela_e_gravacao() {
        let idx: Vec<u64> = (0..50).collect();
        let stale = stale_segments(&idx, 30, None);
        // mantém 15 + 3
        assert_eq!(stale.len(), 50 - 18);
        assert_eq!(*stale.last().unwrap(), 31);
        // gravação começou no 20: nada a partir dele é apagado
        let stale = stale_segments(&idx, 30, Some(20));
        assert_eq!(stale, (0..20).collect::<Vec<_>>());
        assert!(stale_segments(&[1, 2, 3], 30, None).is_empty());
    }

    #[test]
    fn pedacos_desde_o_inicio() {
        assert_eq!(segments_since(&[5, 3, 9, 7, 7], 5), vec![5, 7, 9]);
    }

    #[test]
    fn nome_do_clipe() {
        assert_eq!(clip_file_name("Clipe", (2026, 11, 8, 9, 3, 5)), "Clipe 2026-11-08 09-03-05.mp4");
    }

    #[test]
    fn lista_microfones() {
        let log = r#"[dshow @ 0000024] "HD Webcam" (video)
[dshow @ 0000024]   Alternative name "@device_pnp_\\?\usb"
[dshow @ 0000024] "Microfone (Realtek(R) Audio)" (audio)
[dshow @ 0000024]   Alternative name "@device_cm_{33D9A762}\wave_{AB}"
[dshow @ 0000024] "Headset (HyperX Cloud II)" (audio)
dummy: Immediate exit requested"#;
        assert_eq!(parse_dshow_audio(log), vec!["Microfone (Realtek(R) Audio)", "Headset (HyperX Cloud II)"]);
    }

    #[test]
    fn ajusta_configuracao_invalida() {
        let s = RecorderSettings { clip_seconds: 999, max_height: 900, fps: 144, mic: "  Mic  ".into(), ..Default::default() }
            .sanitized();
        assert_eq!(s.clip_seconds, 120);
        assert_eq!(s.max_height, 1080);
        assert_eq!(s.fps, 60);
        assert_eq!(s.mic, "Mic");
    }

    #[test]
    fn data_civil() {
        assert_eq!(civil(0), (1970, 1, 1, 0, 0, 0));
        assert_eq!(civil(1_794_888_766), (2026, 11, 17, 4, 12, 46));
        assert_eq!(civil(951_782_400), (2000, 2, 29, 0, 0, 0));
    }

    #[test]
    fn rabo_do_erro() {
        assert_eq!(error_tail("a\n\nb\nc\n").as_deref(), Some("b · c"));
        assert_eq!(error_tail("  \n"), None);
    }

    /// Ponta a ponta com o FFmpeg do sistema (se houver): grava pedaços de um
    /// vídeo sintético, junta os últimos e gera um .mp4 do tamanho certo.
    #[test]
    fn anel_de_pedacos_vira_mp4() {
        use std::process::Command;
        if Command::new("ffmpeg").arg("-version").output().is_err() {
            eprintln!("ffmpeg não encontrado; teste pulado");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let seg = dir.path().join("seg");
        std::fs::create_dir_all(&seg).unwrap();
        let fps = 30;
        let mut vcodec = vec![s("-c:v"), s("mpeg4"), s("-q:v"), s("5")];
        vcodec.extend([s("-g"), s(fps * SEGMENT_SECS), s("-force_key_frames"), format!("expr:gte(t,n_forced*{SEGMENT_SECS})")]);
        let input = vec![
            s("-f"), s("lavfi"), s("-i"), format!("testsrc2=size=320x180:rate={fps}:duration=13"),
            s("-f"), s("lavfi"), s("-i"), s("sine=frequency=440:sample_rate=48000:duration=13"),
        ];
        // Reaproveita o assemble, trocando as entradas de áudio por um seno sintético.
        let mut a = assemble(input, vcodec, None, None, seg.to_str().unwrap(), 100, false);
        let an = a.iter().position(|x| x == "-an").unwrap();
        a.splice(an..=an, [s("-map"), s("1:a"), s("-c:a"), s("aac"), s("-b:a"), s("96k")]);
        let st = Command::new("ffmpeg").args(&a).output().unwrap();
        assert!(st.status.success(), "{}", String::from_utf8_lossy(&st.stderr));

        let idx: Vec<u64> = std::fs::read_dir(&seg)
            .unwrap()
            .filter_map(|e| parse_segment_index(e.ok()?.file_name().to_str()?))
            .collect();
        assert!(idx.len() >= 6, "pedaços: {idx:?}");
        assert!(idx.iter().all(|&i| i >= 100));

        let pick = clip_segments(&idx, 6);
        let joined = dir.path().join("clip.ts");
        let mut bytes = Vec::new();
        for i in &pick {
            bytes.extend(std::fs::read(seg.join(segment_name(*i))).unwrap());
        }
        std::fs::write(&joined, bytes).unwrap();
        let out = dir.path().join("clip.mp4");
        let r = Command::new("ffmpeg")
            .args(remux_args(joined.to_str().unwrap(), out.to_str().unwrap(), Some(6)))
            .output()
            .unwrap();
        assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));

        let probe = Command::new("ffmpeg").args(["-hide_banner", "-i", out.to_str().unwrap()]).output().unwrap();
        let info = String::from_utf8_lossy(&probe.stderr);
        let dur = info
            .split("Duration: ")
            .nth(1)
            .and_then(|r| r.split(',').next())
            .and_then(|t| {
                let p: Vec<f64> = t.split(':').filter_map(|x| x.trim().parse().ok()).collect();
                (p.len() == 3).then(|| p[0] * 3600.0 + p[1] * 60.0 + p[2])
            })
            .expect(&info);
        assert!((5.0..=8.5).contains(&dur), "duração {dur}: {info}");
        assert!(info.contains("Audio: aac"), "{info}");
        assert!(info.contains("Video: mpeg4"), "{info}");
    }
}
