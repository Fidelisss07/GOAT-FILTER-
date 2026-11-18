import { MouseEvent, useEffect, useRef, useState } from "react";
import { best, loadResults, saveResult, TrainResult } from "../lib/trainStats";
import { useT } from "../lib/useT";

type Mode = "flick" | "micro" | "timed" | "peek" | "tracking";
const ROUND_MS = 30_000;
const SIZES = { large: 42, medium: 30, small: 20 } as const;
type Size = keyof typeof SIZES;
/** Alvos que somem: tempo para clicar. */
const TIMED_MS = 900;
/** Peek: tempo entrando pela borda e tempo parado antes de sumir. */
const PEEK_SLIDE_MS = 320;
const PEEK_STAY_MS = 650;

const MODE_LABEL: Record<Mode, string> = {
  flick: "Flick",
  micro: "Micro-flick",
  timed: "Alvos que somem",
  peek: "Peek",
  tracking: "Tracking",
};

const MODE_HELP: Record<Mode, string> = {
  flick: "Clique nos alvos o mais rápido que puder. 30 segundos.",
  micro: "Alvos pequenos perto do centro, como ajustes finos de mira. 30 segundos.",
  timed: "Cada alvo some em menos de 1 segundo. Errar ou deixar sumir conta como erro.",
  peek: "O alvo entra pela borda como um inimigo saindo da parede. Clique antes que ele volte.",
  tracking: "Mantenha o cursor em cima do alvo enquanto ele se move. 30 segundos.",
};

interface Live {
  hits: number;
  misses: number;
  spawnAt: number;
  times: number[];
  onFrames: number;
  frames: number;
  /** Peek: de que lado o alvo entra (-1 esquerda, 1 direita) e a altura. */
  side: number;
  peekY: number;
}

/**
 * Treino de mira dentro do app (fora do jogo).
 * - Flick: clique nos alvos que aparecem; conta acertos, precisão e tempo médio.
 * - Tracking: mantenha o cursor sobre o alvo que se move; conta o % do tempo no alvo.
 */
