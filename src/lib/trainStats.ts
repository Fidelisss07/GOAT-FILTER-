/** Histórico dos treinos, guardado neste PC (localStorage). */
export type TrainMode = "flick" | "tracking" | "reaction";

export interface TrainResult {
  mode: TrainMode;
  /** Pontuação principal: acertos (flick), % no alvo (tracking) ou ms (reação). */
  score: number;
  accuracy?: number;
  /** Tempo médio por alvo em ms (flick). */
  avgMs?: number;
  at: number;
}

const KEY = "goat-filter:train";

export function loadResults(): TrainResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TrainResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResult(r: TrainResult): TrainResult[] {
  const list = [r, ...loadResults()].slice(0, 100);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem storage: só não guarda */
  }
  return list;
}

/** Melhor resultado do modo (reação: menor é melhor). */
export function best(list: TrainResult[], mode: TrainMode): number | null {
  const xs = list.filter((r) => r.mode === mode).map((r) => r.score);
  if (!xs.length) return null;
  return mode === "reaction" ? Math.min(...xs) : Math.max(...xs);
}
