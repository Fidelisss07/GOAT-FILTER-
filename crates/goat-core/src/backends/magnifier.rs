//! Camada Super: matriz de cor de tela cheia via Magnification API do Windows
//! (`MagSetFullscreenColorEffect`). Funciona com qualquer GPU (NVIDIA, AMD,
//! Intel), no Windows 10 e 11.
//!
//! Segurança: o efeito pertence a este processo. Se o Goat Filter fechar ou
//! travar, o Windows remove o efeito sozinho — a tela nunca fica "presa".
//!
//! Limitação: é aplicado pela composição do Windows (DWM). Funciona com o jogo
//! em "Janela em tela cheia"; em tela cheia exclusiva pode não aparecer.

use super::{combined_factor, saturation_matrix, BackendError, Result, SuperLayer};
use std::collections::BTreeMap;
use crate::types::SuperMethod;
use std::sync::mpsc::{channel, Sender};
use std::thread;
use windows::Win32::UI::Magnification::{
    MagInitialize, MagSetFullscreenColorEffect, MagUninitialize, MAGCOLOREFFECT,
};

enum Cmd {
    Set(f32, Sender<Result<()>>),
    Quit,
}

pub struct Magnifier {
    tx: Sender<Cmd>,
    last: f32,
}

impl Magnifier {
    /// A API exige que tudo rode na mesma thread que chamou `MagInitialize`.
    pub fn start() -> std::result::Result<Self, String> {
        let (tx, rx) = channel::<Cmd>();
        let (ready_tx, ready_rx) = channel::<std::result::Result<(), String>>();
        thread::Builder::new()
            .name("goat-magnifier".into())
            .spawn(move || unsafe {
                if !MagInitialize().as_bool() {
                    let _ = ready_tx.send(Err("MagInitialize falhou".into()));
                    return;
                }
                let _ = ready_tx.send(Ok(()));
                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        Cmd::Set(f, reply) => {
                            let fx = MAGCOLOREFFECT { transform: flatten(saturation_matrix(f)) };
                            let ok = MagSetFullscreenColorEffect(&fx).as_bool();
                            let _ = reply.send(if ok {
                                Ok(())
                            } else {
                                Err(BackendError::Driver("o Windows recusou a matriz de cor (a Lupa está aberta?)".into()))
                            });
                        }
                        Cmd::Quit => break,
                    }
                }
                let id = MAGCOLOREFFECT { transform: flatten(saturation_matrix(1.0)) };
                let _ = MagSetFullscreenColorEffect(&id);
                let _ = MagUninitialize();
            })
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Self { tx, last: 1.0 })
    }
}

fn flatten(m: [[f32; 5]; 5]) -> [f32; 25] {
    let mut out = [0.0; 25];
    for (i, row) in m.iter().enumerate() {
        out[i * 5..i * 5 + 5].copy_from_slice(row);
    }
    out
}

impl SuperLayer for Magnifier {
    fn method(&self) -> SuperMethod {
        SuperMethod::Magnifier
    }
    fn apply(&mut self, factors: &BTreeMap<String, f32>) -> Result<()> {
        let factor = combined_factor(factors);
        if (factor - self.last).abs() < 1e-4 {
            return Ok(());
        }
        let (rtx, rrx) = channel();
        self.tx
            .send(Cmd::Set(factor, rtx))
            .map_err(|_| BackendError::Driver("thread da camada Super encerrada".into()))?;
        rrx.recv().map_err(|_| BackendError::Driver("sem resposta da camada Super".into()))??;
        self.last = factor;
        Ok(())
    }
}

impl Drop for Magnifier {
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Quit);
    }
}
