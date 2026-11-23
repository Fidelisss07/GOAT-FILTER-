/**
 * Descobre a sensibilidade ideal comparando pares de sensibilidades às cegas
 * (como o método PSA: "Perfect Sensitivity Approximation"), mas medindo o
 * desempenho em vez de só perguntar: tempo até o alvo corrigido pela
 * dificuldade (lei de Fitts), erros de clique, e se a pessoa passa do alvo
 * (sensibilidade alta) ou para antes e corrige (baixa).
 *
 * Tudo aqui é puro (sem tela) para poder ser testado.
 */

/** Graus por contagem do mouse com sensibilidade 1 no Valorant. */
export const VALORANT_YAW = 0.07;
/** Campo de visão horizontal do Valorant. */
export const VALORANT_HFOV = 103;

/** Faixa de sensibilidades que o teste aceita (Valorant). */
export const MIN_SENS = 0.05;
export const MAX_SENS = 3;

/** Quanto cada rodada afasta as duas opções da atual (±). Diminui a cada rodada. */
export const ROUND_WIDTHS = [0.5, 0.32, 0.2, 0.12, 0.07];
/** Alvos por teste. */
export const TARGETS_PER_TEST = 10;

export interface TargetResult {
  /** Tempo do aparecimento ao acerto (ms). Alvo que estourou o tempo conta o limite. */
  ms: number;
  /** Distância angular inicial até o centro do alvo (graus). */
  angle: number;
  /** Raio angular do alvo (graus). */
  size: number;
  /** Passou do alvo antes de acertar. */
  overshoot: boolean;
  /** Paradas no meio do caminho seguidas de correção (parou antes do alvo). */
  corrections: number;
  /** Cliques fora do alvo. */
  misses: number;
  /** Não acertou a tempo. */
  timeout?: boolean;
}

export interface TestScore {
  /** Menor é melhor: tempo normalizado pela dificuldade, com penalidade por erro. */
  score: number;
  /** Mediana do tempo por alvo (ms). */
  medianMs: number;
  overshootRate: number;
  correctionRate: number;
  missRate: number;
}

export const clampSens = (s: number) => Math.min(MAX_SENS, Math.max(MIN_SENS, s));

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Índice de dificuldade de Fitts (bits): log2(distância/largura + 1). */
export function fittsId(angle: number, size: number): number {
  return Math.log2(Math.max(0, angle) / Math.max(0.05, size * 2) + 1);
}

/** Nota de um teste (menor é melhor). */
export function scoreTest(results: TargetResult[]): TestScore {
  const n = Math.max(1, results.length);
  // ms por bit de dificuldade (mais um piso para alvos muito fáceis).
  const perBit = results.map((r) => r.ms / Math.max(1, fittsId(r.angle, r.size) + 0.5));
  const misses = results.reduce((a, r) => a + r.misses, 0);
  const timeouts = results.filter((r) => r.timeout).length;
  const missRate = misses / n;
  const overshootRate = results.filter((r) => r.overshoot).length / n;
  const correctionRate = results.reduce((a, r) => a + r.corrections, 0) / n;
  // Rapidez sozinha favorece sensibilidade alta; passar do alvo e errar o
  // clique também são erros (no jogo custam o duelo), então pesam na nota.
  const score =
    median(perBit) *
    (1 + 0.35 * Math.min(missRate, 2) + 0.6 * (timeouts / n) + 0.3 * overshootRate + 0.12 * Math.min(correctionRate, 3));
  return { score, medianMs: median(results.map((r) => r.ms)), overshootRate, correctionRate, missRate };
}

/** As duas sensibilidades da rodada (A abaixo e B acima, ou o contrário). */
export function roundPair(center: number, round: number, swap: boolean): [number, number] {
  const w = ROUND_WIDTHS[Math.min(round, ROUND_WIDTHS.length - 1)];
  const low = clampSens(center * (1 - w));
  const high = clampSens(center * (1 + w));
  return swap ? [high, low] : [low, high];
}

export type Preference = "a" | "b" | "same" | null;

/**
 * Nova sensibilidade central depois de uma rodada. Quando a diferença medida é
 * clara (>6%), vence a medida; senão vale o que a pessoa sentiu; empate puxa
 * para o meio.
 */
