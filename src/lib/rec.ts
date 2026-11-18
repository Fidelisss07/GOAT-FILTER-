import { RecQuality } from "./types";

/** Mesmas contas do núcleo (crates/goat-core/src/recorder.rs). */
export function outputSize(screenW: number, screenH: number, maxH: number): [number, number] {
  const even = (v: number) => Math.floor(Math.max(v, 2) / 2) * 2;
  if (screenH <= maxH || screenH === 0) return [even(screenW), even(screenH)];
  const w = Math.floor((screenW * maxH + Math.floor(screenH / 2)) / screenH);
  return [even(w), even(maxH)];
}

export function bitrateKbps(w: number, h: number, fps: number, q: RecQuality): number {
  const base = q === "light" ? 10_000 : q === "balanced" ? 16_000 : 25_000;
  const pixels = (w * h) / (1920 * 1080);
  const motion = Math.max(Math.max(fps, 1) / 60, 0.6);
  return Math.min(Math.max(Math.floor(base * pixels * motion), 2_500), 60_000);
}

/** Tamanho aproximado de um clipe (vídeo + 160 kbit/s de som), em MB. */
export function clipMegabytes(kbps: number, seconds: number): number {
  return Math.round(((kbps + 160) * seconds) / 8 / 1000);
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export function formatClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
