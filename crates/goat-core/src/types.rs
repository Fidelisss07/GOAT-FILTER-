//! Tipos compartilhados com a interface (mesmos nomes de `src/lib/types.ts`).

use serde::{Deserialize, Serialize};

/// 50% = cores normais (igual ao painel da NVIDIA).
pub const NEUTRAL: u8 = 50;
/// Acima disto o driver não vai; entra a camada Super.
pub const DRIVER_MAX: u8 = 100;
pub const SUPER_MAX: u8 = 200;

pub const VALORANT_ID: &str = "valorant";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeId {
    Rosa,
    Roxo,
    Amarelo,
}

/// Cor do contorno de inimigo a realçar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmphasisColor {
    #[default]
    None,
    Red,
    Yellow,
    Purple,
}

/// Ajustes finos além do vibrance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tuning {
    pub emphasis: EmphasisColor,
    /// 0–100: quanto a mais a cor escolhida ganha (100 = 2×).
    pub emphasis_strength: u8,
    /// −50..50.
    pub brightness: i8,
    /// 50..150 (%).
    pub contrast: u8,
    /// 50..200 (= 0,5..2,0). Acima de 100 clareia sombras.
    pub gamma: u8,
    /// Brilho do próprio monitor via DDC/CI (0–100). None = não mexe.
    pub monitor_brightness: Option<u8>,
    /// Contraste do próprio monitor via DDC/CI (0–100). None = não mexe.
    pub monitor_contrast: Option<u8>,
    /// Saturação do próprio monitor via DDC/CI (0–100), se o modelo aceitar.
    pub monitor_saturation: Option<u8>,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            emphasis: EmphasisColor::None,
            emphasis_strength: 50,
            brightness: 0,
            contrast: 100,
            gamma: 100,
            monitor_brightness: None,
            monitor_contrast: None,
            monitor_saturation: None,
        }
    }
}

impl Tuning {
    pub fn sanitized(mut self) -> Self {
        self.emphasis_strength = self.emphasis_strength.min(100);
        self.brightness = self.brightness.clamp(-50, 50);
        self.contrast = self.contrast.clamp(50, 150);
        self.gamma = self.gamma.clamp(50, 200);
        self.monitor_brightness = self.monitor_brightness.map(|v| v.min(100));
        self.monitor_contrast = self.monitor_contrast.map(|v| v.min(100));
        self.monitor_saturation = self.monitor_saturation.map(|v| v.min(100));
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub vibrance: u8,
    pub apply_on_open: bool,
    pub restore_on_close: bool,
    #[serde(default)]
    pub tuning: Tuning,
    /// Só aplica com o jogo em primeiro plano (alt-tab volta ao normal).
    #[serde(default)]
    pub focus_only: bool,
}

/// Ajustes de entrada e desempenho aplicados enquanto um jogo está aberto.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PerfTweaks {
    /// Desliga "Aprimorar precisão do ponteiro" (aceleração do mouse).
    pub mouse_accel_off: bool,
    /// Atraso de repetição mínimo e velocidade máxima do teclado.
    pub keyboard_fast: bool,
    /// Plano de energia "Alto desempenho".
    pub high_performance_power: bool,
}

/// Código de mira do Valorant salvo pelo usuário.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crosshair {
    pub id: String,
    pub name: String,
    pub code: String,
}

/// Teclas dos atalhos do Goat Filter (formato "Ctrl+Alt+KeyG").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Bindings {
    pub toggle: String,
    pub vibrance_up: String,
    pub vibrance_down: String,
    pub next_profile: String,
    /// Salva os últimos segundos (replay instantâneo).
    pub save_clip: String,
    /// Começa/para a gravação de gameplay.
    pub toggle_record: String,
    /// Marca um momento durante a gravação.
    pub add_marker: String,
}

impl Default for Bindings {
    fn default() -> Self {
        Self {
            toggle: "Ctrl+Alt+KeyG".into(),
            vibrance_up: "Ctrl+Alt+ArrowUp".into(),
            vibrance_down: "Ctrl+Alt+ArrowDown".into(),
            next_profile: "Ctrl+Alt+KeyP".into(),
            save_clip: "Alt+F8".into(),
            toggle_record: "Alt+F7".into(),
            add_marker: String::new(),
        }
    }
}

