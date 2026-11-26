/**
 * Arena de mira: tudo que cada treino mede, o perfil de habilidades, o elo,
 * o coach (dicas) e a rotina do dia. Tudo fica neste PC (localStorage).
 *
 * Unidades: ângulos em graus, tempos em ms.
 */
import { fittsId } from "./sensFinder";

/** Marca frases para tradução (o teste de i18n procura as chamadas de tr). */
const tr = (s: string) => s;

export type ArenaMode = "flick" | "micro" | "switch" | "tracking" | "peek" | "hold" | "headline" | "preaim";
export type Skill = "flick" | "precision" | "tracking" | "reaction" | "placement" | "consistency";

export const SKILLS: Skill[] = ["flick", "precision", "tracking", "reaction", "placement", "consistency"];

export const SKILL_LABEL: Record<Skill, string> = {
  flick: tr("Flick"),
  precision: tr("Precisão"),
  tracking: tr("Tracking"),
  reaction: tr("Reação"),
  placement: tr("Posição da mira"),
  consistency: tr("Constância"),
};

export const MODE_LABEL: Record<ArenaMode, string> = {
  flick: tr("Flick"),
  micro: tr("Micro-flick"),
  switch: tr("Troca de alvo"),
  tracking: tr("Tracking"),
  peek: tr("Peek de quina"),
  hold: tr("Segurar ângulo"),
  headline: tr("Linha da cabeça"),
  preaim: tr("Mapa: Base Goat"),
};

export const MODE_HELP: Record<ArenaMode, string> = {
  flick: tr("Alvos aparecem em qualquer lugar da tela. Mire e atire o mais rápido que puder."),
  micro: tr("Alvos pequenos perto da mira. Treina os ajustes finos que decidem o duelo."),
  switch: tr("Três alvos ao mesmo tempo. Elimine todos trocando de um para o outro sem parar."),
  tracking: tr("Um inimigo anda de um lado para o outro. Mantenha a mira na cabeça dele."),
  peek: tr("O inimigo sai de trás da parede. Deixe a mira na altura da cabeça e atire antes que ele volte."),
  hold: tr("Segure o ângulo sem mexer. O inimigo passa rápido em algum momento: reaja e acerte."),
  headline: tr("Inimigos aparecem em pontos diferentes. Quanto mais perto da cabeça a sua mira já estiver, melhor."),
  preaim: tr("Entre no bomb A do mapa Base Goat. Você anda sozinho pela rota e para em cada ângulo: deixe a mira onde o inimigo vai estar (pre-aim) e limpe tudo no menor tempo."),
};

/** Que habilidade cada modo treina mais (para a rotina e as dicas). */
export const MODE_SKILL: Record<ArenaMode, Skill> = {
  flick: "flick",
  micro: "precision",
  switch: "flick",
  tracking: "tracking",
  peek: "reaction",
  hold: "reaction",
  headline: "placement",
  preaim: "placement",
};

/** Um alvo (ou inimigo) do treino. */
export interface Shot {
  /** Do aparecimento ao abate. */
  ms: number;
  /** Do aparecimento ao começo do movimento da mira. */
  react: number;
  /** Distância angular inicial até o alvo. */
  angle: number;
  /** Raio angular da área de acerto. */
  size: number;
  /** Passou do alvo antes de acertar. */
  over: boolean;
  /** Paradas antes do alvo seguidas de correção. */
  corr: number;
  /** Tiros errados neste alvo. */
  miss: number;
  /** Acertou a cabeça (null = alvo sem cabeça, como bolinhas). */
  head: boolean | null;
  /** Direção do movimento necessário (graus; +x direita, +y cima). */
  dx: number;
  dy: number;
  /** Distância entre a mira e a cabeça no instante em que o inimigo apareceu. */
  place?: number;
  /** Altura da mira menos a altura da cabeça nesse instante (+ = acima). */
  pitchErr?: number;
  /** Não acertou a tempo. */
  timeout?: boolean;
  /** Instante dentro da sessão (para medir cansaço). */
  t: number;
}

export interface TrackSummary {
  /** Fração do tempo com a mira na cabeça / no corpo. */
  onHead: number;
  onBody: number;
  /** Atraso médio em graus na direção do movimento (+ = atrás do alvo). */
  lag: number;
  /** Distância média até a cabeça. */
  offset: number;
}