export function AimTrainer({
  durationMs = ROUND_MS,
  mode: fixedMode,
  onFinish,
  autoStart = false,
}: {
  durationMs?: number;
  mode?: Mode;
  onFinish?(r: TrainResult): void;
  autoStart?: boolean;
}) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(fixedMode ?? "flick");
  const [size, setSize] = useState<Size>("large");
  const TARGET = mode === "micro" ? Math.round(SIZES[size] * 0.7) : SIZES[size];
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(durationMs);
  const [target, setTarget] = useState({ x: 50, y: 50 });
  const [last, setLast] = useState<TrainResult | null>(null);
  const [history, setHistory] = useState<TrainResult[]>(() => loadResults());
  const area = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ hits: 0, misses: 0, spawnAt: 0, times: [], onFrames: 0, frames: 0, side: 1, peekY: 50 });
  const cursor = useRef({ x: -1, y: -1 });
  const startAt = useRef(0);

  const randomSpot = () =>
    mode === "micro"
      ? { x: 50 + (Math.random() - 0.5) * 30, y: 50 + (Math.random() - 0.5) * 30 }
      : { x: 6 + Math.random() * 88, y: 8 + Math.random() * 84 };

  const newPeek = () => {
    live.current.side = Math.random() < 0.5 ? -1 : 1;
    live.current.peekY = 35 + Math.random() * 30;
    live.current.spawnAt = performance.now();
  };

  const finish = () => {
    setRunning(false);
    const l = live.current;
    const r: TrainResult =
      mode !== "tracking"
        ? {
            mode,
            score: l.hits,
            accuracy: l.hits + l.misses ? Math.round((l.hits / (l.hits + l.misses)) * 100) : 0,
            avgMs: l.times.length ? Math.round(l.times.reduce((a, b) => a + b, 0) / l.times.length) : 0,
            at: Date.now(),
          }
        : { mode, score: l.frames ? Math.round((l.onFrames / l.frames) * 100) : 0, at: Date.now() };
    setLast(r);
    setHistory(saveResult(r));
    onFinish?.(r);
  };

  const start = () => {
    live.current = { hits: 0, misses: 0, spawnAt: performance.now(), times: [], onFrames: 0, frames: 0, side: 1, peekY: 50 };
    if (mode === "peek") newPeek();
    startAt.current = performance.now();
    setLeft(durationMs);
    setTarget(randomSpot());
    setLast(null);
    setRunning(true);
  };

  useEffect(() => {
    if (autoStart) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Relógio + movimento do alvo (tracking) + medição de "no alvo".
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const elapsed = now - startAt.current;
      setLeft(Math.max(0, durationMs - elapsed));
      if (elapsed >= durationMs) {
        finish();
        return;
      }
      if (mode === "timed" && now - live.current.spawnAt > TIMED_MS) {
        live.current.misses++;
        live.current.spawnAt = now;
        setTarget(randomSpot());
      }
      if (mode === "peek") {
        const t = now - live.current.spawnAt;
        if (t > PEEK_SLIDE_MS + PEEK_STAY_MS) {
          live.current.misses++;
          newPeek();
        } else {
          const k = Math.min(1, t / PEEK_SLIDE_MS);
          const edge = live.current.side < 0 ? 0 : 100;
          const stop = live.current.side < 0 ? 22 : 78;
          setTarget({ x: edge + (stop - edge) * (1 - (1 - k) * (1 - k)), y: live.current.peekY });
        }
      }
      if (mode === "tracking" && area.current) {
        const s = elapsed / 1000;
        const x = 50 + 38 * Math.sin(s * 0.9) * Math.cos(s * 0.37);
        const y = 50 + 34 * Math.sin(s * 1.3 + 1.1);
        setTarget({ x, y });
        const r = area.current.getBoundingClientRect();
        const tx = r.left + (x / 100) * r.width;
        const ty = r.top + (y / 100) * r.height;
        const d = Math.hypot(cursor.current.x - tx, cursor.current.y - ty);
        live.current.frames++;
        if (d <= TARGET / 2) live.current.onFrames++;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, mode]);

  const onArea = (e: MouseEvent) => {
    if (!running || mode === "tracking") return;
    live.current.misses++;
    e.preventDefault();
  };
  const onHit = (e: MouseEvent) => {
    e.stopPropagation();
    if (!running || mode === "tracking") return;
    const now = performance.now();
    live.current.hits++;
    live.current.times.push(now - live.current.spawnAt);
    live.current.spawnAt = now;
    if (mode === "peek") newPeek();
    else setTarget(randomSpot());
  };

  const record = best(history, mode);

  return (
    <div className="trainer">
      <div className="trainer-bar">
        {!fixedMode && (
          <div className="seg" role="radiogroup" aria-label={t("Modo do treino")}>
            {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={running} onClick={() => setMode(m)}>
                {t(MODE_LABEL[m])}
              </button>
            ))}
          </div>
        )}
        {!fixedMode && (
          <div className="seg" role="radiogroup" aria-label={t("Tamanho do alvo")}>
            {(["large", "medium", "small"] as Size[]).map((z) => (
              <button key={z} type="button" role="radio" aria-checked={size === z} disabled={running} onClick={() => setSize(z)}>
                {z === "large" ? t("Grande") : z === "medium" ? t("Médio") : t("Pequeno")}
              </button>
            ))}
          </div>
        )}
        <span className="trainer-time" aria-live="off">{(left / 1000).toFixed(1)}s</span>
        {running ? (
          <button type="button" className="btn small" onClick={finish}>{t("Parar")}</button>
        ) : (
          <button type="button" className="btn small primary" onClick={start}>{t("Começar")}</button>
        )}
      </div>

      <div
        ref={area}
        className={`trainer-area ${running ? "on" : ""}`}
        onMouseDown={onArea}
        onMouseMove={(e) => (cursor.current = { x: e.clientX, y: e.clientY })}
        aria-label={t("Área de treino")}
      >
        {running ? (
          <button
            type="button"
            className="target"
            aria-label={t("Alvo")}
            style={{ left: `${target.x}%`, top: `${target.y}%`, width: TARGET, height: TARGET }}
            onMouseDown={onHit}
          />
        ) : (
          <div className="trainer-idle">
            {last ? (
              <ResultView r={last} />
            ) : (
              <p>{t(MODE_HELP[mode])}</p>
            )}
            {record != null && (
              <p className="note">
                {t("Recorde")}: {mode !== "tracking" ? t("{n} acertos", { n: record }) : `${record}%`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResultView({ r }: { r: TrainResult }) {
  const t = useT();
  if (r.mode !== "tracking")
    return (
      <div className="result">
        <strong>{t("{n} acertos", { n: r.score })}</strong>
        <span>{t("Precisão {p}% · {ms} ms por alvo", { p: r.accuracy ?? 0, ms: r.avgMs ?? 0 })}</span>
      </div>
    );
  return (
    <div className="result">
      <strong>{r.score}%</strong>
      <span>{t("do tempo em cima do alvo")}</span>
    </div>
  );
}