export function nextCenter(center: number, a: number, b: number, sa: TestScore, sb: TestScore, pref: Preference): number {
  const diff = (sb.score - sa.score) / Math.max(1e-6, Math.min(sa.score, sb.score));
  let winner: "a" | "b" | "same";
  if (Math.abs(diff) > 0.06) winner = diff > 0 ? "a" : "b";
  else winner = pref ?? (Math.abs(diff) < 0.02 ? "same" : diff > 0 ? "a" : "b");
  if (winner === "same") return clampSens(center);
  const w = winner === "a" ? a : b;
  // Vitória folgada (>25%): vai até a vencedora, para alcançar quem começou
  // longe da sua. Senão anda 2/3 do caminho (a medida tem ruído).
  const step = Math.abs(diff) > 0.25 ? 1 : 2 / 3;
  return clampSens(center + (w - center) * step);
}

/**
 * Ajuste final pelo jeito de errar: passar muito do alvo pede um pouco menos
 * de sensibilidade; parar antes e corrigir muito pede um pouco mais. No máximo ±6%.
 */
export function balanceAdjust(sens: number, all: TargetResult[]): { sens: number; reason: "overshoot" | "undershoot" | "balanced" } {
  const n = Math.max(1, all.length);
  const over = all.filter((r) => r.overshoot).length / n;
  const corr = all.reduce((a, r) => a + r.corrections, 0) / n;
  if (over > 0.35 && over > corr * 1.5) return { sens: clampSens(sens * (1 - Math.min(0.06, (over - 0.35) * 0.2 + 0.03))), reason: "overshoot" };
  if (corr > 0.6 && corr > over * 1.5) return { sens: clampSens(sens * (1 + Math.min(0.06, (corr - 0.6) * 0.1 + 0.03))), reason: "undershoot" };
  return { sens, reason: "balanced" };
}

/** Arredonda como o Valorant mostra (3 casas). */
export const roundSens = (s: number) => Math.round(s * 1000) / 1000;

/** Graus girados por uma contagem do mouse. */
export const degPerCount = (sens: number) => sens * VALORANT_YAW;

// ---------------------------------------------------------------- alvos

/** Gerador determinístico (os dois testes da rodada recebem os mesmos alvos). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface TargetSpec {
  /** Deslocamento em relação à mira (graus). */
  dyaw: number;
  dpitch: number;
  /** Raio angular (graus). */
  size: number;
}

/**
 * 60% flicks, 40% ajustes curtos (precisão); tamanho de uma cabeça a meia distância.
 * Sempre dentro do campo de visão (±51° na horizontal no Valorant), como um
 * inimigo que aparece na tela.
 */
export function makeTargets(seed: number, n = TARGETS_PER_TEST): TargetSpec[] {
  const r = rng(seed);
  const out: TargetSpec[] = [];
  for (let i = 0; i < n; i++) {
    const micro = r() < 0.4;
    const yaw = micro ? 3 + r() * 8 : 15 + r() * 30;
    const side = r() < 0.5 ? -1 : 1;
    out.push({ dyaw: yaw * side, dpitch: (r() - 0.5) * (micro ? 6 : 20), size: micro ? 0.9 : 1.7 });
  }
  return out;
}

/** Distância angular (graus) entre duas direções (yaw/pitch em graus). */
export function angularDistance(y1: number, p1: number, y2: number, p2: number): number {
  const r = Math.PI / 180;
  const a = [Math.cos(p1 * r) * Math.sin(y1 * r), Math.sin(p1 * r), Math.cos(p1 * r) * Math.cos(y1 * r)];
  const b = [Math.cos(p2 * r) * Math.sin(y2 * r), Math.sin(p2 * r), Math.cos(p2 * r) * Math.cos(y2 * r)];
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot) / r;
}

/**
 * Acompanha um alvo enquanto a mira se move: detecta se passou do alvo
 * (cruzou o centro na direção do movimento por mais que o raio) e quantas
 * vezes parou antes de chegar e corrigiu.
 */
export class Approach {
  private readonly dirYaw: number;
  private readonly dirPitch: number;
  private stoppedSince = -1;
  private stopCounted = false;
  private peak = 0;
  overshoot = false;
  corrections = 0;