export interface ArenaSession {
  id: string;
  mode: ArenaMode;
  at: number;
  dur: number;
  /** Nível de dificuldade usado (0 a 10). */
  level: number;
  sens: number;
  shots: Shot[];
  track?: TrackSummary;
  score: number;
}

// ------------------------------------------------------------------ armazenamento

const KEY = "goat-filter:arena";
const LEVEL_KEY = "goat-filter:arena-level";
const MAX_SESSIONS = 150;
const MAX_SHOTS = 80;

const r1 = (n: number) => Math.round(n * 10) / 10;

function compact(s: Shot): Shot {
  const out: Shot = {
    ms: Math.round(s.ms),
    react: Math.round(s.react),
    angle: r1(s.angle),
    size: Math.round(s.size * 100) / 100,
    over: s.over,
    corr: s.corr,
    miss: s.miss,
    head: s.head,
    dx: r1(s.dx),
    dy: r1(s.dy),
    t: Math.round(s.t),
  };
  if (s.place != null) out.place = r1(s.place);
  if (s.pitchErr != null) out.pitchErr = r1(s.pitchErr);
  if (s.timeout) out.timeout = true;
  return out;
}

export function loadSessions(): ArenaSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as ArenaSession[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveSession(s: ArenaSession): ArenaSession[] {
  const clean = { ...s, shots: s.shots.slice(0, MAX_SHOTS).map(compact) };
  const list = [clean, ...loadSessions()].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem espaço: só não guarda */
  }
  return list;
}

export function loadLevels(): Partial<Record<ArenaMode, number>> {
  try {
    return JSON.parse(localStorage.getItem(LEVEL_KEY) || "{}") ?? {};
  } catch {
    return {};
  }
}

export function saveLevel(mode: ArenaMode, level: number) {
  try {
    localStorage.setItem(LEVEL_KEY, JSON.stringify({ ...loadLevels(), [mode]: level }));
  } catch {
    /* ignora */
  }
}

// ------------------------------------------------------------------ estatística

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function cv(xs: number[]): number | null {
  const m = mean(xs);
  if (m == null || xs.length < 4 || m <= 0) return null;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  return sd / m;
}

/** Mapa linear para 0–100 (`good` vale 100, `bad` vale 0). */
export function scale(v: number, bad: number, good: number): number {
  const k = (v - bad) / (good - bad);
  return Math.round(Math.max(0, Math.min(1, k)) * 100);
}

/** Tempo por "bit" de dificuldade (lei de Fitts). Menor é melhor. */
export const perBit = (s: Shot) => s.ms / (fittsId(s.angle, s.size) + 0.5);

const kills = (shots: Shot[]) => shots.filter((s) => !s.timeout);

export interface SessionStats {
  kills: number;
  shotsFired: number;
  accuracy: number;
  headRate: number | null;
  perBit: number | null;
  react: number | null;
  overRate: number;
  corrRate: number;
  place: number | null;
  pitchErr: number | null;
  cv: number | null;
  /** Tempo do último terço ÷ primeiro terço (>1 = cansou). */
  fatigue: number | null;
  /** Tempo por bit por direção. */
  dir: { left: number | null; right: number | null; up: number | null; down: number | null };
  medianMs: number | null;
}

export function sessionStats(s: Pick<ArenaSession, "shots">): SessionStats {
  const all = s.shots;
  const ok = kills(all);
  const missed = all.reduce((a, x) => a + x.miss, 0);
  const timeouts = all.length - ok.length;
  const fired = ok.length + missed;
  const withHead = ok.filter((x) => x.head != null);
  const thirds = Math.floor(ok.length / 3);
  const early = thirds >= 2 ? mean(ok.slice(0, thirds).map((x) => x.ms)) : null;
  const late = thirds >= 2 ? mean(ok.slice(-thirds).map((x) => x.ms)) : null;
  const dirOf = (f: (x: Shot) => boolean) => median(ok.filter((x) => x.angle > 4 && f(x)).map(perBit));
  const horiz = (x: Shot) => Math.abs(x.dx) >= Math.abs(x.dy);
  const placed = ok.filter((x) => x.place != null);
  return {
    kills: ok.length,
    shotsFired: fired,
    accuracy: ok.length + missed + timeouts ? ok.length / (ok.length + missed + timeouts) : 0,
    headRate: withHead.length ? withHead.filter((x) => x.head).length / withHead.length : null,
    perBit: median(ok.map(perBit)),
    react: median(ok.filter((x) => x.react > 60).map((x) => x.react)),
    overRate: ok.length ? ok.filter((x) => x.over).length / ok.length : 0,
    corrRate: ok.length ? ok.reduce((a, x) => a + x.corr, 0) / ok.length : 0,
    place: median(placed.map((x) => x.place!)),
    pitchErr: mean(placed.filter((x) => x.pitchErr != null).map((x) => x.pitchErr!)),
    cv: cv(ok.map(perBit)),
    fatigue: early && late ? late / early : null,
    dir: {
      left: dirOf((x) => horiz(x) && x.dx < 0),
      right: dirOf((x) => horiz(x) && x.dx > 0),
      up: dirOf((x) => !horiz(x) && x.dy > 0),
      down: dirOf((x) => !horiz(x) && x.dy < 0),
    },
    medianMs: median(ok.map((x) => x.ms)),
  };
}

