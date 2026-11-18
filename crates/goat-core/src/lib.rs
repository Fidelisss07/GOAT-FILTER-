//! Núcleo do Goat Filter, sem dependência de interface.
//!
//! Regra de ouro: nada aqui toca no processo do jogo. Ajustes passam pelo
//! driver da GPU (NVAPI/ADL) ou pela composição do Windows (Magnification API).

pub mod backends;
pub mod color;
pub mod engine;
pub mod games;
pub mod update;
pub mod monitors;
pub mod perf;
pub mod recorder;
pub mod session;
pub mod tweaks;
pub mod settings;
pub mod types;
pub mod watcher;
