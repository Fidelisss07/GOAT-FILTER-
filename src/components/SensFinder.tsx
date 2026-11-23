import { useEffect, useMemo, useRef, useState } from "react";
import {
  angularDistance,
  Approach,
  balanceAdjust,
  clampSens,
  degPerCount,
  makeTargets,
  nextCenter,
  Preference,
  rng,
  ROUND_WIDTHS,
  roundPair,
  roundSens,
  scoreTest,
  TargetResult,
  TargetSpec,
  TARGETS_PER_TEST,
  TestScore,
  VALORANT_HFOV,
} from "../lib/sensFinder";
import { cmPer360, eDpi, round } from "../lib/sens";
import { useT } from "../lib/useT";

const TIMEOUT_MS = 3000;
const GAP_MS = 220;
const ROUNDS = ROUND_WIDTHS.length;

type Phase = "intro" | "ready" | "running" | "ask" | "done";

export interface FinderResult {
  sens: number;
  start: number;
  reason: "overshoot" | "undershoot" | "balanced";
  rounds: { a: number; b: number; sa: TestScore; sb: TestScore; pref: Preference }[];
  overshootRate: number;
  correctionRate: number;
}

interface Sim {
  yaw: number;
  pitch: number;
  lastYaw: number;
  lastPitch: number;
  lastT: number;
  sens: number;
  targets: TargetSpec[];
  idx: number;
  target: { yaw: number; pitch: number; size: number; angle: number } | null;
  spawnAt: number;
  nextAt: number;
  misses: number;
  approach: Approach | null;
  results: TargetResult[];
  paused: boolean;
}

type LockEl = HTMLCanvasElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };

// ---------------------------------------------------------------- desenho
const R = Math.PI / 180;
function dir(y: number, p: number): [number, number, number] {
  return [Math.cos(p * R) * Math.sin(y * R), Math.sin(p * R), Math.cos(p * R) * Math.cos(y * R)];
}
function project(cy: number, cp: number, ty: number, tp: number, w: number, h: number): { x: number; y: number; z: number } | null {
  const f = dir(cy, cp);
  const r: [number, number, number] = [Math.cos(cy * R), 0, -Math.sin(cy * R)];
  const u: [number, number, number] = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const d = dir(ty, tp);
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= 0.05) return null;
  const x = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  const F = w / 2 / Math.tan((VALORANT_HFOV / 2) * R);
  return { x: w / 2 + (x / z) * F, y: h / 2 - (y / z) * F, z };
}

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, sim: Sim, accent: string) {
  const F = w / 2 / Math.tan((VALORANT_HFOV / 2) * R);
  const horizon = h / 2 + Math.tan(sim.pitch * R) * F;
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, "#1a1530");
  sky.addColorStop(1, "#3a2f5a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#24202c";
  ctx.fillRect(0, Math.min(h, Math.max(0, horizon)), w, h);
  // Pilares a cada 15° para a rotação ser sentida.
  for (let k = 0; k < 24; k++) {
    const yw = k * 15;
    const top = project(sim.yaw, sim.pitch, yw, 22, w, h);
    const bot = project(sim.yaw, sim.pitch, yw, -14, w, h);
    if (!top || !bot) continue;
    const width = Math.max(2, 26 * top.z * (w / 1280));
    ctx.fillStyle = k % 6 === 0 ? "#5b4a86" : "#3b3354";
    ctx.fillRect(top.x - width / 2, top.y, width, bot.y - top.y);
  }
  // Linha do horizonte.
  ctx.strokeStyle = "rgba(255,255,255,.08)";
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(w, horizon);
  ctx.stroke();
  // Alvo.
  const t = sim.target;
  if (t) {
    const c = project(sim.yaw, sim.pitch, t.yaw, t.pitch, w, h);
    if (c) {
      const rad = Math.max(3, (Math.tan(t.size * R) * F) / c.z);
      const g = ctx.createRadialGradient(c.x - rad * 0.3, c.y - rad * 0.3, rad * 0.1, c.x, c.y, rad);
      g.addColorStop(0, "#fff");
      g.addColorStop(0.35, accent);
      g.addColorStop(1, "#7a1d55");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Mira (ciano, como a padrão dos pros).
  ctx.fillStyle = "#4fd6ff";
  const cx = w / 2, cy = h / 2, L = Math.max(4, w / 160), T = Math.max(2, w / 640), O = Math.max(2, w / 400);
  ctx.fillRect(cx + O, cy - T / 2, L, T);
  ctx.fillRect(cx - O - L, cy - T / 2, L, T);
  ctx.fillRect(cx - T / 2, cy + O, T, L);
  ctx.fillRect(cx - T / 2, cy - O - L, T, L);
}

// ---------------------------------------------------------------- componente
/**
 * Descobre a sensibilidade: 5 rodadas, cada uma com duas sensibilidades às
 * cegas (A e B) e os mesmos 10 alvos. Mede, compara e estreita a faixa.
 */
export function SensFinder({ start, dpi, onDone }: { start: number; dpi: number; onDone(r: FinderResult): void }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("intro");
  const [roundNo, setRoundNo] = useState(0);
  const [testNo, setTestNo] = useState(0); // 0 = A, 1 = B
  const [center, setCenter] = useState(start);
  const [scores, setScores] = useState<TestScore[]>([]);
  const [log, setLog] = useState<FinderResult["rounds"]>([]);
  const [all, setAll] = useState<TargetResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<FinderResult | null>(null);
  const seedBase = useMemo(() => Math.floor(Math.random() * 1e9) + 1, []);
  const pair = useMemo(() => roundPair(center, roundNo, rng(seedBase + roundNo)() < 0.5), [center, roundNo, seedBase]);
  const sim = useRef<Sim | null>(null);
  const raf = useRef(0);
  // Só no modo de desenvolvimento: deixa um teste automático jogar o teste.
  if (import.meta.env.DEV) (window as unknown as { __finderSim?: typeof sim }).__finderSim = sim;

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ff48a8";

  // Laço de desenho e das regras do teste.
  useEffect(() => {
    if (phase !== "running") return;
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const color = accent();
    const loop = () => {
      const s = sim.current;
      if (!s) return;
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth * dpr, h = el.clientHeight * dpr;
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const dt = Math.max(1, now - s.lastT);
      const speed = (angularDistance(s.lastYaw, s.lastPitch, s.yaw, s.pitch) / dt) * 1000;
      s.lastYaw = s.yaw;
      s.lastPitch = s.pitch;
      s.lastT = now;
      if (!s.paused) {
        if (!s.target && now >= s.nextAt) spawn(s, now);
        if (s.target) {
          s.approach?.update(s.yaw, s.pitch, speed, now);
          if (now - s.spawnAt > TIMEOUT_MS) finishTarget(s, now, true);
        }
      }
      draw(ctx, w, h, s, color);
      if (s.idx >= s.targets.length && !s.target) {
        endTest(s);
        return;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Mouse: contagens brutas viram graus pela sensibilidade do teste.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = sim.current;
      if (!s || s.paused || document.pointerLockElement !== canvas.current) return;
      const d = degPerCount(s.sens);
      s.yaw += e.movementX * d;
      s.pitch = Math.max(-85, Math.min(85, s.pitch - e.movementY * d));
    };
    const onDown = (e: MouseEvent) => {
      const s = sim.current;
      if (!s || s.paused || e.button !== 0 || document.pointerLockElement !== canvas.current || !s.target) return;
      if (angularDistance(s.yaw, s.pitch, s.target.yaw, s.target.pitch) <= s.target.size) finishTarget(s, performance.now(), false);
      else s.misses += 1;
    };
    const onLock = () => {
      const s = sim.current;
      if (!s) return;
      const locked = document.pointerLockElement === canvas.current;
      if (!locked && s.idx < s.targets.length + (s.target ? 1 : 0)) {
        // Esc no meio: pausa e recomeça o alvo atual depois.
        s.paused = true;
        s.target = null;
        s.idx = Math.max(0, s.idx - (s.approach ? 1 : 0));
        s.approach = null;
        setPaused(true);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("pointerlockchange", onLock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function spawn(s: Sim, now: number) {
    const spec = s.targets[s.idx];
    if (!spec) return;
    const ty = s.yaw + spec.dyaw;
    const tp = Math.max(-30, Math.min(30, s.pitch + spec.dpitch));
    s.target = { yaw: ty, pitch: tp, size: spec.size, angle: angularDistance(s.yaw, s.pitch, ty, tp) };
    s.approach = new Approach(s.yaw, s.pitch, ty, tp, spec.size);
    s.spawnAt = now;
    s.misses = 0;
    s.idx += 1;
  }

  function finishTarget(s: Sim, now: number, timeout: boolean) {
    const tg = s.target;
    if (!tg) return;
    s.results.push({
      ms: timeout ? TIMEOUT_MS : now - s.spawnAt,
      angle: tg.angle,
      size: tg.size,
      overshoot: s.approach?.overshoot ?? false,
      corrections: s.approach?.corrections ?? 0,
      misses: s.misses,
      timeout,
    });
    s.target = null;
    s.approach = null;
    s.nextAt = now + GAP_MS;
    setProgress(s.results.length);
  }

  function endTest(s: Sim) {
    if (document.pointerLockElement) document.exitPointerLock();
    const sc = scoreTest(s.results);
    const nextScores = [...scores, sc];
    setAll((x) => [...x, ...s.results]);
    sim.current = null;
    if (testNo === 0) {
      setScores(nextScores);
      setTestNo(1);
      setPhase("ready");
    } else {
      setScores(nextScores);
      setPhase("ask");
    }
  }

  async function lock() {
    const el = canvas.current as LockEl | null;
    try {
      await el?.requestPointerLock({ unadjustedMovement: true });
    } catch {
      await el?.requestPointerLock();
    }
  }

  function begin() {
    const sens = pair[testNo];
    sim.current = {
      yaw: 0,
      pitch: 0,
      lastYaw: 0,
      lastPitch: 0,
      lastT: performance.now(),
      sens,
      // A e B da mesma rodada recebem os mesmos alvos (comparação justa).
      targets: makeTargets(seedBase * 7 + roundNo * 101, TARGETS_PER_TEST),
      idx: 0,
      target: null,
      spawnAt: 0,
      nextAt: performance.now() + 500,
      misses: 0,
      approach: null,
      results: [],
      paused: false,
    };
    setProgress(0);
    setPaused(false);
    setPhase("running");
    void lock();
  }

  function resume() {
    const s = sim.current;
    if (!s) return;
    s.paused = false;
    s.nextAt = performance.now() + 400;
    setPaused(false);
    void lock();
  }

  function answer(pref: Preference) {
    const [a, b] = pair;
    const [sa, sb] = scores;
    const c = nextCenter(center, a, b, sa, sb, pref);
    const entry = { a, b, sa, sb, pref };
    const nextLog = [...log, entry];
    setLog(nextLog);
    setScores([]);
    setTestNo(0);
    if (roundNo + 1 >= ROUNDS) {
      const adj = balanceAdjust(c, all);
      const n = Math.max(1, all.length);
      const r: FinderResult = {
        sens: roundSens(clampSens(adj.sens)),
        start,
        reason: adj.reason,
        rounds: nextLog,
        overshootRate: all.filter((x) => x.overshoot).length / n,
        correctionRate: all.reduce((acc, x) => acc + x.corrections, 0) / n,
      };
      setResult(r);
      if (import.meta.env.DEV) (window as unknown as { __finderResult?: FinderResult }).__finderResult = r;
      setPhase("done");
      onDone(r);
    } else {
      setCenter(c);
      setRoundNo(roundNo + 1);
      setPhase("ready");
    }
  }

  function restart() {
    setPhase("intro");
    setRoundNo(0);
    setTestNo(0);
    setCenter(start);
    setScores([]);
    setLog([]);
    setAll([]);
    setResult(null);
  }

  const letter = testNo === 0 ? "A" : "B";
  const totalTests = ROUNDS * 2;
  const doneTests = roundNo * 2 + testNo;

  return (
    <div className="finder">
      <div className="finder-stage">
        <canvas ref={canvas} className="finder-canvas" aria-label={t("Área do teste de sensibilidade")} />
        {phase === "intro" && (
          <div className="finder-overlay">
            <strong>{t("Descubra sua sensibilidade ideal")}</strong>
            <p>
              {t("São 5 rodadas. Em cada uma você joga dois testes curtos, A e B, com sensibilidades diferentes que você não vê. Acerte os alvos o mais rápido que conseguir, como no jogo.")}
            </p>
            <p>{t("O app mede o tempo, os erros e se você passa do alvo ou para antes dele, e estreita a faixa até achar a sua. Leva uns 3 minutos.")}</p>
            <button type="button" className="btn primary" onClick={() => setPhase("ready")}>{t("Começar")}</button>
          </div>
        )}
        {phase === "ready" && (
          <div className="finder-overlay">
            <span className="finder-step">{t("Rodada {r} de {n}", { r: roundNo + 1, n: ROUNDS })}</span>
            <strong>{t("Teste {x}", { x: letter })}</strong>
            <p>{t("Clique para travar o mouse. 10 alvos: mire e clique em cada um. Esc pausa.")}</p>
            <button type="button" className="btn primary" onClick={begin}>{t("Começar teste {x}", { x: letter })}</button>
          </div>
        )}
        {phase === "running" && paused && (
          <div className="finder-overlay">
            <strong>{t("Pausado")}</strong>
            <button type="button" className="btn primary" onClick={resume}>{t("Continuar")}</button>
          </div>
        )}
        {phase === "running" && !paused && (
          <div className="finder-hud" aria-live="polite">
            {t("Teste {x}", { x: letter })} · {t("alvo {i} de {n}", { i: Math.min(progress + 1, TARGETS_PER_TEST), n: TARGETS_PER_TEST })}
          </div>
        )}
        {phase === "ask" && (
          <div className="finder-overlay">
            <span className="finder-step">{t("Rodada {r} de {n}", { r: roundNo + 1, n: ROUNDS })}</span>
            <strong>{t("Qual pareceu melhor?")}</strong>
            <p>{t("Se a diferença medida for pequena, vale a sua resposta.")}</p>
            <div className="finder-choices">
              <button type="button" className="btn" onClick={() => answer("a")}>{t("Teste A")}</button>
              <button type="button" className="btn" onClick={() => answer("same")}>{t("Iguais")}</button>
              <button type="button" className="btn" onClick={() => answer("b")}>{t("Teste B")}</button>
            </div>
            <button type="button" className="btn link" onClick={() => answer(null)}>{t("Não sei, decide pela medida")}</button>
          </div>
        )}
        {phase === "done" && result && (
          <div className="finder-overlay">
            <span className="finder-step">{t("Resultado")}</span>
            <strong className="finder-big">{result.sens.toFixed(3)}</strong>
            <p>
              {t("Sensibilidade no Valorant com {dpi} DPI · eDPI {e} · {cm} cm por volta de 360°", {
                dpi,
                e: round(eDpi(result.sens, dpi), 0),
                cm: round(cmPer360(result.sens, dpi, "valorant"), 1),
              })}
            </p>
            <p className="note">
              {result.reason === "overshoot"
                ? t("Você passava do alvo com frequência, então o resultado foi ajustado um pouco para baixo.")
                : result.reason === "undershoot"
                  ? t("Você parava antes do alvo e corrigia com frequência, então o resultado foi ajustado um pouco para cima.")
                  : t("Seus erros ficaram equilibrados entre passar do alvo e parar antes.")}
            </p>
            <button type="button" className="btn" onClick={restart}>{t("Fazer de novo")}</button>
          </div>
        )}
      </div>
      <div className="finder-bar" aria-label={t("Progresso do teste")}>
        <i style={{ width: `${(Math.min(doneTests + (phase === "done" ? totalTests : 0), totalTests) / totalTests) * 100}%` }} />
      </div>
    </div>
  );
}