/** Pontuação da sessão (para recorde): abates rápidos, na cabeça e com precisão. */
export function sessionScore(s: Pick<ArenaSession, "shots" | "track" | "mode">): number {
  if (s.mode === "tracking" && s.track) return Math.round(s.track.onHead * 1000 + s.track.onBody * 300);
  const st = sessionStats(s);
  let pts = 0;
  for (const x of kills(s.shots)) pts += 100 * (x.head ? 1.4 : 1) * Math.min(3, Math.max(0.4, 600 / Math.max(80, x.ms)));
  return Math.round(pts * (0.4 + 0.6 * st.accuracy));
}

// ------------------------------------------------------------------ perfil

export type SkillScores = Record<Skill, number | null>;

export interface AimProfile {
  skills: SkillScores;
  overall: number | null;
  /** Quantas sessões entraram na conta. */
  sessions: number;
  /** Médias usadas nas dicas. */
  agg: Aggregate;
}

export interface Aggregate {
  accuracy: number | null;
  headRate: number | null;
  perBit: number | null;
  react: number | null;
  overRate: number | null;
  corrRate: number | null;
  place: number | null;
  pitchErr: number | null;
  cv: number | null;
  fatigue: number | null;
  onHead: number | null;
  lag: number | null;
  dir: { left: number | null; right: number | null; up: number | null; down: number | null };
}

const DAY = 86_400_000;

/** Média ponderada: sessões mais novas pesam mais. */
function wavg(pairs: [number | null, number][]): number | null {
  let a = 0, w = 0;
  for (const [v, k] of pairs) {
    if (v == null || !Number.isFinite(v)) continue;
    a += v * k;
    w += k;
  }
  return w > 0 ? a / w : null;
}

export function aggregate(sessions: ArenaSession[], now = Date.now(), windowDays = 30, maxN = 30): Aggregate {
  const recent = sessions.filter((s) => now - s.at < windowDays * DAY).slice(0, maxN);
  const rows = recent.map((s, i) => ({ s, st: sessionStats(s), w: Math.pow(0.9, i) }));
  const pick = (f: (r: (typeof rows)[number]) => number | null, modes?: ArenaMode[]) =>
    wavg(rows.filter((r) => !modes || modes.includes(r.s.mode)).map((r) => [f(r), r.w]));
  const click: ArenaMode[] = ["flick", "micro", "switch", "peek", "hold", "headline", "preaim"];
  return {
    accuracy: pick((r) => (r.st.kills ? r.st.accuracy : null), click),
    headRate: pick((r) => r.st.headRate, ["peek", "hold", "headline", "switch", "preaim"]),
    perBit: pick((r) => r.st.perBit, ["flick", "switch", "micro"]),
    react: pick((r) => r.st.react, ["peek", "hold"]),
    overRate: pick((r) => (r.st.kills ? r.st.overRate : null), ["flick", "switch", "micro"]),
    corrRate: pick((r) => (r.st.kills ? r.st.corrRate : null), ["flick", "switch", "micro"]),
    place: pick((r) => r.st.place, ["peek", "headline", "hold", "preaim"]),
    pitchErr: pick((r) => r.st.pitchErr, ["peek", "headline", "hold", "preaim"]),
    cv: pick((r) => r.st.cv, click),
    fatigue: pick((r) => r.st.fatigue, click),
    onHead: pick((r) => r.s.track?.onHead ?? null, ["tracking"]),
    lag: pick((r) => r.s.track?.lag ?? null, ["tracking"]),
    dir: {
      left: pick((r) => r.st.dir.left, ["flick", "switch"]),
      right: pick((r) => r.st.dir.right, ["flick", "switch"]),
      up: pick((r) => r.st.dir.up, ["flick", "switch"]),
      down: pick((r) => r.st.dir.down, ["flick", "switch"]),
    },
  };
}

