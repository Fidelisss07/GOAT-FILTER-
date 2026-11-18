import { useEffect, useRef, useState } from "react";
import { dailyBest, loadResults, streak, trainedToday, TrainMode } from "../lib/trainStats";
import { useT } from "../lib/useT";

const CHART_MODES: { mode: TrainMode; label: string; unit: string }[] = [
  { mode: "flick", label: "Flick", unit: "acertos" },
  { mode: "micro", label: "Micro-flick", unit: "acertos" },
  { mode: "timed", label: "Alvos que somem", unit: "acertos" },
  { mode: "peek", label: "Peek", unit: "acertos" },
  { mode: "tracking", label: "Tracking", unit: "%" },
  { mode: "reaction", label: "Reação", unit: "ms" },
];

/** Sequência de dias e gráfico de evolução (14 dias). */
export function Progress() {
  const t = useT();
  const [list] = useState(loadResults);
  const [mode, setMode] = useState<TrainMode>("flick");
  const days = dailyBest(list, mode);
  const vals = days.filter((d): d is number => d != null);
  const max = Math.max(1, ...vals);
  const min = Math.min(...vals, max);
  const st = streak(list);
  const today = trainedToday(list);
  const unit = CHART_MODES.find((m) => m.mode === mode)!.unit;
  const first = vals[0];
  const last = vals[vals.length - 1];
  const better = vals.length >= 2 && (mode === "reaction" ? last < first : last > first);

  return (
    <div className="progress">
      <div className="streak">
        <span className="flame" aria-hidden>
          🔥
        </span>
        <div>
          <strong>{t("{n} dia(s) seguidos", { n: st })}</strong>
          <span>{today ? t("Treino de hoje feito. Volte amanhã para manter a sequência.") : t("Faça um treino hoje para manter a sequência.")}</span>
        </div>
      </div>
      <div className="seg" role="radiogroup" aria-label={t("Modo")}>
        {CHART_MODES.map((m) => (
          <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} onClick={() => setMode(m.mode)}>
            {t(m.label)}
          </button>
        ))}
      </div>
      {vals.length === 0 ? (
        <p className="note">{t("Ainda não há treinos deste modo nos últimos 14 dias.")}</p>
      ) : (
        <>
          <div className="evo-chart" role="img" aria-label={t("Melhor resultado por dia")}>
            {days.map((v, i) => {
              // Reação: barra maior = mais rápido.
              const h = v == null ? 0 : mode === "reaction" ? 30 + 70 * ((max - v) / Math.max(1, max - min)) : (v / max) * 100;
              return (
                <div key={i} className="bar-col" title={v == null ? "—" : `${v} ${unit}`}>
                  <div className={`bar ${v == null ? "empty" : ""}`} style={{ height: `${v == null ? 3 : Math.max(6, h)}%` }} />
                  <span>{i === days.length - 1 ? t("hoje") : ""}</span>
                </div>
              );
            })}
          </div>
          <p className="note">
            {vals.length >= 2
              ? better
                ? t("Você melhorou: de {a} para {b} {u}.", { a: first, b: last, u: unit === "acertos" ? t("acertos") : unit })
                : t("Primeiro: {a} · último: {b} {u}. Constância é o que mais ajuda.", { a: first, b: last, u: unit === "acertos" ? t("acertos") : unit })
              : t("Treine em outros dias para ver a evolução.")}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Calculadora de DPI: trava o cursor e conta a contagem bruta do mouse
 * (unadjustedMovement) enquanto a pessoa arrasta uma distância conhecida.
 */
export function DpiCalc() {
  const t = useT();
  const area = useRef<HTMLDivElement>(null);
  const [cm, setCm] = useState(10);
  const [counts, setCounts] = useState(0);
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const acc = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== area.current) return;
      acc.current += Math.abs(e.movementX);
      setCounts(acc.current);
    };
    const onLock = () => {
      const on = document.pointerLockElement === area.current;
      setActive(on);
      if (!on && acc.current > 0) setResult(Math.round(acc.current / (cm / 2.54)));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerlockchange", onLock);
    };
  }, [cm]);

  const start = async () => {
    acc.current = 0;
    setCounts(0);
    setResult(null);
    const el = area.current as (HTMLDivElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void }) | null;
    try {
      await el?.requestPointerLock({ unadjustedMovement: true });
    } catch {
      await el?.requestPointerLock();
    }
  };

  return (
    <div className="quick">
      <div className="row">
        <span>{t("Distância na régua")}</span>
        <div className="seg" role="radiogroup" aria-label={t("Distância na régua")}>
          {[5, 10, 20].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cm === c} disabled={active} onClick={() => setCm(c)}>
              {c} cm
            </button>
          ))}
        </div>
      </div>
      <div ref={area} className={`poll-area dpi-area ${active ? "on" : ""}`} onClick={() => !active && start()} role="button" tabIndex={0}>
        {active ? (
          <>
            <strong>{counts}</strong>
            <span>{t("Arraste o mouse {cm} cm para a direita e aperte Esc", { cm })}</span>
          </>
        ) : result != null ? (
          <>
            <strong>{t("{n} DPI", { n: result })}</strong>
            <span>{t("Clique para medir de novo")}</span>
          </>
        ) : (
          <span>{t("Coloque uma régua do lado do mouse, clique aqui e arraste {cm} cm", { cm })}</span>
        )}
      </div>
      <p className="note">{t("Mede a contagem real do sensor. Repita 2 ou 3 vezes; o valor certo costuma ser 400, 800, 1600…")}</p>
    </div>
  );
}

/** Pontos escondidos em cenas escuras: quantos você enxerga com o filtro atual. */
const SPOTS = [
  { x: 14, y: 30, c: 26 },
  { x: 33, y: 70, c: 22 },
  { x: 52, y: 38, c: 18 },
  { x: 70, y: 66, c: 14 },
  { x: 86, y: 28, c: 11 },
  { x: 24, y: 52, c: 8 },
  { x: 62, y: 18, c: 6 },
  { x: 92, y: 78, c: 4 },
];

export function VisibilityTest() {
  const t = useT();
  const [found, setFound] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  return (
    <div className="quick">
      <p className="meta">{t("Há 8 silhuetas nas sombras, cada uma mais difícil. Clique nas que você enxergar. O teste usa as cores reais da sua tela, com o filtro ligado.")}</p>
      <div className="vis-scene" aria-label={t("Cena escura")}>
        {SPOTS.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`vis-spot ${found.includes(i) ? "found" : ""} ${done ? "show" : ""}`}
            aria-label={t("Silhueta {n}", { n: i + 1 })}
            style={{ left: `${p.x}%`, top: `${p.y}%`, ["--c" as string]: `${p.c}` }}
            onClick={() => !done && setFound((f) => (f.includes(i) ? f : [...f, i]))}
          />
        ))}
      </div>
      <div className="save-row">
        <span className="meta">{t("Achou {n} de 8", { n: found.length })}</span>
        <button
          type="button"
          className="btn small"
          onClick={() => {
            if (done) {
              setFound([]);
              setDone(false);
            } else setDone(true);
          }}
        >
          {done ? t("De novo") : t("Mostrar todas")}
        </button>
      </div>
      {done && (
        <p className="note">
          {found.length >= 6
            ? t("Ótima visibilidade nas sombras.")
            : t("Tente subir a vibrância ou o Realce/Gama no perfil e faça de novo.")}
        </p>
      )}
    </div>
  );
}