  constructor(
    private readonly startYaw: number,
    private readonly startPitch: number,
    private readonly targetYaw: number,
    private readonly targetPitch: number,
    private readonly size: number,
  ) {
    const len = Math.hypot(targetYaw - startYaw, targetPitch - startPitch) || 1;
    this.dirYaw = (targetYaw - startYaw) / len;
    this.dirPitch = (targetPitch - startPitch) / len;
  }

  /** Chamado a cada quadro com a mira atual, a velocidade (graus/s) e o tempo (ms). */
  update(yaw: number, pitch: number, speed: number, now: number) {
    // Posição ao longo da linha mira→alvo: >0 depois do centro do alvo.
    const along = (yaw - this.targetYaw) * this.dirYaw + (pitch - this.targetPitch) * this.dirPitch;
    if (along > this.size * 1.5) this.overshoot = true;
    const dist = Math.hypot(yaw - this.targetYaw, pitch - this.targetPitch);
    this.peak = Math.max(this.peak, speed);
    // "Parou": velocidade abaixo de 15% do pico deste movimento (vale para
    // qualquer pessoa e sensibilidade), ainda longe e antes do alvo.
    if (this.peak > 20 && speed < Math.max(6, this.peak * 0.15) && dist > this.size * 2.2 && along < 0) {
      if (this.stoppedSince < 0) this.stoppedSince = now;
      if (!this.stopCounted && now - this.stoppedSince > 70) {
        // Parou antes do alvo (só conta depois que a pessoa começou a mexer).
        const moved = Math.hypot(yaw - this.startYaw, pitch - this.startPitch);
        if (moved > this.size) {
          this.corrections += 1;
          this.stopCounted = true;
        }
      }
    } else {
      this.stoppedSince = -1;
      this.stopCounted = false;
    }
  }
}

// ---------------------------------------------------------------- perfil

export interface SensEntry {
  at: number;
  /** No jogo da entrada (game). */
  sens: number;
  dpi: number;
  source: "finder" | "manual";
  game?: string;
}

export interface SensProfile {
  /** Jogo em que a pessoa joga; a sensibilidade fica nas unidades dele. */
  game: string;
  dpi: number;
  sens: number;
  /** Valorant: "Multiplicador de sensibilidade da mira de precisão" (Operator, Marshal, Outlaw). */
  scoped: number;
  /** Valorant: "Multiplicador de sensibilidade de mira" (botão direito nos rifles, SMGs, Guardian...). */
  ads: number;
  history: SensEntry[];
}

const KEY = "goat-filter:sens";
export const DEFAULT_PROFILE: SensProfile = { game: "valorant", dpi: 800, sens: 0.35, scoped: 1, ads: 1, history: [] };

export function loadProfile(): SensProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PROFILE, history: [] };
    const p = JSON.parse(raw) as Partial<SensProfile>;
    return {
      game: typeof p.game === "string" ? p.game : "valorant",
      dpi: Number(p.dpi) > 0 ? Number(p.dpi) : DEFAULT_PROFILE.dpi,
      sens: Number(p.sens) > 0 ? Number(p.sens) : DEFAULT_PROFILE.sens,
      scoped: Number(p.scoped) > 0 ? Number(p.scoped) : 1,
      ads: Number(p.ads) > 0 ? Number(p.ads) : 1,
      history: Array.isArray(p.history) ? p.history.slice(0, 50) : [],
    };
  } catch {
    return { ...DEFAULT_PROFILE, history: [] };
  }
}

export function saveProfile(p: SensProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, history: p.history.slice(0, 50) }));
  } catch {
    /* sem storage: só não guarda */
  }
}

// ---------------------------------------------------------------- faixas

export type SensBand = "muito baixa" | "baixa" | "média" | "alta" | "muito alta";

/**
 * Onde o eDPI do Valorant cai. Referência: a maioria dos profissionais fica
 * entre 200 e 400 de eDPI (média perto de 280).
 */
export function band(edpi: number): SensBand {
  if (edpi < 160) return "muito baixa";
  if (edpi < 220) return "baixa";
  if (edpi <= 400) return "média";
  if (edpi <= 560) return "alta";
  return "muito alta";
}

export const PRO_EDPI = { low: 200, avg: 280, high: 400 };