/**
 * Notas de 0 a 100 por habilidade. `reactionTests` são os resultados (ms) do
 * teste de reação simples, que também contam.
 */
export function buildProfile(sessions: ArenaSession[], reactionTests: number[] = [], now = Date.now()): AimProfile {
  const a = aggregate(sessions, now);
  const reactAll = wavg([
    [a.react, 2],
    // O teste de reação (clique ao ficar verde) é ~60 ms mais rápido que reagir a um inimigo.
    [median(reactionTests.slice(0, 10)) != null ? median(reactionTests.slice(0, 10))! + 60 : null, 1],
  ]);
  const skills: SkillScores = {
    flick: a.perBit == null ? null : scale(a.perBit, 330, 80),
    precision:
      a.accuracy == null ? null : Math.round(0.75 * scale(a.accuracy, 0.5, 0.97) + 0.25 * scale(a.overRate ?? 0.3, 0.6, 0.05)),
    tracking: a.onHead == null ? null : scale(a.onHead, 0.12, 0.72),
    reaction: reactAll == null ? null : scale(reactAll, 430, 190),
    placement:
      a.place == null ? null : Math.round(0.8 * scale(a.place, 9, 0.6) + 0.2 * scale(Math.abs(a.pitchErr ?? 0), 4, 0.3)),
    consistency: a.cv == null ? null : scale(a.cv, 0.75, 0.15),
  };
  const vals = SKILLS.map((k) => skills[k]).filter((v): v is number => v != null);
  const used = sessions.filter((s) => now - s.at < 30 * DAY).length;
  return { skills, overall: vals.length >= 2 ? Math.round(vals.reduce((x, y) => x + y, 0) / vals.length) : null, sessions: used, agg: a };
}

// ------------------------------------------------------------------ elo

export const TIERS = [
  tr("Ferro"),
  tr("Bronze"),
  tr("Prata"),
  tr("Ouro"),
  tr("Platina"),
  tr("Diamante"),
  tr("Ascendente"),
  tr("Imortal"),
  tr("Radiante"),
];

export interface Rank {
  tier: number;
  name: string;
  /** Divisão 1–3 (Radiante não tem). */
  div: number | null;
  /** Progresso até a próxima divisão (0–1). */
  progress: number;
}

export function rankOf(overall: number): Rank {
  const v = Math.max(0, Math.min(100, overall));
  if (v >= 96) return { tier: 8, name: TIERS[8], div: null, progress: 1 };
  const step = Math.floor(v / 4); // 0..23
  return { tier: Math.floor(step / 3), name: TIERS[Math.floor(step / 3)], div: (step % 3) + 1, progress: (v % 4) / 4 };
}

// ------------------------------------------------------------------ dificuldade

/** Próximo nível do modo depois de uma sessão (0–10). Alvo: ~75% de acerto. */
export function nextLevel(level: number, s: ArenaSession): number {
  let up: boolean, down: boolean;
  if (s.mode === "tracking") {
    const h = s.track?.onHead ?? 0;
    up = h > 0.6;
    down = h < 0.3;
  } else {
    const st = sessionStats(s);
    const done = s.shots.length;
    const timeoutRate = done ? s.shots.filter((x) => x.timeout).length / done : 1;
    up = st.accuracy >= 0.82 && timeoutRate < 0.1 && st.kills >= 6;
    down = st.accuracy < 0.6 || timeoutRate > 0.3;
  }
  return Math.max(0, Math.min(10, level + (up ? 1 : down ? -1 : 0)));
}

// ------------------------------------------------------------------ coach

export interface Insight {
  id: string;
  /** "fix" = ponto a corrigir, "good" = elogio/evolução, "tip" = dica geral. */
  kind: "fix" | "good" | "tip";
  text: string;
  vars?: Record<string, string | number>;
  /** Treino recomendado. */
  drill?: ArenaMode;
  /** Abre o teste de sensibilidade. */
  sens?: boolean;
  /** Peso para ordenar (maior primeiro). */
  weight: number;
}

