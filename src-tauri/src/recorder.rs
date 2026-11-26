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
    /// Monitor escolhido nas configurações (nome GDI); None = principal.
    monitor: Option<String>,
    /// Jogo estava aberto no tick anterior.
    was_game: bool,
    /// Reiniciar a captura neste instante (depois do jogo entrar em tela cheia).
    restart_at: Option<Instant>,
    /// Não reiniciar antes disso (pausa curta depois de uma queda).
    next_start: Option<Instant>,
    /// Tamanho do arquivo de log já conferido.
    log_seen: u64,
    /// Marcadores da gravação manual (segundos desde o início).
    markers: Vec<f64>,
    /// Codificador que funciona com quadros na memória (cortes/compressão).
    transcoder: Option<rc::VideoEncoder>,
    /// Caminho que funcionou nesta máquina, por (largura, altura, fps).
    pipeline: Option<(Pipeline, (u32, u32, u32))>,
    fails: u32,
    fail_key: Option<String>,
    error: Option<String>,
    last_janitor: Option<Instant>,
    /// Memória do gravador na última checagem (MB) e quantas vezes passou do limite.
    memory_mb: Option<u64>,
    memory_strikes: u32,
    memory_restarts: u32,
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
    format!("{}|{}|{:?}|{}|{}|{}", s.max_height, s.fps, s.quality, s.system_audio, s.mic, s.separate_tracks)
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
    pub fn tick(self: &Arc<Self>, settings: &RecorderSettings, game_active: bool, monitor: Option<String>) {
        if !engine_available() {
            return;
        }
        let mut g = lock(&self.inner);
        g.settings = settings.clone();
        g.folder = self.folder_for(settings);
        g.monitor = monitor;
        // A chave inclui o monitor e a resolução atual: mudou (tela esticada,
        // jogo em tela cheia com outra resolução)? Recomeça no tamanho certo.
        let gdi = game_monitor(&g.monitor);
        let size = gdi.as_deref().and_then(goat_core::tweaks::current_size).unwrap_or((0, 0));
        let key = format!("{}|{:?}|{}x{}", config_key(settings), gdi, size.0, size.1);
        // O jogo acabou de abrir: recomeça a captura daqui a pouco (a troca para
        // tela cheia derruba a captura da área de trabalho).
        if game_active && !g.was_game {
            g.restart_at = Some(Instant::now() + Duration::from_millis(3500));
        }
        g.was_game = game_active;
        if g.restart_at.is_some_and(|t| Instant::now() >= t) {
            g.restart_at = None;
            if g.run.is_some() {
                log::info!("Gravador: recomeçando depois do jogo abrir");
                self.restart_locked(&mut g);
            }
        }
        if g.fail_key.as_deref() != Some(key.as_str()) {
            // Configuração nova: tenta de novo do zero.
            g.fails = 0;
            g.fail_key = Some(key.clone());
            if g.run.is_none() {
                g.error = None;
            }
        }

        // O FFmpeg parou sozinho (captura caiu: -xerror)?
        if let Some(r) = g.run.as_mut() {
            if let Ok(Some(_)) = r.child.try_wait() {
                let quick = r.started.elapsed() < Duration::from_secs(8);
                g.run = None;
                let log = std::fs::read_to_string(self.data_dir.join("replay").join("ffmpeg.log")).unwrap_or_default();
                let tail = rc::error_tail(&log);
                log::warn!("Gravador parou: {tail:?}");
                // Pausa curta antes de recomeçar (a tela pode estar trocando de modo).
                g.next_start = Some(Instant::now() + Duration::from_millis(1200));
                if quick {
                    g.fails += 1;
                    // O caminho escolhido pode ter deixado de funcionar (driver novo etc.).
                    g.pipeline = None;
                    if g.fails >= 4 {
                        g.error = Some(match tail {
                            Some(t) => format!("A gravação parou: {t}"),
                            None => "A gravação parou.".into(),
                        });
                    }
                } else {
                    // Rodou bem e caiu (tela cheia, troca de resolução): só recomeça.
                    g.fails = 0;
                }
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
        let can_start = g.next_start.is_none_or(|t| Instant::now() >= t);
        if want && g.run.is_none() && !g.starting && g.fails < 4 && can_start {
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
            // Captura da tela falhou mas o FFmpeg seguiu (só áudio)? Recomeça.
            if g.run.is_some() {
                let path = self.data_dir.join("replay").join("ffmpeg.log");
                let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                if len > g.log_seen {
                    let text = std::fs::read_to_string(&path).unwrap_or_default();
                    let new = text.get(g.log_seen as usize..).unwrap_or("");
                    g.log_seen = len;
                    if new.contains("AcquireNextFrame failed") || new.contains("Failed to create desktop duplication") {
                        log::warn!("Gravador: a captura da tela caiu; recomeçando");
                        self.restart_locked(&mut g);
                    }
                }
            }
            // Memória: o gravador guarda o replay no disco; se a memória dele
            // passar do limite, algo está acumulando (uma faixa de som parada,
            // por exemplo). Anota o motivo e recomeça sem apagar o replay.
            let mem = g.run.as_ref().and_then(|r| rc::process_memory_mb(&r.child));
            g.memory_mb = mem;
            if let Some(mb) = mem {
                if mb > rc::MEMORY_LIMIT_MB {
                    g.memory_strikes += 1;
                    if g.memory_strikes >= 2 {
                        let path = self.data_dir.join("replay").join("ffmpeg.log");
                        let tail = rc::error_tail(&std::fs::read_to_string(&path).unwrap_or_default()).unwrap_or_default();
                        log::warn!("Gravador: usando {mb} MB de memória (limite {}); recomeçando. Último aviso: {tail}", rc::MEMORY_LIMIT_MB);
                        g.memory_restarts += 1;
                        g.memory_strikes = 0;
                        self.restart_locked(&mut g);
                    }
                } else {
                    g.memory_strikes = 0;
                }
            }
            let protect = g.recording.map(|(i, _)| i).or(g.pinned_from);
            let keep = keep_seconds(settings);
            drop(g);
            let dir = self.live_dir();
            for i in rc::stale_segments(&self.indices(), keep, protect) {
                let _ = std::fs::remove_file(dir.join(rc::segment_name(i)));
            }
        }
    }

    /// Recomeça a captura sem apagar o vídeo guardado.
    fn restart_locked(&self, g: &mut Inner) {
        if let Some(mut r) = g.run.take() {
            let _ = r.child.kill();
            let _ = r.child.wait();
        }
        g.next_start = Some(Instant::now() + Duration::from_millis(800));
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
        let gdi = game_monitor(&lock(&self.inner).monitor);
        let ((sw, sh), (idx, hmon)) = monitor_info(&gdi);
        let (w, h) = rc::output_size(sw, sh, s.max_height);
        let replay_dir = self.data_dir.join("replay");
        let _ = std::fs::create_dir_all(&replay_dir);
        let cached = lock(&self.inner).pipeline.filter(|(_, k)| *k == (w, h, s.fps)).map(|(p, _)| p);
        let pipeline = match cached.or_else(|| probe(&exe, &replay_dir, (idx, hmon), w, h, s.fps)) {
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
        let keep = {
            let g = lock(&self.inner);
            g.recording.is_some() || g.pinned_from.is_some()
        };
        if !keep && std::fs::read_to_string(&key_file).ok().as_deref() != Some(key.as_str()) {
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
            output_idx: idx,
            hmonitor: hmon,
            system_audio: audio_fmt,
            mic: (!s.mic.is_empty()).then(|| s.mic.clone()),
            segment_dir: live.to_string_lossy().into_owned(),
            separate_tracks: s.separate_tracks && !s.mic.is_empty(),
            start_number,
        };
        lock(&self.inner).log_seen = 0;
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
        let prio = rc::boost_priority(&child);
        #[cfg(windows)]
        let audio = match (audio_fmt, child.stdin.take()) {
            (Some(f), Some(stdin)) => Some(audio::Loopback::start(stdin, f)),
            _ => None,
        };
        log::info!(
            "Gravador: {} ({:?}) {}x{} {} fps, {} kbit/s, monitor {:?} (saída {idx}), prioridade de GPU: {}, som do PC: {}, microfone: {}",
            pipeline.encoder.label(),
            pipeline.path,
            w,
            h,
            s.fps,
            spec.bitrate_kbps,
            gdi,
            prio.unwrap_or("normal"),
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
    fn export(&self, picks: &[u64], prefix: &str, last_secs: Option<u32>, colors: Option<f32>) -> Result<PathBuf, String> {
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
        // Com as cores do filtro: recodifica só a imagem com a saturação. Se
        // falhar, salva do jeito normal (sem recodificar).
        let mut colored = false;
        if let Some(sat) = colors {
            if let Ok(enc) = self.transcoder(&exe) {
                let kbps = {
                    let g = lock(&self.inner);
                    let (w, h, fps) = g.run.as_ref().map(|r| (r.size.0, r.size.1, r.fps)).unwrap_or((1920, 1080, g.settings.fps));
                    // Um pouco mais de taxa: recodificar perde um pouco de detalhe.
                    rc::bitrate_kbps(w, h, fps, g.settings.quality) * 6 / 5
                };
                let mut cmd = command(&exe);
                cmd.args(goat_core::clips::color_args(&inp, &outp, enc, kbps, sat, last_secs));
                let (ok, _) = run_with_timeout(cmd, Duration::from_secs(240));
                colored = ok && std::fs::metadata(&out).map(|m| m.len() > 0).unwrap_or(false);
                if !colored {
                    let _ = std::fs::remove_file(&out);
                }
            }
        }
        if colored {
            let _ = std::fs::remove_file(&joined);
            return Ok(out);
        }
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
    /// `colors`: saturação do filtro para somar ao vídeo (None = como capturado).
    pub fn save_clip(&self, seconds: u32, colors: Option<f32>) -> Result<PathBuf, String> {
        if lock(&self.inner).run.is_none() {
            return Err("O replay não está ligado agora.".into());
        }
        let seconds = seconds.clamp(5, 120);
        let picks = rc::clip_segments(&self.indices(), seconds);
        // Segura esses pedaços enquanto junta.
        lock(&self.inner).pinned_from = picks.first().copied();
        let r = self.export(&picks, "Clipe", Some(seconds), colors);
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
            g.markers.clear();
            g.fails = 0;
        }
        Ok(())
    }

    /// Para a gravação manual e salva o vídeo.
    pub fn stop_recording(&self, colors: Option<f32>) -> Result<PathBuf, String> {
        let from = {
            let mut g = lock(&self.inner);
            let Some((from, _)) = g.recording.take() else {
                return Err("Nenhuma gravação em andamento.".into());
            };
            g.pinned_from = Some(from);
            from
        };
        let picks = rc::segments_since(&self.indices(), from);
        let markers = std::mem::take(&mut lock(&self.inner).markers);
        let r = self.export(&picks, "Gameplay", None, colors);
        if let (Ok(p), false) = (&r, markers.is_empty()) {
            let _ = std::fs::write(markers_path(p), serde_json::to_string(&markers).unwrap_or_default());
        }
        lock(&self.inner).pinned_from = None;
        r
    }

    fn list_clips_all(&self) -> Vec<ClipInfo> {
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
        v
    }

    pub fn list_clips(&self) -> Vec<ClipInfo> {
        let mut v = self.list_clips_all();
        v.truncate(200);
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

/// Arquivo com os marcadores de um vídeo ("Gameplay ....mp4.markers.json").
fn markers_path(clip: &Path) -> PathBuf {
    let mut p = clip.as_os_str().to_owned();
    p.push(".markers.json");
    PathBuf::from(p)
}

/// Nome livre ("x (2).mp4") na mesma pasta.
fn free_name(folder: &Path, name: &str) -> PathBuf {
    let mut out = folder.join(name);
    let base = name.trim_end_matches(".mp4");
    let mut n = 2;
    while out.exists() {
        out = folder.join(format!("{base} ({n}).mp4"));
        n += 1;
    }
    out
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default()
}

impl Recorder {
    /// Marca o momento atual da gravação manual.
    pub fn add_marker(&self) -> Result<f64, String> {
        let mut g = lock(&self.inner);
        let Some((_, t)) = g.recording else {
            return Err("Os marcadores funcionam durante a gravação de gameplay.".into());
        };
        let at = (t.elapsed().as_secs_f64() * 10.0).round() / 10.0;
        g.markers.push(at);
        Ok(at)
    }

    pub fn markers(&self, path: &str) -> Vec<f64> {
        self.checked_clip(path)
            .ok()
            .and_then(|p| std::fs::read_to_string(markers_path(&p)).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Codificador para recodificar arquivos (testa uma vez).
    fn transcoder(&self, exe: &Path) -> Result<rc::VideoEncoder, String> {
        if let Some(t) = lock(&self.inner).transcoder {
            return Ok(t);
        }
        for enc in [rc::VideoEncoder::Nvenc, rc::VideoEncoder::Amf, rc::VideoEncoder::MfHw, rc::VideoEncoder::MfSw] {
            let mut cmd = command(exe);
            cmd.args(goat_core::clips::encoder_probe_args(enc));
            if run_with_timeout(cmd, Duration::from_secs(10)).0 {
                lock(&self.inner).transcoder = Some(enc);
                return Ok(enc);
            }
        }
        Err("Nenhum codificador de vídeo funcionou nesta máquina.".into())
    }

    fn duration(&self, exe: &Path, input: &Path) -> Option<f64> {
        let mut cmd = command(exe);
        cmd.args(["-hide_banner", "-i"]).arg(input);
        let (_, err) = run_with_timeout(cmd, Duration::from_secs(15));
        goat_core::clips::parse_duration(&err)
    }

    fn run_tool(&self, exe: &Path, args: Vec<String>, out: &Path, limit: Duration) -> Result<PathBuf, String> {
        let mut cmd = command(exe);
        cmd.args(args);
        let (ok, err) = run_with_timeout(cmd, limit);
        if ok && out.is_file() {
            Ok(out.to_path_buf())
        } else {
            let _ = std::fs::remove_file(out);
            Err(format!("Não foi possível gerar o vídeo: {}", rc::error_tail(&err).unwrap_or_default()))
        }
    }

    /// Corte rápido entre `start` e `end` (segundos). Gera um arquivo novo.
    pub fn trim(&self, path: &str, start: f64, end: f64) -> Result<PathBuf, String> {
        let src = self.checked_clip(path)?;
        if end - start < 0.5 || start < 0.0 {
            return Err("Escolha um trecho de pelo menos meio segundo.".into());
        }
        let exe = self.engine()?;
        let out = free_name(&self.folder(), &format!("{} (corte).mp4", stem(&src)));
        let args = goat_core::clips::trim_args(&src.to_string_lossy(), &out.to_string_lossy(), start, end);
        self.run_tool(&exe, args, &out, Duration::from_secs(120))
    }

    /// Versão que cabe em `mb` MB (Discord grátis: 10).
    pub fn compress(&self, path: &str, mb: u32) -> Result<PathBuf, String> {
        let src = self.checked_clip(path)?;
        let exe = self.engine()?;
        let enc = self.transcoder(&exe)?;
        let dur = self.duration(&exe, &src).ok_or("Não foi possível ler a duração do vídeo.")?;
        let out = free_name(&self.folder(), &format!("{} ({mb} MB).mp4", stem(&src)));
        let args = goat_core::clips::compress_args(&src.to_string_lossy(), &out.to_string_lossy(), enc, dur, mb);
        self.run_tool(&exe, args, &out, Duration::from_secs(600))
    }

    /// Versão vertical 1080x1920 (TikTok, Reels, Shorts).
    pub fn vertical(&self, path: &str) -> Result<PathBuf, String> {
        let src = self.checked_clip(path)?;
        let exe = self.engine()?;
        let enc = self.transcoder(&exe)?;
        let out = free_name(&self.folder(), &format!("{} (vertical).mp4", stem(&src)));
        let args = goat_core::clips::vertical_args(&src.to_string_lossy(), &out.to_string_lossy(), enc);
        self.run_tool(&exe, args, &out, Duration::from_secs(600))
    }

    /// Miniatura em base64 (JPEG), guardada em cache.
    pub fn thumbnail(&self, path: &str) -> Option<String> {
        let src = self.checked_clip(path).ok()?;
        let meta = std::fs::metadata(&src).ok()?;
        let stamp = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
        let key = Sha256::digest(format!("{}|{}|{}", src.to_string_lossy(), meta.len(), stamp));
        let key: String = key.iter().take(10).map(|b| format!("{b:02x}")).collect();
        let dir = self.data_dir.join("thumbs");
        let file = dir.join(format!("{key}.jpg"));
        if !file.is_file() {
            let exe = self.engine().ok()?;
            std::fs::create_dir_all(&dir).ok()?;
            let mut cmd = command(&exe);
            cmd.args(goat_core::clips::thumb_args(&src.to_string_lossy(), &file.to_string_lossy()));
            run_with_timeout(cmd, Duration::from_secs(15));
        }
        let bytes = std::fs::read(&file).ok()?;
        Some(format!("data:image/jpeg;base64,{}", goat_core::clips::base64(&bytes)))
    }

    /// Troca o nome de um clipe (devolve o caminho novo).
    pub fn rename(&self, path: &str, name: &str) -> Result<PathBuf, String> {
        let src = self.checked_clip(path)?;
        let name = goat_core::clips::clean_clip_name(name).ok_or("Nome inválido.")?;
        let dst = self.folder().join(&name);
        if dst == src {
            return Ok(src);
        }
        if dst.exists() {
            return Err("Já existe um clipe com esse nome.".into());
        }
        std::fs::rename(&src, &dst).map_err(|e| e.to_string())?;
        let _ = std::fs::rename(markers_path(&src), markers_path(&dst));
        Ok(dst)
    }

    pub fn delete(&self, path: &str) -> Result<(), String> {
        let p = self.checked_clip(path)?;
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(markers_path(&p));
        Ok(())
    }

    /// Limpeza automática (dias e GB). Devolve quantos apagou.
    pub fn cleanup(&self, s: &RecorderSettings) -> usize {
        if s.keep_days == 0 && s.max_gb == 0 {
            return 0;
        }
        let clips: Vec<goat_core::clips::ClipFile> = self
            .list_clips_all()
            .into_iter()
            .map(|c| goat_core::clips::ClipFile { name: c.name, size: c.size, modified: c.modified })
            .collect();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let folder = self.folder();
        let mut n = 0;
        for name in goat_core::clips::clips_to_delete(&clips, now, s.keep_days, s.max_gb, &s.favorites) {
            let p = folder.join(&name);
            if std::fs::remove_file(&p).is_ok() {
                let _ = std::fs::remove_file(markers_path(&p));
                n += 1;
            }
        }
        if n > 0 {
            log::info!("Limpeza automática: {n} clipe(s) apagados");
        }
        n
    }

    /// Envia para um canal do Discord (webhook). Acima de 10 MB, comprime antes.
    pub fn send_discord(&self, path: &str, webhook: &str, agent: &ureq::Agent) -> Result<(), String> {
        if !goat_core::clips::valid_discord_webhook(webhook) {
            return Err("Configure o webhook do Discord na aba Gravação.".into());
        }
        let mut file = self.checked_clip(path)?;
        if std::fs::metadata(&file).map(|m| m.len()).unwrap_or(0) > 10_000_000 {
            file = self.compress(path, 9)?;
        }
        let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
        let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "clipe.mp4".into());
        let boundary: String = format!(
            "goatfilter{}",
            Sha256::digest(&bytes[..bytes.len().min(4096)]).iter().take(8).map(|b| format!("{b:02x}")).collect::<String>()
        );
        let body = goat_core::clips::discord_multipart(&boundary, &name, &bytes, "🐐 Clipe do Goat Filter");
        match agent
            .post(webhook.trim())
            .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
            .send_bytes(&body)
        {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(code, _)) => Err(format!("O Discord recusou o envio (código {code}). Confira o webhook.")),
            Err(e) => Err(format!("Sem conexão com o Discord: {e}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagItem {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagReport {
    pub items: Vec<DiagItem>,
    /// Texto para copiar e mandar no suporte.
    pub text: String,
}

impl Recorder {
    /// Testa imagem, som do PC e microfone em poucos segundos.
    pub fn diagnose(&self, s: &RecorderSettings) -> DiagReport {
        let mut items = Vec::new();
        let mut push = |name: &str, ok: bool, detail: String| items.push(DiagItem { name: name.into(), ok, detail });
        let exe = match self.engine() {
            Ok(e) => e,
            Err(e) => {
                push("Motor de gravação", false, e);
                return report(items, String::new());
            }
        };
        let dir = self.data_dir.join("replay");
        let _ = std::fs::create_dir_all(&dir);

        // Imagem
        let gdi = game_monitor(&lock(&self.inner).monitor);
        let ((sw, sh), (idx, hmon)) = monitor_info(&gdi);
        let (w, h) = rc::output_size(sw, sh, s.max_height);
        let cached = lock(&self.inner).pipeline.map(|(p, _)| p);
        let p = cached.or_else(|| probe(&exe, &dir, (idx, hmon), w, h, s.fps));
        match p.and_then(|p| probe_picture(&exe, &dir, p, (idx, hmon), w, h, s.fps).map(|r| (p, r))) {
            Some((p, (b, true))) => push(
                "Imagem",
                true,
                format!(
                    "{} · {} · {} · {}x{} {} fps · monitor {} (saída {idx}) · brilho {b:.0}",
                    p.source.label(),
                    p.encoder.label(),
                    if p.path == rc::FramePath::Gpu { "captura pela GPU" } else { "captura pelo processador (mais pesada)" },
                    w,
                    h,
                    s.fps,
                    gdi.clone().unwrap_or_default()
                ),
            ),
            Some((p, (b, false))) => push(
                "Imagem",
                false,
                format!("{} gravou a tela preta (brilho {b:.0}) no monitor {} (saída {idx}). Atualize o driver da placa.", p.encoder.label(), gdi.clone().unwrap_or_default()),
            ),
            None => push("Imagem", false, "Nenhum codificador de vídeo funcionou. Atualize o driver da placa.".into()),
        }

        // Som do PC: grava 1,6 s enquanto toca um bipe.
        if s.system_audio {
            use std::sync::atomic::{AtomicBool, Ordering};
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let peak = Arc::new(Mutex::new(0f32));
            let pk = peak.clone();
            let t = std::thread::spawn(move || {
                goat_core::loopback::run(flag, false, |d| {
                    let p = goat_core::loopback::peak(d);
                    let mut g = lock(&pk);
                    *g = g.max(p);
                    true
                })
            });
            std::thread::sleep(Duration::from_millis(300));
            goat_core::clips::play_beep();
            std::thread::sleep(Duration::from_millis(1300));
            stop.store(true, Ordering::SeqCst);
            let r = t.join().unwrap_or_else(|_| Err("falhou".into()));
            let p = *lock(&peak);
            match r {
                Ok(f) if p > 0.003 => push("Som do PC", true, format!("{} Hz · {} canais · pico {:.0}%", f.rate, f.channels, p * 100.0)),
                Ok(f) => push(
                    "Som do PC",
                    false,
                    format!("Nada captado ({} Hz, {} canais). Confira se o som do jogo sai pelo dispositivo padrão do Windows e se não está no mudo.", f.rate, f.channels),
                ),
                Err(e) => push("Som do PC", false, e),
            }
        } else {
            push("Som do PC", true, "desligado nas opções".into());
        }

        // Microfone
        if s.mic.is_empty() {
            push("Microfone", true, "sem microfone".into());
        } else {
            let wav = dir.join("mic.wav");
            let mut cmd = command(&exe);
            cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-f", "dshow", "-i"])
                .arg(format!("audio={}", s.mic))
                .args(["-t", "1.5", "-ac", "1", "-ar", "16000", "-f", "wav"])
                .arg(&wav);
            let (ok, err) = run_with_timeout(cmd, Duration::from_secs(10));
            let bytes = std::fs::read(&wav).unwrap_or_default();
            let _ = std::fs::remove_file(&wav);
            let p = goat_core::loopback::peak(&goat_core::loopback::i16_to_f32(bytes.get(44..).unwrap_or(&[])));
            if ok {
                push("Microfone", true, format!("{} · pico {:.0}%", s.mic, p * 100.0));
            } else {
                push("Microfone", false, rc::error_tail(&err).unwrap_or_else(|| "não abriu".into()));
            }
        }
        // Gravação completa: grava 5 s como o replay (vídeo + som do PC, com
        // bipes) e confere o arquivo: ritmo dos quadros e se o som entrou.
        if let Some(p) = lock(&self.inner).pipeline.map(|(p, _)| p).or(p) {
            let tdir = dir.join("teste");
            let _ = std::fs::remove_dir_all(&tdir);
            let _ = std::fs::create_dir_all(&tdir);
            #[cfg(windows)]
            let fmt = if s.system_audio { audio::format() } else { None };
            #[cfg(not(windows))]
            let fmt: Option<rc::AudioFormat> = None;
            let spec = rc::CaptureSpec {
                pipeline: p,
                width: w,
                height: h,
                fps: s.fps,
                bitrate_kbps: rc::bitrate_kbps(w, h, s.fps, s.quality),
                output_idx: idx,
            hmonitor: hmon,
                system_audio: fmt,
                mic: None,
                segment_dir: tdir.to_string_lossy().into_owned(),
                separate_tracks: false,
                start_number: 0,
            };
            let mut cmd = command(&exe);
            cmd.args(rc::capture_args(&spec))
                .stdin(if fmt.is_some() { Stdio::piped() } else { Stdio::null() })
                .stdout(Stdio::null())
                .stderr(std::fs::File::create(tdir.join("ffmpeg.log")).map(Stdio::from).unwrap_or(Stdio::null()));
            match cmd.spawn() {
                Err(e) => push("Gravação completa", false, e.to_string()),
                Ok(mut child) => {
                    rc::tie_to_app(&child);
                    let prio = rc::boost_priority(&child);
                    #[cfg(windows)]
                    let feed = match (fmt, child.stdin.take()) {
                        (Some(f), Some(stdin)) => Some(audio::Loopback::start(stdin, f)),
                        _ => None,
                    };
                    for k in 0..3 {
                        std::thread::sleep(Duration::from_millis(if k == 0 { 1800 } else { 1300 }));
                        goat_core::clips::play_beep();
                    }
                    std::thread::sleep(Duration::from_millis(900));
                    let test_mem = rc::process_memory_mb(&child);
                    #[cfg(windows)]
                    drop(feed);
                    std::thread::sleep(Duration::from_millis(300));
                    let _ = child.kill();
                    let _ = child.wait();
                    let mut names: Vec<_> = std::fs::read_dir(&tdir)
                        .into_iter()
                        .flatten()
                        .flatten()
                        .map(|e| e.path())
                        .filter(|p| p.extension().map(|x| x == "ts").unwrap_or(false))
                        .collect();
                    names.sort();
                    let mut bytes = Vec::new();
                    for n in &names {
                        bytes.extend(std::fs::read(n).unwrap_or_default());
                    }
                    let joined = tdir.join("tudo.ts");
                    let _ = std::fs::write(&joined, &bytes);
                    let (pts, has_audio) = rc::ts_scan(&bytes);
                    let pacing = rc::frame_pacing(&pts, s.fps);
                    let log = std::fs::read_to_string(tdir.join("ffmpeg.log")).unwrap_or_default();
                    let video = match pacing {
                        Some((f, off)) => {
                            let ok = off <= 10.0 && f >= s.fps as f32 * 0.9;
                            push(
                                "Ritmo do vídeo",
                                ok,
                                format!(
                                    "{f:.1} fps de {} · {off:.0}% dos quadros fora do ritmo · prioridade de GPU {}{}",
                                    s.fps,
                                    prio.unwrap_or("normal"),
                                    if ok { "" } else { " · o vídeo vai parecer travado" }
                                ),
                            );
                            true
                        }
                        None => {
                            push("Ritmo do vídeo", false, rc::error_tail(&log).unwrap_or_else(|| "a gravação de teste não gerou vídeo".into()));
                            false
                        }
                    };
                    if fmt.is_some() && video {
                        let wav = tdir.join("som.wav");
                        let mut c = command(&exe);
                        c.args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
                            .arg(&joined)
                            .args(["-vn", "-ac", "1", "-ar", "16000", "-f", "wav"])
                            .arg(&wav);
                        let _ = run_with_timeout(c, Duration::from_secs(20));
                        let wb = std::fs::read(&wav).unwrap_or_default();
                        let pk = goat_core::loopback::peak(&goat_core::loopback::i16_to_f32(wb.get(44..).unwrap_or(&[])));
                        let secs = wb.len().saturating_sub(44) as f32 / 32_000.0;
                        if has_audio && pk > 0.003 {
                            push("Som do PC no clipe", true, format!("{secs:.1} s de som no arquivo · pico {:.0}%", pk * 100.0));
                        } else if has_audio {
                            push("Som do PC no clipe", false, format!("a faixa de som existe ({secs:.1} s) mas veio muda: o bipe não entrou na gravação"));
                        } else {
                            push("Som do PC no clipe", false, "o arquivo saiu sem faixa de som".into());
                        }
                    }
                    if let Some(mb) = test_mem {
                        push("Memória da gravação", mb <= rc::MEMORY_LIMIT_MB, format!("{mb} MB depois de 5 s gravando"));
                    }
                    let _ = std::fs::remove_dir_all(&tdir);
                }
            }
        }
        // Gravador do replay que já estava rodando.
        let (live_mem, restarts) = {
            let g = lock(&self.inner);
            (g.memory_mb, g.memory_restarts)
        };
        if let Some(mb) = live_mem {
            push(
                "Memória do replay",
                mb <= rc::MEMORY_LIMIT_MB && restarts == 0,
                if restarts > 0 {
                    format!("{mb} MB agora; passou de {} MB e foi reiniciado {restarts} vez(es) nesta sessão", rc::MEMORY_LIMIT_MB)
                } else {
                    format!("{mb} MB")
                },
            );
        }

        // Fluidez: quadros repetidos no clipe mais recente.
        match latest_clip(&self.folder()) {
            None => push("Fluidez", true, "grave um clipe jogando e teste de novo para medir".into()),
            Some(clip) => {
                let raw = dir.join("fluidez.raw");
                let _ = std::fs::remove_file(&raw);
                let mut cmd = command(&exe);
                cmd.args(rc::smoothness_args(&clip.to_string_lossy(), &raw.to_string_lossy()));
                let (ok, err) = run_with_timeout(cmd, Duration::from_secs(90));
                let bytes = std::fs::read(&raw).unwrap_or_default();
                let _ = std::fs::remove_file(&raw);
                let (u, total) = rc::count_unique(&bytes);
                let name = clip.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if ok && total > 30 {
                    let pct = (u as f32 / total as f32 * 100.0).round();
                    if pct >= 90.0 {
                        push("Fluidez", true, format!("{pct:.0}% dos quadros diferentes em \"{name}\": liso"));
                    } else {
                        push(
                            "Fluidez",
                            false,
                            format!(
                                "Só {pct:.0}% dos quadros diferentes em \"{name}\" (o resto repetido = travadas). \
                                 Limite o FPS do jogo um pouco acima da taxa do monitor (ex.: 144 Hz → 160) para a placa não ficar em 100%, \
                                 ou grave em 30 fps. Se o clipe foi no menu ou parado, grave jogando e teste de novo."
                            ),
                        )
                    }
                } else {
                    push("Fluidez", false, rc::error_tail(&err).unwrap_or_else(|| format!("não consegui analisar \"{name}\"")))
                }
            }
        }
        let log = std::fs::read_to_string(dir.join("ffmpeg.log")).unwrap_or_default();
        report(items, rc::error_tail(&log).unwrap_or_default())
    }
}

fn report(items: Vec<DiagItem>, log_tail: String) -> DiagReport {
    let mut text = format!("Goat Filter {} — teste de gravação\n", env!("CARGO_PKG_VERSION"));
    for i in &items {
        text.push_str(&format!("{} {}: {}\n", if i.ok { "OK" } else { "FALHOU" }, i.name, i.detail));
    }
    if !log_tail.is_empty() {
        text.push_str(&format!("Último aviso do gravador: {log_tail}\n"));
    }
    DiagReport { items, text }
}

/// Clipe .mp4 mais recente da pasta (e das subpastas diretas).
fn latest_clip(folder: &Path) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let look = |dir: &Path, best: &mut Option<(std::time::SystemTime, PathBuf)>| {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false) {
                if let Ok(m) = e.metadata().and_then(|m| m.modified()) {
                    if best.as_ref().map(|(t, _)| m > *t).unwrap_or(true) {
                        *best = Some((m, p));
                    }
                }
            }
        }
    };
    look(folder, &mut best);
    for e in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            look(&e.path(), &mut best);
        }
    }
    best.map(|(_, p)| p)
}

/// Monitor do jogo: o escolhido (nome GDI) ou o principal.
fn game_monitor(chosen: &Option<String>) -> Option<String> {
    let list = goat_core::monitors::enumerate();
    chosen
        .clone()
        .filter(|id| list.iter().any(|d| &d.id == id))
        .or_else(|| list.iter().find(|d| d.primary).map(|d| d.id.clone()))
}

/// Resolução atual, saída de vídeo (DXGI) e HMONITOR do monitor.
fn monitor_info(gdi: &Option<String>) -> ((u32, u32), (u32, u64)) {
    let size = gdi.as_deref().and_then(goat_core::tweaks::current_size).unwrap_or((1920, 1080));
    let idx = gdi.as_deref().and_then(goat_core::loopback::dxgi_output_index).unwrap_or(0);
    let hmon = gdi.as_deref().and_then(goat_core::loopback::hmonitor_for).unwrap_or(0);
    (size, (idx, hmon))
}

/// Grava 1 s com o caminho e mede o brilho de um quadro. None = não codificou.
fn probe_picture(exe: &Path, dir: &Path, p: Pipeline, scr: (u32, u64), w: u32, h: u32, fps: u32) -> Option<(f32, bool)> {
    let ts = dir.join("probe.ts");
    let raw = dir.join("probe.raw");
    let _ = std::fs::remove_file(&raw);
    let mut cmd = command(exe);
    cmd.args(rc::probe_args(p, scr.0, scr.1, w, h, fps, Some(&ts.to_string_lossy())));
    let (ok, err) = run_with_timeout(cmd, Duration::from_secs(15));
    if !ok {
        log::info!("Gravador: {:?} não funcionou: {}", p, rc::error_tail(&err).unwrap_or_default());
        return None;
    }
    let mut cmd = command(exe);
    cmd.args(rc::frame_check_args(&ts.to_string_lossy(), &raw.to_string_lossy()));
    run_with_timeout(cmd, Duration::from_secs(10));
    let gray = std::fs::read(&raw).unwrap_or_default();
    let _ = std::fs::remove_file(&ts);
    let _ = std::fs::remove_file(&raw);
    Some((rc::brightness(&gray).0, rc::has_picture(&gray)))
}

/// Testa os caminhos do mais leve para o mais pesado e fica com o primeiro que
/// mostra imagem (não só o que codifica: alguns caminhos gravam tela preta).
fn probe(exe: &Path, dir: &Path, scr: (u32, u64), w: u32, h: u32, fps: u32) -> Option<Pipeline> {
    let mut first_ok = None;
    // No Windows 10 o WGC desenha uma borda amarela na tela que não dá para tirar:
    // lá fica o Desktop Duplication.
    let wgc = goat_core::monitors::windows_build() >= 22000;
    for p in rc::PIPELINES.into_iter().filter(|p| wgc || p.source != rc::Source::Wgc) {
        match probe_picture(exe, dir, p, scr, w, h, fps) {
            Some((_, true)) => {
                log::info!("Gravador: usando {:?}", p);
                return Some(p);
            }
            Some((b, false)) => {
                log::info!("Gravador: {:?} gravou imagem escura (brilho {b:.1}); tentando o próximo", p);
                first_ok.get_or_insert(p);
            }
            None => {}
        }
    }
    // A tela pode estar mesmo escura: usa o primeiro que codificou.
    if let Some(p) = first_ok {
        log::info!("Gravador: nenhuma imagem clara; usando {:?}", p);
    }
    first_ok
}

/// Som do PC (o que sai nas caixas/fones), via WASAPI loopback (goat_core::loopback).
#[cfg(windows)]
mod audio {
    use goat_core::recorder::AudioFormat;
    use std::io::Write;
    use std::process::ChildStdin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc::{self, RecvTimeoutError};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    pub fn format() -> Option<AudioFormat> {
        goat_core::loopback::format().map(|f| AudioFormat { rate: f.rate, channels: f.channels })
    }

    pub struct Loopback {
        stop: Arc<AtomicBool>,
        threads: Vec<std::thread::JoinHandle<()>>,
    }

    impl Loopback {
        pub fn start(stdin: ChildStdin, fmt: AudioFormat) -> Self {
            let stop = Arc::new(AtomicBool::new(false));
            // ~20 s de folga: se o FFmpeg demorar para ler, o som espera aqui.
            let (tx, rx) = mpsc::sync_channel::<(Instant, Vec<f32>)>(2048);
            let mut threads = Vec::new();
            // Leitura do som do PC (recomeça se o dispositivo de saída mudar).
            let flag = stop.clone();
            if let Ok(t) = std::thread::Builder::new().name("goat-recorder-loopback".into()).spawn(move || {
                while !flag.load(Ordering::SeqCst) {
                    let r = goat_core::loopback::run(flag.clone(), true, |d| {
                        let _ = tx.try_send((Instant::now(), d.to_vec()));
                        true
                    });
                    match r {
                        Ok(f) if f.rate != fmt.rate || f.channels != fmt.channels => {
                            log::warn!("Som do PC mudou de formato; reinicie a gravação.");
                            break;
                        }
                        Ok(_) => {}
                        Err(e) => {
                            log::warn!("Som do PC indisponível: {e}");
                            std::thread::sleep(Duration::from_secs(2));
                        }
                    }
                }
            }) {
                threads.push(t);
            }
            let flag = stop.clone();
            if let Ok(t) = std::thread::Builder::new().name("goat-recorder-audio".into()).spawn(move || write(stdin, fmt, flag, rx)) {
                threads.push(t);
            }
            Self { stop, threads }
        }
    }

    impl Drop for Loopback {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            for t in self.threads.drain(..) {
                let _ = t.join();
            }
        }
    }

    /// Escreve o som no FFmpeg na ordem em que chega. O silêncio já vem
    /// completado pela leitura (pelo relógio), então aqui não se mexe no tempo:
    /// antes, quando o FFmpeg demorava para ler, este lado inventava silêncio e
    /// jogava fora o som de verdade.
    fn write(mut out: ChildStdin, fmt: AudioFormat, stop: Arc<AtomicBool>, rx: mpsc::Receiver<(Instant, Vec<f32>)>) {
        // Espera o FFmpeg começar a ler (a escrita trava até lá) e descarta o
        // som de antes disso, senão o áudio sai adiantado em relação à imagem.
        // 32 KB (~85 ms de silêncio) passa do buffer do pipe (4 KB), então a
        // escrita só termina quando o FFmpeg lê de verdade.
        let frame = fmt.channels.max(1) as usize * 4;
        let lead = vec![0u8; 32 * 1024 / frame * frame];
        if out.write_all(&lead).is_err() {
            return;
        }
        let ready = Instant::now();
        let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
        while !stop.load(Ordering::SeqCst) {
            match rx.recv_timeout(Duration::from_millis(50)) {
                Ok((at, _)) if at < ready => {}
                Ok((_, samples)) => {
                    buf.clear();
                    for v in samples {
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                    if out.write_all(&buf).is_err() {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    }
}
