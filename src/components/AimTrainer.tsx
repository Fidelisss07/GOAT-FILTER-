import { MouseEvent, useEffect, useRef, useState } from "react";
import { best, loadResults, saveResult, TrainResult } from "../lib/trainStats";
import { useT } from "../lib/useT";

type Mode = "flick" | "tracking";
const ROUND_MS = 30_000;
const TARGET = 42;

interface Live {
  hits: number;
  misses: number;
  spawnAt: number;
  times: number[];
  onFrames: number;
  frames: number;
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
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(durationMs);
  const [target, setTarget] = useState({ x: 50, y: 50 });
  const [last, setLast] = useState<TrainResult | null>(null);
  const [history, setHistory] = useState<TrainResult[]>(() => loadResults());
  const area = useRef<HTMLDivElement>(null);
  const live = useRef<Live>({ hits: 0, misses: 0, spawnAt: 0, times: [], onFrames: 0, frames: 0 });
  const cursor = useRef({ x: -1, y: -1 });
  const startAt = useRef(0);

  const randomSpot = () => ({ x: 6 + Math.random() * 88, y: 8 + Math.random() * 84 });

  const finish = () => {
    setRunning(false);
    const l = live.current;
    const r: TrainResult =
      mode === "flick"
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
    live.current = { hits: 0, misses: 0, spawnAt: performance.now(), times: [], onFrames: 0, frames: 0 };
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
    if (!running || mode !== "flick") return;
    live.current.misses++;
    e.preventDefault();
  };
  const onHit = (e: MouseEvent) => {
    e.stopPropagation();
    if (!running || mode !== "flick") return;
    const now = performance.now();
    live.current.hits++;
    live.current.times.push(now - live.current.spawnAt);
    live.current.spawnAt = now;
    setTarget(randomSpot());
  };

  const record = best(history, mode);

  return (
    <div className="trainer">
      <div className="trainer-bar">
        {!fixedMode && (
          <div className="seg" role="radiogroup" aria-label={t("Modo do treino")}>
            {(["flick", "tracking"] as Mode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={running} onClick={() => setMode(m)}>
                {m === "flick" ? "Flick" : "Tracking"}
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
              <p>
                {mode === "flick"
                  ? t("Clique nos alvos o mais rápido que puder. 30 segundos.")
                  : t("Mantenha o cursor em cima do alvo enquanto ele se move. 30 segundos.")}
              </p>
            )}
            {record != null && (
              <p className="note">
                {t("Recorde")}: {mode === "flick" ? t("{n} acertos", { n: record }) : `${record}%`}
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
  if (r.mode === "flick")
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