impl Bindings {
    pub fn all(&self) -> [(&'static str, &str); 7] {
        [
            ("toggle", &self.toggle),
            ("vibranceUp", &self.vibrance_up),
            ("vibranceDown", &self.vibrance_down),
            ("nextProfile", &self.next_profile),
            ("saveClip", &self.save_clip),
            ("toggleRecord", &self.toggle_record),
            ("addMarker", &self.add_marker),
        ]
    }
}

/// Estado atual do sistema (aba Desempenho).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfStatus {
    pub supported: bool,
    /// Aceleração do mouse ligada agora?
    pub mouse_accel: Option<bool>,
    /// 0 (mais curto) a 3.
    pub keyboard_delay: Option<u32>,
    /// 0 a 31 (mais rápido).
    pub keyboard_speed: Option<u32>,
    pub power_high: Option<bool>,
    pub game_mode: Option<bool>,
    /// Os ajustes do Goat Filter estão aplicados agora (jogo aberto).
    pub applied: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeId,
    /// Método preferido para a faixa acima de 100%.
    pub super_method: SuperMethod,
    /// Atalhos globais ligados.
    pub hotkeys: bool,
    pub bindings: Bindings,
    pub perf: PerfTweaks,
    /// Baixa e instala versões novas sozinho (só na versão instalada).
    pub auto_update: bool,
    /// Perfis aplicados em todos os monitores (não só no padrão).
    pub apply_all_monitors: bool,
    /// Aviso do Windows quando um perfil liga/desliga.
    pub notify: bool,
    /// "auto", "pt" ou "en".
    pub language: String,
    /// Apps (nome do .exe) fechados quando um jogo abre.
    pub close_on_game: Vec<String>,
    /// Reabre esses apps quando o jogo fecha.
    pub reopen_apps: bool,
    /// Já passou pela tela de boas-vindas.
    pub onboarded: bool,
    /// Fundo preto puro (telas OLED).
    pub oled: bool,
    /// Aviso quando a GPU passa desta temperatura (°C) com o jogo aberto. 0 = desligado.
    pub temp_alert: u32,
    /// Biblioteca de códigos de mira do Valorant.
    pub crosshairs: Vec<Crosshair>,
    /// Gravação e replay instantâneo.
    pub recorder: crate::recorder::RecorderSettings,
    pub start_with_windows: bool,
    pub minimize_to_tray: bool,
    pub default_monitor: Option<String>,
    pub restore_on_exit: bool,
    pub profiles: Vec<Profile>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeId::Roxo,
            super_method: SuperMethod::Magnifier,
            hotkeys: true,
            bindings: Bindings::default(),
            perf: PerfTweaks::default(),
            auto_update: true,
            apply_all_monitors: false,
            notify: true,
            language: "auto".into(),
            close_on_game: Vec::new(),
            reopen_apps: true,
            onboarded: false,
            oled: false,
            temp_alert: 85,
            crosshairs: Vec::new(),
            recorder: Default::default(),
            start_with_windows: false,
            minimize_to_tray: true,
            default_monitor: None,
            restore_on_exit: true,
            profiles: vec![Profile {
                id: VALORANT_ID.into(),
                name: "Valorant".into(),
                executable: r"C:\Riot Games\VALORANT\live\VALORANT.exe".into(),
                vibrance: 75,
                apply_on_open: true,
                restore_on_close: true,
                tuning: Tuning::default(),
                focus_only: false,
            }],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DriverKind {
    Nvidia,
    Amd,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub primary: bool,
    pub driver: DriverKind,
    pub current: Option<u8>,
    pub driver_default: Option<u8>,
    pub original: Option<u8>,
    /// Ajustes finos em vigor neste monitor.
    pub tuning: Tuning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuperMethod {
    /// Matriz de cor via Magnification API (qualquer GPU, Windows 10/11).
    Magnifier,
    /// Perfil de cor com matriz MHC2 (Windows 11, zero lag, tela cheia).
    Mhc2,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MethodInfo {
    pub method: SuperMethod,
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub demo: bool,
    /// Método em uso agora (None = sem camada Super).
    pub super_method: SuperMethod,
    pub super_reason: Option<String>,
    pub methods: Vec<MethodInfo>,
    /// Brilho/contraste/gama disponíveis (gamma ramp do Windows).
    pub curves: bool,
    /// Controle do monitor por DDC/CI disponível (o modelo ainda pode recusar).
    pub monitor_hw: bool,
}

/// Valores atuais do próprio monitor (0–100). None = o monitor não aceita.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorHwState {
    pub brightness: Option<u8>,
    pub contrast: Option<u8>,
    pub saturation: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameState {
    Idle,
    Active,
    /// Jogo aberto, mas em segundo plano (perfil "só com o jogo em foco").
    Paused,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    pub state: GameState,
    pub profile_id: Option<String>,
    pub message: Option<String>,
}

impl GameStatus {
    pub fn idle() -> Self {
        Self { state: GameState::Idle, profile_id: None, message: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub capabilities: Capabilities,
    pub monitors: Vec<MonitorInfo>,
    pub settings: Settings,
    pub game: GameStatus,
}
