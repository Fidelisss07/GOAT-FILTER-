//! Gravador do Goat Filter (replay instantâneo + gravação de gameplay).
//!
//! O FFmpeg mínimo (scripts/build-ffmpeg.sh) vai dentro do próprio executável e
//! é extraído na primeira vez. Ele captura a tela pela GPU e grava pedaços de
//! 2 s numa pasta; o app apaga os velhos e junta os últimos quando o atalho é
//! apertado. O som do PC vem do WASAPI (loopback) e entra pelo stdin do FFmpeg.

use goat_core::recorder::{self as rc, Pipeline, RecorderSettings};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// FFmpeg embutido pelo build.rs (vazio quando o build não o incluiu).
static ENGINE: &[u8] = include_bytes!(env!("GOAT_FFMPEG"));

pub fn engine_available() -> bool {
    cfg!(windows) && !ENGINE.is_empty()
}

fn engine_tag() -> &'static str {
    static TAG: OnceLock<String> = OnceLock::new();
    TAG.get_or_init(|| {
        let h = Sha256::digest(ENGINE);
        h.iter().take(6).map(|b| format!("{b:02x}")).collect()
    })
}

fn command(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// Roda e espera no máximo `limit`. Devolve (sucesso, stderr).
fn run_with_timeout(mut cmd: Command, limit: Duration) -> (bool, String) {
    let Ok(mut child) = cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).spawn() else {
        return (false, "não foi possível iniciar".into());
    };
    rc::tie_to_app(&child);
    let err = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = err {
            use std::io::Read;
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    let start = Instant::now();
    let ok = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.success(),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    (ok, reader.join().unwrap_or_default())
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecorderStatus {
    /// O motor de gravação existe nesta versão/sistema.
    pub available: bool,
    /// Capturando agora (replay e/ou gravação).
    pub running: bool,
    /// Preparando (testando a placa ou iniciando).
    pub starting: bool,
    /// Segundos da gravação manual em andamento.
    pub recording_secs: Option<u64>,
    /// Quantos segundos já dá para salvar.
    pub buffered_secs: u32,
    pub encoder: Option<String>,
    pub hardware: bool,
    pub size: Option<String>,
    pub fps: Option<u32>,
    pub error: Option<String>,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// Milissegundos desde 1970.
    pub modified: u64,
}

struct Running {
    child: Child,
    started: Instant,
    key: String,
    encoder: rc::VideoEncoder,
    size: (u32, u32),
    fps: u32,
    #[cfg(windows)]
    _audio: Option<audio::Loopback>,
}

#[derive(Default)]
struct Inner {
    run: Option<Running>,
    starting: bool,
    /// Primeiro pedaço da gravação manual e quando começou.
    recording: Option<(u64, Instant)>,
    /// Pedaços que não podem ser apagados (juntando uma gravação).
    pinned_from: Option<u64>,
    /// Caminho que funcionou nesta máquina, por (largura, altura, fps).
    pipeline: Option<(Pipeline, (u32, u32, u32))>,
    fails: u32,
    fail_key: Option<String>,
    error: Option<String>,
    last_janitor: Option<Instant>,
    settings: RecorderSettings,
    folder: PathBuf,
}

pub struct Recorder {
    data_dir: PathBuf,
    default_folder: PathBuf,
    inner: Mutex<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Chave da configuração que exige reiniciar a captura quando muda.
fn config_key(s: &RecorderSettings) -> String {
    format!("{}|{}|{:?}|{}|{}", s.max_height, s.fps, s.quality, s.system_audio, s.mic)
}

/// Quanto o anel guarda (sempre dá para salvar até 60 s).
fn keep_seconds(s: &RecorderSettings) -> u32 {
    s.clip_seconds.max(60)
}

impl Recorder {
    pub fn new(data_dir: PathBuf, default_folder: PathBuf) -> Arc<Self> {
        Arc::new(Self { data_dir, default_folder, inner: Mutex::new(Inner::default()) })
    }

    fn live_dir(&self) -> PathBuf {
        self.data_dir.join("replay").join("live")
    }

    fn folder_for(&self, s: &RecorderSettings) -> PathBuf {
        if s.folder.trim().is_empty() {
            self.default_folder.clone()
        } else {
            PathBuf::from(s.folder.trim())
        }
    }

    pub fn folder(&self) -> PathBuf {
        lock(&self.inner).folder.clone()
    }

    /// Extrai o FFmpeg embutido (uma vez por versão).
    fn engine(&self) -> Result<PathBuf, String> {
        if !engine_available() {
            return Err("O gravador não está disponível nesta versão.".into());
        }
        let dir = self.data_dir.join("engine");
        let path = dir.join(format!("ffmpeg-{}.exe", engine_tag()));
        if path.is_file() {
            return Ok(path);
        }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // Remove versões antigas.
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        let tmp = dir.join("ffmpeg.tmp");
        std::fs::write(&tmp, ENGINE).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        Ok(path)
    }

    pub fn status(&self) -> RecorderStatus {
        let g = lock(&self.inner);
        let buffered = if g.run.is_some() { rc::buffered_seconds(self.indices().len()) } else { 0 };
        RecorderStatus {
            available: engine_available(),
            running: g.run.is_some(),
            starting: g.starting,
            recording_secs: g.recording.map(|(_, t)| t.elapsed().as_secs()),
            buffered_secs: buffered.min(keep_seconds(&g.settings)),
            encoder: g.run.as_ref().map(|r| r.encoder.label().to_string()),
            hardware: g.run.as_ref().map(|r| r.encoder.is_hardware()).unwrap_or(false),
            size: g.run.as_ref().map(|r| format!("{}x{}", r.size.0, r.size.1)),
            fps: g.run.as_ref().map(|r| r.fps),
            error: g.error.clone(),
            folder: g.folder.to_string_lossy().into_owned(),
        }
    }

    fn indices(&self) -> Vec<u64> {
        std::fs::read_dir(self.live_dir())
            .map(|rd| rd.flatten().filter_map(|e| rc::parse_segment_index(e.file_name().to_str()?)).collect())
            .unwrap_or_default()
    }

    /// Chamado pelo loop de fundo a cada meio segundo.
    pub fn tick(self: &Arc<Self>, settings: &RecorderSettings, game_active: bool) {
        if !engine_available() {
            return;
        }
        let mut g = lock(&self.inner);
        g.settings = settings.clone();
        g.folder = self.folder_for(settings);
        let key = config_key(settings);
        if g.fail_key.as_deref() != Some(key.as_str()) {
            // Configuração nova: tenta de novo do zero.
            g.fails = 0;
            g.fail_key = Some(key.clone());
            if g.run.is_none() {
                g.error = None;
            }
        }

        // O FFmpeg parou sozinho?
        if let Some(r) = g.run.as_mut() {
            if let Ok(Some(_)) = r.child.try_wait() {
                let quick = r.started.elapsed() < Duration::from_secs(8);
                g.run = None;
                let log = std::fs::read_to_string(self.data_dir.join("replay").join("ffmpeg.log")).unwrap_or_default();
                let tail = rc::error_tail(&log);
                log::warn!("Gravador parou: {tail:?}");
                if quick {
                    g.fails += 1;
                    // O caminho escolhido pode ter deixado de funcionar (driver novo etc.).
                    g.pipeline = None;
                }
                g.error = Some(match tail {
                    Some(t) => format!("A gravação parou: {t}"),
                    None => "A gravação parou.".into(),
                });
            }
        }

        let want = g.recording.is_some()
            || g.pinned_from.is_some()
            || (settings.replay && (!settings.only_in_game || game_active));
        let running_key = g.run.as_ref().map(|r| r.key.clone());
        match (want, running_key) {
            (false, Some(_)) => self.stop_locked(&mut g),
            (true, Some(k)) if k != key && g.recording.is_none() => self.stop_locked(&mut g),
            _ => {}
        }
        if want && g.run.is_none() && !g.starting && g.fails < 3 {
            g.starting = true;
            let me = self.clone();
            let s = settings.clone();
            std::thread::Builder::new()
                .name("goat-recorder-start".into())
                .spawn(move || me.start(s, key))
                .ok();
        }

        if g.last_janitor.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
            g.last_janitor = Some(Instant::now());
            let protect = g.recording.map(|(i, _)| i).or(g.pinned_from);
            let keep = keep_seconds(settings);
            drop(g);
            let dir = self.live_dir();
            for i in rc::stale_segments(&self.indices(), keep, protect) {
                let _ = std::fs::remove_file(dir.join(rc::segment_name(i)));
            }
        }
    }

    fn stop_locked(&self, g: &mut Inner) {
        if let Some(mut r) = g.run.take() {
            let _ = r.child.kill();
            let _ = r.child.wait();
            // Captura parada de propósito: o vídeo antigo não serve mais.
            if g.pinned_from.is_none() && g.recording.is_none() {
                let _ = std::fs::remove_dir_all(self.live_dir());
            }
        }
    }

    /// Para tudo (app fechando).
    pub fn shutdown(&self) {
        let mut g = lock(&self.inner);
        g.recording = None;
        self.stop_locked(&mut g);
    }

    fn fail_start(&self, msg: String) {
        log::warn!("Gravador: {msg}");
        let mut g = lock(&self.inner);
        g.starting = false;
        g.fails += 1;
        g.error = Some(msg);
    }

    fn start(self: Arc<Self>, s: RecorderSettings, key: String) {
        let exe = match self.engine() {
            Ok(p) => p,
            Err(e) => return self.fail_start(e),
        };
        let (sw, sh) = primary_size();
        let (w, h) = rc::output_size(sw, sh, s.max_height);
        let cached = lock(&self.inner).pipeline.filter(|(_, k)| *k == (w, h, s.fps)).map(|(p, _)| p);
        let pipeline = match cached.or_else(|| probe(&exe, w, h, s.fps)) {
            Some(p) => p,
            None => {
                return self.fail_start(
                    "Nenhum codificador de vídeo funcionou nesta máquina. Atualize o driver da placa de vídeo.".into(),
                )
            }
        };
        lock(&self.inner).pipeline = Some((pipeline, (w, h, s.fps)));

        // Pasta dos pedaços: começa limpa se a configuração mudou.
        let replay = self.data_dir.join("replay");
        let live = self.live_dir();
        let key_file = replay.join("config.txt");
        if std::fs::read_to_string(&key_file).ok().as_deref() != Some(key.as_str()) {
            let _ = std::fs::remove_dir_all(&live);
        }
        if let Err(e) = std::fs::create_dir_all(&live) {
            return self.fail_start(format!("Não foi possível criar a pasta temporária: {e}"));
        }
        let _ = std::fs::write(&key_file, &key);
        let start_number = self.indices().into_iter().max().map(|m| m + 1).unwrap_or(0);

        #[cfg(windows)]
        let audio_fmt = if s.system_audio { audio::format() } else { None };
        #[cfg(not(windows))]
        let audio_fmt: Option<rc::AudioFormat> = None;

        let spec = rc::CaptureSpec {
            pipeline,
            width: w,
            height: h,
            fps: s.fps,
            bitrate_kbps: rc::bitrate_kbps(w, h, s.fps, s.quality),
            output_idx: 0,
            system_audio: audio_fmt,
            mic: (!s.mic.is_empty()).then(|| s.mic.clone()),
            segment_dir: live.to_string_lossy().into_owned(),
            start_number,
        };
        let log_file = match std::fs::File::create(replay.join("ffmpeg.log")) {
            Ok(f) => f,
            Err(e) => return self.fail_start(e.to_string()),
        };
        let mut cmd = command(&exe);
        cmd.args(rc::capture_args(&spec))
            .stdin(if audio_fmt.is_some() { Stdio::piped() } else { Stdio::null() })
            .stdout(Stdio::null())
            .stderr(log_file);
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => return self.fail_start(format!("Não foi possível iniciar a gravação: {e}")),
        };
        rc::tie_to_app(&child);
        #[cfg(windows)]
        let audio = match (audio_fmt, child.stdin.take()) {
            (Some(f), Some(stdin)) => Some(audio::Loopback::start(stdin, f)),
            _ => None,
        };
        log::info!(
            "Gravador: {} {}x{} {} fps, {} kbit/s, som do PC: {}, microfone: {}",
            pipeline.encoder.label(),
            w,
            h,
            s.fps,
            spec.bitrate_kbps,
            audio_fmt.is_some(),
            !s.mic.is_empty()
        );
        let mut g = lock(&self.inner);
        g.starting = false;
        g.error = None;
        g.run = Some(Running {
            child,
            started: Instant::now(),
            key,
            encoder: pipeline.encoder,
            size: (w, h),
            fps: s.fps,
            #[cfg(windows)]
            _audio: audio,
        });
    }

    /// Junta os pedaços em um .mp4 na pasta dos clipes.
    fn export(&self, picks: &[u64], prefix: &str, last_secs: Option<u32>) -> Result<PathBuf, String> {
        if picks.len() < 2 {
            return Err("Ainda não há vídeo suficiente. Espere alguns segundos.".into());
        }
        let exe = self.engine()?;
        let folder = self.folder();
        std::fs::create_dir_all(&folder).map_err(|e| format!("Pasta dos clipes: {e}"))?;
        let live = self.live_dir();
        let joined = self.data_dir.join("replay").join(format!("export-{}.ts", picks[0]));
        {
            use std::io::Write;
            let mut out = std::io::BufWriter::new(std::fs::File::create(&joined).map_err(|e| e.to_string())?);
            for i in picks {
                if let Ok(bytes) = std::fs::read(live.join(rc::segment_name(*i))) {
                    out.write_all(&bytes).map_err(|e| e.to_string())?;
                }
            }
            out.flush().map_err(|e| e.to_string())?;
        }
        let mut name = rc::clip_file_name(prefix, rc::local_time());
        let mut n = 2;
        while folder.join(&name).exists() {
            name = name.replace(".mp4", &format!(" ({n}).mp4"));
            n += 1;
        }
        let out = folder.join(&name);
        let (inp, outp) = (joined.to_string_lossy().into_owned(), out.to_string_lossy().into_owned());
        let mut cmd = command(&exe);
        cmd.args(rc::remux_args(&inp, &outp, last_secs));
        let (mut ok, mut err) = run_with_timeout(cmd, Duration::from_secs(120));
        if !ok && last_secs.is_some() {
            let mut cmd = command(&exe);
            cmd.args(rc::remux_args(&inp, &outp, None));
            (ok, err) = run_with_timeout(cmd, Duration::from_secs(120));
        }
        let _ = std::fs::remove_file(&joined);
        if ok {
            Ok(out)
        } else {
            let _ = std::fs::remove_file(&out);
            Err(format!("Não foi possível salvar o vídeo: {}", rc::error_tail(&err).unwrap_or_default()))
        }
    }

    /// Salva os últimos `seconds` segundos.
    pub fn save_clip(&self, seconds: u32) -> Result<PathBuf, String> {
        if lock(&self.inner).run.is_none() {
            return Err("O replay não está ligado agora.".into());
        }
        let seconds = seconds.clamp(5, 120);
        let picks = rc::clip_segments(&self.indices(), seconds);
        // Segura esses pedaços enquanto junta.
        lock(&self.inner).pinned_from = picks.first().copied();
        let r = self.export(&picks, "Clipe", Some(seconds));
        lock(&self.inner).pinned_from = None;
        r
    }

    pub fn recording(&self) -> bool {
        lock(&self.inner).recording.is_some()
    }

    /// Começa a gravação manual (o loop de fundo liga a captura se precisar).
    pub fn start_recording(&self) -> Result<(), String> {
        if !engine_available() {
            return Err("O gravador não está disponível nesta versão.".into());
        }
        let mut g = lock(&self.inner);
        let max = self.indices().into_iter().max();
        // Capturando: começa no pedaço atual. Parado: no próximo que será criado.
        let first = match (g.run.is_some(), max) {
            (true, Some(m)) => m,
            (false, Some(m)) => m + 1,
            (_, None) => 0,
        };
        if g.recording.is_none() {
            g.recording = Some((first, Instant::now()));
            g.fails = 0;
        }
        Ok(())
    }

    /// Para a gravação manual e salva o vídeo.
    pub fn stop_recording(&self) -> Result<PathBuf, String> {
        let from = {
            let mut g = lock(&self.inner);
            let Some((from, _)) = g.recording.take() else {
                return Err("Nenhuma gravação em andamento.".into());
            };
            g.pinned_from = Some(from);
            from
        };
        let picks = rc::segments_since(&self.indices(), from);
        let r = self.export(&picks, "Gameplay", None);
        lock(&self.inner).pinned_from = None;
        r
    }

    pub fn list_clips(&self) -> Vec<ClipInfo> {
        let mut v: Vec<ClipInfo> = std::fs::read_dir(self.folder())
            .map(|rd| {
                rd.flatten()
                    .filter_map(|e| {
                        let p = e.path();
                        if p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("mp4")) != Some(true) {
                            return None;
                        }
                        let meta = e.metadata().ok()?;
                        let modified = meta
                            .modified()
                            .ok()?
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        Some(ClipInfo {
                            name: e.file_name().to_string_lossy().into_owned(),
                            path: p.to_string_lossy().into_owned(),
                            size: meta.len(),
                            modified,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        v.sort_by(|a, b| b.modified.cmp(&a.modified));
        v.truncate(100);
        v
    }

    /// Só aceita .mp4 dentro da pasta dos clipes.
    pub fn checked_clip(&self, path: &str) -> Result<PathBuf, String> {
        let p = PathBuf::from(path);
        let folder = self.folder();
        let ok = p.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("mp4")) == Some(true)
            && p.parent().map(|d| d == folder).unwrap_or(false)
            && p.is_file();
        if ok {
            Ok(p)
        } else {
            Err("Arquivo fora da pasta dos clipes.".into())
        }
    }

    /// Microfones disponíveis (DirectShow).
    pub fn microphones(&self) -> Vec<String> {
        let Ok(exe) = self.engine() else { return vec![] };
        let mut cmd = command(&exe);
        cmd.args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"]);
        let (_, err) = run_with_timeout(cmd, Duration::from_secs(10));
        rc::parse_dshow_audio(&err)
    }
}

/// Resolução atual do monitor principal (pixels reais).
fn primary_size() -> (u32, u32) {
    goat_core::monitors::enumerate()
        .into_iter()
        .find(|d| d.primary)
        .and_then(|d| goat_core::tweaks::display_mode(&d.id))
        .map(|m| (m.width, m.height))
        .unwrap_or((1920, 1080))
}

/// Testa os caminhos do mais leve para o mais pesado.
fn probe(exe: &Path, w: u32, h: u32, fps: u32) -> Option<Pipeline> {
    for p in rc::PIPELINES {
        let mut cmd = command(exe);
        cmd.args(rc::probe_args(p, w, h, fps));
        let (ok, err) = run_with_timeout(cmd, Duration::from_secs(12));
        if ok {
            log::info!("Gravador: usando {:?}", p);
            return Some(p);
        }
        log::info!("Gravador: {:?} não funcionou: {}", p, rc::error_tail(&err).unwrap_or_default());
    }
    None
}

/// Som do PC (o que sai nas caixas/fones), via WASAPI loopback.
#[cfg(windows)]
mod audio {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use goat_core::recorder::AudioFormat;
    use std::io::Write;
    use std::process::ChildStdin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, RecvTimeoutError, SyncSender};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn supported(f: cpal::SampleFormat) -> bool {
        matches!(f, cpal::SampleFormat::F32 | cpal::SampleFormat::I16)
    }

    pub fn format() -> Option<AudioFormat> {
        let dev = cpal::default_host().default_output_device()?;
        let cfg = dev.default_output_config().ok()?;
        supported(cfg.sample_format()).then(|| AudioFormat { rate: cfg.sample_rate().0, channels: cfg.channels() })
    }

    fn build(tx: SyncSender<Vec<f32>>, fmt: AudioFormat) -> Option<cpal::Stream> {
        let dev = cpal::default_host().default_output_device()?;
        let cfg = dev.default_output_config().ok()?;
        let sf = cfg.sample_format();
        let config: cpal::StreamConfig = cfg.into();
        if config.sample_rate.0 != fmt.rate || config.channels != fmt.channels {
            return None;
        }
        let err = |e: cpal::StreamError| log::warn!("Som do PC: {e}");
        let stream = match sf {
            cpal::SampleFormat::F32 => dev.build_input_stream(
                &config,
                move |d: &[f32], _: &cpal::InputCallbackInfo| {
                    let _ = tx.try_send(d.to_vec());
                },
                err,
                None,
            ),
            cpal::SampleFormat::I16 => dev.build_input_stream(
                &config,
                move |d: &[i16], _: &cpal::InputCallbackInfo| {
                    let _ = tx.try_send(d.iter().map(|v| *v as f32 / 32768.0).collect());
                },
                err,
                None,
            ),
            _ => return None,
        };
        match stream {
            Ok(s) => {
                let _ = s.play();
                Some(s)
            }
            Err(e) => {
                log::warn!("Som do PC indisponível: {e}");
                None
            }
        }
    }

    pub struct Loopback {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Loopback {
        pub fn start(stdin: ChildStdin, fmt: AudioFormat) -> Self {
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let thread = std::thread::Builder::new()
                .name("goat-recorder-audio".into())
                .spawn(move || run(stdin, fmt, flag))
                .ok();
            Self { stop, thread }
        }
    }

    impl Drop for Loopback {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(t) = self.thread.take() {
                let _ = t.join();
            }
        }
    }

    /// Escreve o som no FFmpeg. O Windows não entrega nada quando o PC está em
    /// silêncio, então completa com zeros para o áudio não sair do tempo.
    fn run(mut out: ChildStdin, fmt: AudioFormat, stop: Arc<AtomicBool>) {
        let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(512);
        let stream = build(tx, fmt);
        let rate = fmt.rate as u64;
        let ch = fmt.channels.max(1) as usize;
        let start = Instant::now();
        let mut written: u64 = 0;
        let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
        while !stop.load(Ordering::SeqCst) {
            let expected = start.elapsed().as_micros() as u64 * rate / 1_000_000;
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok(samples) => {
                    let frames = (samples.len() / ch) as u64;
                    // Muito adiantado (voltou do silêncio)? Descarta para não atrasar a imagem.
                    if written <= expected + rate / 5 {
                        for v in samples {
                            buf.extend_from_slice(&v.to_le_bytes());
                        }
                        written += frames;
                    }
                }
                Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => {}
            }
            let expected = start.elapsed().as_micros() as u64 * rate / 1_000_000;
            if expected > written + rate / 10 {
                let missing = expected - written - rate / 50;
                buf.resize(buf.len() + missing as usize * ch * 4, 0);
                written += missing;
            }
            if !buf.is_empty() {
                if out.write_all(&buf).is_err() {
                    break;
                }
                buf.clear();
            }
        }
        drop(stream);
    }
}