const pct = (x: number) => Math.round(x * 100);

/**
 * Dicas concretas a partir dos números. `prev` é o perfil de 7 dias atrás
 * (para dizer o que melhorou).
 */
export function coach(p: AimProfile, prev?: AimProfile | null): Insight[] {
  const a = p.agg;
  const out: Insight[] = [];
  if (p.sessions === 0) return out;

  if (a.overRate != null && a.overRate > 0.35 && (a.corrRate ?? 0) < a.overRate * 1.5)
    out.push({
      id: "over",
      kind: "fix",
      text: tr("Você passa do alvo em {p}% dos flicks. Sua sensibilidade pode estar alta: refaça o teste de sensibilidade e treine Micro-flick para frear no lugar certo."),
      vars: { p: pct(a.overRate) },
      drill: "micro",
      sens: true,
      weight: 90 + a.overRate * 20,
    });
  else if (a.corrRate != null && a.corrRate > 0.7)
    out.push({
      id: "under",
      kind: "fix",
      text: tr("Você para antes do alvo e corrige em média {n} vez(es) por alvo. Pode ser sensibilidade baixa ou hesitação: confie no primeiro movimento no Flick."),
      vars: { n: (Math.round(a.corrRate * 10) / 10).toFixed(1) },
      drill: "flick",
      sens: true,
      weight: 80 + a.corrRate * 10,
    });

  if (a.pitchErr != null && Math.abs(a.pitchErr) > 1.2)
    out.push({
      id: a.pitchErr < 0 ? "low" : "high",
      kind: "fix",
      text:
        a.pitchErr < 0
          ? tr("Sua mira fica em média {d}° abaixo da cabeça quando o inimigo aparece. Levante a mira: treine Linha da cabeça.")
          : tr("Sua mira fica em média {d}° acima da cabeça quando o inimigo aparece. Abaixe um pouco: treine Linha da cabeça."),
      vars: { d: Math.abs(a.pitchErr).toFixed(1) },
      drill: "headline",
      weight: 85 + Math.abs(a.pitchErr) * 3,
    });

  if (a.headRate != null && a.headRate < 0.45)
    out.push({
      id: "body",
      kind: "fix",
      text: tr("Só {p}% dos seus abates são na cabeça. No Valorant a cabeça mata com 1 tiro: mire mais alto no Peek de quina."),
      vars: { p: pct(a.headRate) },
      drill: "peek",
      weight: 75 + (0.45 - a.headRate) * 60,
    });

  const { left, right, up, down } = a.dir;
  if (left != null && right != null) {
    const slow = left > right ? "left" : "right";
    const diff = Math.abs(left - right) / Math.min(left, right);
    if (diff > 0.15)
      out.push({
        id: "side",
        kind: "fix",
        text:
          slow === "left"
            ? tr("Seus flicks para a esquerda são {p}% mais lentos que para a direita. Faça Flick e Troca de alvo focando nesse lado.")
            : tr("Seus flicks para a direita são {p}% mais lentos que para a esquerda. Faça Flick e Troca de alvo focando nesse lado."),
        vars: { p: Math.round(diff * 100) },
        drill: "switch",
        weight: 60 + diff * 40,
      });
  }
  if (up != null && down != null) {
    const diff = Math.abs(up - down) / Math.min(up, down);
    if (diff > 0.25)
      out.push({
        id: "vert",
        kind: "tip",
        text: up > down ? tr("Você é mais lento mirando para cima. Apoie bem o braço e treine Micro-flick.") : tr("Você é mais lento mirando para baixo. Apoie bem o braço e treine Micro-flick."),
        drill: "micro",
        weight: 40 + diff * 20,
      });
  }

  if (a.react != null && a.react > 320)
    out.push({
      id: "react",
      kind: "fix",
      text: tr("Você leva {ms} ms para reagir quando o inimigo aparece. Treine Segurar ângulo: fique parado, olho no ponto e reaja ao primeiro sinal."),
      vars: { ms: Math.round(a.react) },
      drill: "hold",
      weight: 65 + (a.react - 320) / 5,
    });

  if (a.onHead != null && a.lag != null && a.onHead < 0.45 && a.lag > 0.6)
    out.push({
      id: "lag",
      kind: "fix",
      text: tr("No tracking você fica atrás do inimigo (em média {d}°). Antecipe o movimento e acompanhe as trocas de direção."),
      vars: { d: a.lag.toFixed(1) },
      drill: "tracking",
      weight: 60 + a.lag * 5,
    });

  if (a.fatigue != null && a.fatigue > 1.18)
    out.push({
      id: "fatigue",
      kind: "tip",
      text: tr("No fim dos treinos você fica {p}% mais lento. Sessões curtas com pausa rendem mais que uma longa."),
      vars: { p: Math.round((a.fatigue - 1) * 100) },
      weight: 45,
    });

  if (a.cv != null && a.cv > 0.5)
    out.push({
      id: "cv",
      kind: "tip",
      text: tr("Seus tempos variam muito de um alvo para outro. Mais calma e ritmo constante: precisão primeiro, velocidade depois."),
      drill: "micro",
      weight: 40,
    });

  // O que melhorou na semana.
  if (prev && prev.sessions > 0) {
    let bestK: Skill | null = null;
    let bestD = 0;
    for (const k of SKILLS) {
      const now = p.skills[k], before = prev.skills[k];
      if (now == null || before == null) continue;
      if (now - before > bestD) {
        bestD = now - before;
        bestK = k;
      }
    }
    if (bestK && bestD >= 3)
      out.push({ id: "up", kind: "good", text: tr("Sua {skill} subiu {n} pontos na última semana. Continue assim."), vars: { skill: SKILL_LABEL[bestK], n: bestD }, weight: 50 });
  }

  if (a.headRate != null && a.headRate >= 0.7)
    out.push({ id: "hs", kind: "good", text: tr("{p}% dos seus abates são na cabeça. Excelente."), vars: { p: pct(a.headRate) }, weight: 30 });

  return out.sort((x, y) => y.weight - x.weight);
}

