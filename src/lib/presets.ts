import { DEFAULT_TUNING, Tuning } from "./types";

export interface Preset {
  id: "competitivo" | "vibrante" | "natural";
  vibrance: number;
  /** Ajustes finos do preset (os controles do monitor não mudam). */
  tuning: Pick<Tuning, "emphasis" | "emphasisStrength" | "brightness" | "contrast" | "gamma">;
}

/**
 * Presets prontos para começar bem:
 * - Competitivo: cores fortes, contorno vermelho realçado e sombras mais claras.
 * - Vibrante: tudo bem saturado (usa a camada Super quando existir).
 * - Natural: um pouco mais de cor que o padrão, sem exagero.
 */
export const PRESETS: Preset[] = [
  { id: "competitivo", vibrance: 90, tuning: { emphasis: "red", emphasisStrength: 60, brightness: 0, contrast: 105, gamma: 120 } },
  { id: "vibrante", vibrance: 140, tuning: { emphasis: "none", emphasisStrength: 50, brightness: 0, contrast: 100, gamma: 100 } },
  { id: "natural", vibrance: 60, tuning: { emphasis: "none", emphasisStrength: 50, brightness: 0, contrast: 100, gamma: 100 } },
];

/** Aplica o preset preservando os controles do monitor e o limite do PC. */
export function applyPreset(p: Preset, current: Tuning, maxVibrance: number): { vibrance: number; tuning: Tuning } {
  return {
    vibrance: Math.min(p.vibrance, maxVibrance),
    tuning: { ...DEFAULT_TUNING, ...current, ...p.tuning },
  };
}

/** Qual preset bate com os valores atuais (para marcar o botão). */
export function matchPreset(vibrance: number, t: Tuning, maxVibrance: number): Preset["id"] | null {
  const hit = PRESETS.find(
    (p) =>
      Math.min(p.vibrance, maxVibrance) === vibrance &&
      (Object.keys(p.tuning) as (keyof Preset["tuning"])[]).every((k) => p.tuning[k] === t[k]),
  );
  return hit?.id ?? null;
}
