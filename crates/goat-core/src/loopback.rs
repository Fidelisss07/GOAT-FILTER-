//! Som do PC (o que sai nos fones/caixas) direto do WASAPI em modo loopback,
//! lendo por tempo (sem depender do evento do driver, que alguns drivers não
//! disparam em loopback). Entrega amostras f32 intercaladas.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoopFormat {
    pub rate: u32,
    pub channels: u16,
}

/// Pico (0..1) de amostras f32.
pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0f32, |m, v| m.max(v.abs()))
}

/// Converte amostras inteiras de 16 bits para f32.
pub fn i16_to_f32(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect()
}

#[cfg(windows)]
mod win {
    use super::LoopFormat;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED};

    const WAVE_FORMAT_PCM: u16 = 1;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;

    struct Client {
        client: IAudioClient,
        capture: IAudioCaptureClient,
        fmt: LoopFormat,
        float: bool,
        bytes_per_frame: usize,
    }

    unsafe fn open() -> Result<Client, String> {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let dev = en.GetDefaultAudioEndpoint(eRender, eConsole).map_err(|e| format!("sem saída de som: {e}"))?;
        let client: IAudioClient = dev.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
        let mix: *mut WAVEFORMATEX = client.GetMixFormat().map_err(|e| e.to_string())?;
        let w = *mix;
        let tag = w.wFormatTag;
        let bits = w.wBitsPerSample;
        let float = match tag {
            WAVE_FORMAT_IEEE_FLOAT => true,
            WAVE_FORMAT_PCM => false,
            // Formato estendido: no modo compartilhado é float de 32 bits na prática.
            WAVE_FORMAT_EXTENSIBLE => bits == 32,
            _ => bits == 32,
        };
        if !(float || bits == 16) {
            CoTaskMemFree(Some(mix as *const _));
            return Err(format!("formato de som não suportado ({bits} bits)"));
        }
        // 200 ms de buffer (em unidades de 100 ns).
        let r = client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 2_000_000, 0, mix, None);
        let fmt = LoopFormat { rate: w.nSamplesPerSec, channels: w.nChannels };
        let bytes_per_frame = w.nBlockAlign as usize;
        CoTaskMemFree(Some(mix as *const _));
        r.map_err(|e| e.to_string())?;
        let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
        Ok(Client { client, capture, fmt, float, bytes_per_frame })
    }

    /// Formato do som do PC (para avisar o FFmpeg antes de começar).
    pub fn format() -> Option<LoopFormat> {
        unsafe { open().ok().map(|c| c.fmt) }
    }

    /// Lê o som do PC numa thread própria até `stop`. Silêncio vira zeros.
    /// Com `fill_silence`, quando o Windows não entrega nada (PC em silêncio)
    /// completa com zeros pelo relógio, para o som não sair do tempo do vídeo.
    pub fn run(stop: Arc<AtomicBool>, fill_silence: bool, mut on_data: impl FnMut(&[f32]) -> bool) -> Result<LoopFormat, String> {
        unsafe {
            let c = open()?;
            c.client.Start().map_err(|e| e.to_string())?;
            let ch = c.fmt.channels as usize;
            let rate = c.fmt.rate as f64;
            let mut buf: Vec<f32> = Vec::with_capacity(48_000);
            let t0 = std::time::Instant::now();
            let mut last_data = t0;
            let mut frames_out: u64 = 0;
            while !stop.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
                if fill_silence && last_data.elapsed() >= Duration::from_millis(100) {
                    let expected = (t0.elapsed().as_secs_f64() * rate) as u64;
                    let keep = (rate * 0.03) as u64;
                    if expected > frames_out + keep {
                        let n = (expected - frames_out - keep) as usize;
                        buf.clear();
                        buf.resize(n * ch, 0.0);
                        frames_out += n as u64;
                        if !on_data(&buf) {
                            let _ = c.client.Stop();
                            return Ok(c.fmt);
                        }
                    }
                }
                loop {
                    let n = match c.capture.GetNextPacketSize() {
                        Ok(n) => n,
                        Err(_) => return Ok(c.fmt), // dispositivo mudou: quem chamou recomeça
                    };
                    if n == 0 {
                        break;
                    }
                    let mut data = std::ptr::null_mut();
                    let mut frames = 0u32;
                    let mut flags = 0u32;
                    if c.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
                        break;
                    }
                    buf.clear();
                    let count = frames as usize * ch;
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                        buf.resize(count, 0.0);
                    } else if c.float {
                        buf.extend_from_slice(std::slice::from_raw_parts(data as *const f32, count));
                    } else {
                        let bytes = std::slice::from_raw_parts(data, frames as usize * c.bytes_per_frame);
                        buf.extend(super::i16_to_f32(bytes));
                    }
                    let _ = c.capture.ReleaseBuffer(frames);
                    frames_out += frames as u64;
                    last_data = std::time::Instant::now();
                    if !on_data(&buf) {
                        let _ = c.client.Stop();
                        return Ok(c.fmt);
                    }
                }
            }
            let _ = c.client.Stop();
            Ok(c.fmt)
        }
    }
}

#[cfg(windows)]
pub use win::{format, run};

#[cfg(not(windows))]
pub fn format() -> Option<LoopFormat> {
    None
}

#[cfg(not(windows))]
pub fn run(
    _stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    _fill_silence: bool,
    _on_data: impl FnMut(&[f32]) -> bool,
) -> Result<LoopFormat, String> {
    Err("disponível apenas no Windows".into())
}

/// Índice da saída de vídeo (DXGI) do monitor, na placa principal, para o
/// filtro de captura. None se o monitor estiver em outra placa.
#[cfg(windows)]
pub fn dxgi_output_index(gdi: &str) -> Option<u32> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let f: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let adapter = f.EnumAdapters1(0).ok()?;
        let mut i = 0u32;
        while let Ok(out) = adapter.EnumOutputs(i) {
            if let Ok(d) = out.GetDesc() {
                let len = d.DeviceName.iter().position(|&c| c == 0).unwrap_or(d.DeviceName.len());
                if String::from_utf16_lossy(&d.DeviceName[..len]).eq_ignore_ascii_case(gdi) {
                    return Some(i);
                }
            }
            i += 1;
        }
        None
    }
}

#[cfg(not(windows))]
pub fn dxgi_output_index(_gdi: &str) -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pico_e_conversao() {
        assert_eq!(peak(&[0.1, -0.5, 0.2]), 0.5);
        assert_eq!(peak(&[]), 0.0);
        let v = i16_to_f32(&[0x00, 0x40, 0x00, 0xC0]);
        assert!((v[0] - 0.5).abs() < 1e-6 && (v[1] + 0.5).abs() < 1e-6);
    }
}
