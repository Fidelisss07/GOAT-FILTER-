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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub executable: String,
    pub vibrance: u8,
    pub apply_on_open: bool,
    pub restore_on_close: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeId,
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SuperMethod {
    Magnifier,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub demo: bool,
    pub super_method: SuperMethod,
    pub super_reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameState {
    Idle,
    Active,
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
