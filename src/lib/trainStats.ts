/** Histórico dos treinos, guardado neste PC (localStorage). */
export type TrainMode = "flick" | "micro" | "timed" | "peek" | "tracking" | "reaction";

export interface TrainResult {
  mode: TrainMode;
  /** Pontuação principal: acertos (flick/micro/timed/peek), % no alvo (tracking) ou ms (reação). */
  score: number;
  accuracy?: number;
  /** Tempo médio por alvo em ms. */
  avgMs?: number;
  at: number;
}

const KEY = "goat-filter:train";
const DAY = 86_400_000;

export function loadResults(): TrainResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TrainResult[]) : [];
  } catch {
    return [];
  }
}

export function saveResult(r: TrainResult): TrainResult[] {
  const list = [r, ...loadResults()].slice(0, 500);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem storage: só não guarda */
  }
  return list;
}

const lowerIsBetter = (mode: TrainMode) => mode === "reaction";

/** Melhor resultado do modo (reação: menor é melhor). */
export function best(list: TrainResult[], mode: TrainMode): number | null {
  const xs = list.filter((r) => r.mode === mode).map((r) => r.score);
  if (!xs.length) return null;
  return lowerIsBetter(mode) ? Math.min(...xs) : Math.max(...xs);
}

/** Dia local (número) de um instante. */
export function dayNumber(t: number, offsetMin = new Date(t).getTimezoneOffset()): number {
  return Math.floor((t - offsetMin * 60_000) / DAY);
}

/** Dias seguidos treinando (hoje ou até ontem conta). */
export function streak(list: TrainResult[], now = Date.now()): number {
  const days = new Set(list.map((r) => dayNumber(r.at)));
  let d = dayNumber(now);
  if (!days.has(d)) d -= 1; // ainda não treinou hoje: a sequência de ontem continua valendo
  let n = 0;
  while (days.has(d)) {
    n += 1;
    d -= 1;
  }
  return n;
}

/** Melhor de cada dia nos últimos `days` dias (null = não treinou). */
export function dailyBest(list: TrainResult[], mode: TrainMode, days = 14, now = Date.now()): (number | null)[] {
  const today = dayNumber(now);
  const out: (number | null)[] = Array(days).fill(null);
  for (const r of list) {
    if (r.mode !== mode) continue;
    const i = days - 1 - (today - dayNumber(r.at));
    if (i < 0 || i >= days) continue;
    const cur = out[i];
    out[i] = cur == null ? r.score : lowerIsBetter(mode) ? Math.min(cur, r.score) : Math.max(cur, r.score);
  }
  return out;
}

/** Treinou hoje? */
export function trainedToday(list: TrainResult[], now = Date.now()): boolean {
  const d = dayNumber(now);
  return list.some((r) => dayNumber(r.at) === d);
}
