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
}

impl Default for Tuning {
    fn default() -> Self {
        Self { emphasis: EmphasisColor::None, emphasis_strength: 50, brightness: 0, contrast: 100, gamma: 100 }
    }
}

impl Tuning {
    pub fn sanitized(mut self) -> Self {
        self.emphasis_strength = self.emphasis_strength.min(100);
        self.brightness = self.brightness.clamp(-50, 50);
        self.contrast = self.contrast.clamp(50, 150);
        self.gamma = self.gamma.clamp(50, 200);
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeId,
    /// Método preferido para a faixa acima de 100%.
    pub super_method: SuperMethod,
    /// Atalhos globais (Ctrl+Alt+G, Ctrl+Alt+↑/↓).
    pub hotkeys: bool,
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
