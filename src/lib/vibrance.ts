import { DRIVER_MAX, DriverKind, NEUTRAL } from "./types";

/**
 * Fator de saturação aproximado que um valor do Goat Filter representa.
 * Mesma regra do núcleo em Rust (src-tauri/src/engine.rs):
 * - com vibrance de driver: 0–100% fica no driver e só o excedente vira matriz
 *   (100% → 1.0×, 200% → 2.0× a mais);
 * - sem driver: tudo vira matriz (50% → 1.0×, 100% → 1.5×, 200% → 2.5×).
 */
export function matrixFactor(percent: number, driver: DriverKind): number {
  const p = clamp(percent, 0, 200);
  if (driver !== "none") return p <= DRIVER_MAX ? 1 : 1 + (p - DRIVER_MAX) / 100;
  return universalFactor(p);
}

export function universalFactor(p: number): number {
  return p <= NEUTRAL ? p / NEUTRAL : 1 + (p - NEUTRAL) / 100;
}

/**
 * Saturação usada só na prévia ilustrativa (CSS saturate()).
 * Aproxima o que o driver + matriz fazem; não mede o monitor real.
 */
export function previewSaturation(percent: number): number {
  return universalFactor(clamp(percent, 0, 200));
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