// ------------------------------------------------------------------ rotina

/** Duração padrão de cada treino (o mapa acaba antes, quando a rota é limpa). */
export function modeDuration(mode: ArenaMode): number {
  return mode === "preaim" ? 90_000 : mode === "hold" ? 40_000 : 30_000;
}

export interface RoutineStep {
  mode: ArenaMode;
  /** Duração em ms. */
  dur: number;
}

const SKILL_DRILL: Record<Skill, ArenaMode[]> = {
  flick: ["flick", "switch"],
  precision: ["micro", "flick"],
  tracking: ["tracking", "tracking"],
  reaction: ["hold", "peek"],
  placement: ["preaim", "headline"],
  consistency: ["micro", "switch"],
};

/**
 * Rotina do dia (~4 min): aquecimento, as duas habilidades mais fracas (ou as
 * que ainda não têm nota) e um fechamento de peek, que junta tudo.
 */
export function dailyRoutine(p: AimProfile): RoutineStep[] {
  const ranked = [...SKILLS].sort((x, y) => (p.skills[x] ?? -1) - (p.skills[y] ?? -1));
  const [w1, w2] = ranked;
  const steps: ArenaMode[] = ["flick", SKILL_DRILL[w1][0], SKILL_DRILL[w2][0], SKILL_DRILL[w1][1], "peek"];
  // Evita o mesmo treino duas vezes seguidas.
  const dedup = steps.filter((m, i) => i === 0 || m !== steps[i - 1]);
  return dedup.map((mode) => ({ mode, dur: modeDuration(mode) }));
}

/** Habilidades mais fracas (para mostrar o foco). */
export function weakest(p: AimProfile, n = 2): Skill[] {
  return SKILLS.filter((k) => p.skills[k] != null)
    .sort((x, y) => p.skills[x]! - p.skills[y]!)
    .slice(0, n);
}

/** Recorde de pontuação do modo. */
export function bestScore(list: ArenaSession[], mode: ArenaMode): number | null {
  const xs = list.filter((s) => s.mode === mode).map((s) => s.score);
  return xs.length ? Math.max(...xs) : null;
}

/** Overall de cada dia (últimos `days`), usando o perfil até aquele dia. */
export function overallHistory(list: ArenaSession[], days = 14, now = Date.now()): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const end = now - i * DAY;
    const has = list.some((s) => s.at <= end && end - s.at < DAY);
    if (!has) {
      out.push(null);
      continue;
    }
    out.push(buildProfile(list.filter((s) => s.at <= end), [], end).overall);
  }
  return out;
}
