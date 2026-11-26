import { useMemo, useState } from "react";
import {
  ArenaMode,
  ArenaSession,
  buildProfile,
  coach,
  dailyRoutine,
  modeDuration,
  Insight,
  loadSessions,
  MODE_LABEL,
  overallHistory,
  rankOf,
  RoutineStep,
  SKILL_LABEL,
  SKILLS,
  SkillScores,
  weakest,
} from "../lib/aimStats";
import { loadResults } from "../lib/trainStats";
import { useT } from "../lib/useT";
import { useStore } from "../state/store";
import { AimArena } from "./AimArena";

const DAY = 86_400_000;

/** Gráfico de radar das 6 habilidades. */
export function SkillRadar({ skills, size = 260 }: { skills: SkillScores; size?: number }) {
  const t = useT();
  const c = size / 2;
  const rad = size * 0.34;
  const n = SKILLS.length;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [c + Math.cos(a) * rad * v, c + Math.sin(a) * rad * v] as const;
  };
  const ring = (v: number) => SKILLS.map((_, i) => pt(i, v).join(",")).join(" ");
  const shape = SKILLS.map((k, i) => pt(i, Math.max(0.04, (skills[k] ?? 0) / 100)).join(",")).join(" ");
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t("Habilidades de mira")}>
      <defs>
        <linearGradient id="radar-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--g1, var(--accent))" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--g3, var(--accent))" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon key={v} points={ring(v)} className="radar-ring" />
      ))}
      {SKILLS.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="radar-axis" />;
      })}
      <polygon points={shape} fill="url(#radar-fill)" className="radar-shape" />
      {SKILLS.map((k, i) => {
        const [x, y] = pt(i, 1.28);
        const v = skills[k];
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="radar-label">
            <tspan x={x} dy="-0.5em">{t(SKILL_LABEL[k])}</tspan>
            <tspan x={x} dy="1.2em" className="radar-val">{v == null ? "—" : v}</tspan>
          </text>
        );
      })}
    </svg>
  );
}

/** Lista de dicas do coach. */
export function InsightList({ items, compact = false, onDrill, onSens }: { items: Insight[]; compact?: boolean; onDrill?(m: ArenaMode): void; onSens?(): void }) {
  const t = useT();
  if (!items.length) return null;
  const vars = (i: Insight) => {
    if (!i.vars) return undefined;
    const v = { ...i.vars };
    if (typeof v.skill === "string") v.skill = t(v.skill).toLowerCase();
    return v;
  };
  return (
    <ul className={`insights ${compact ? "compact" : ""}`} aria-label={t("Dicas do coach")}>
      {items.map((i) => (
        <li key={i.id} className={`insight ${i.kind}`}>
          <span className="insight-dot" aria-hidden />
          <p>{t(i.text, vars(i))}</p>
          {!compact && (i.drill || i.sens) && (
            <div className="insight-actions">
              {i.drill && onDrill && (
                <button type="button" className="btn small" onClick={() => onDrill(i.drill!)}>
                  {t("Treinar {m}", { m: t(MODE_LABEL[i.drill]) })}
                </button>
              )}
              {i.sens && onSens && (
                <button type="button" className="btn small" onClick={onSens}>
                  {t("Testar sensibilidade")}
                </button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const t = useT();
  const pts = values.map((v, i) => (v == null ? null : ([i, v] as const))).filter((x): x is readonly [number, number] => x != null);
  if (pts.length < 2) return <p className="note">{t("Treine em dias diferentes para ver a linha de evolução.")}</p>;
  const W = 280, H = 70;
  const xs = (i: number) => (i / (values.length - 1)) * W;
  const lo = Math.min(...pts.map((p) => p[1])) - 3, hi = Math.max(...pts.map((p) => p[1])) + 3;
  const ys = (v: number) => H - ((v - lo) / Math.max(1, hi - lo)) * H;
  const d = pts.map(([i, v], k) => `${k ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`-4 -4 ${W + 8} ${H + 8}`} role="img" aria-label={t("Nota geral nos últimos 14 dias")}>
      <path d={d} className="spark-line" />
      {pts.map(([i, v]) => (
        <circle key={i} cx={xs(i)} cy={ys(v)} r={3} className="spark-dot" />
      ))}
    </svg>
  );
}

type View = { kind: "home" } | { kind: "routine"; steps: RoutineStep[] } | { kind: "drill"; mode: ArenaMode };

/** Painel de mira: elo, radar, dicas do coach, rotina do dia e histórico. */
export function AimDashboard() {
  const t = useT();
  const setPage = useStore((s) => s.setPage);
  const [view, setView] = useState<View>({ kind: "home" });
  const [list, setList] = useState<ArenaSession[]>(loadSessions);
  const reactionTests = useMemo(
    () => loadResults().filter((r) => r.mode === "reaction").map((r) => r.score),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list],
  );
  const now = useMemo(() => Date.now(), [list]);
  const profile = useMemo(() => buildProfile(list, reactionTests, now), [list, reactionTests, now]);
  const prev = useMemo(() => buildProfile(list.filter((s) => s.at < now - 7 * DAY), [], now - 7 * DAY), [list, now]);
  const tips = useMemo(() => coach(profile, prev).slice(0, 4), [profile, prev]);
  const routine = useMemo(() => dailyRoutine(profile), [profile]);
  const history = useMemo(() => overallHistory(list, 14, now), [list, now]);
  const weak = weakest(profile);
  const rank = profile.overall != null ? rankOf(profile.overall) : null;
  const doneToday = list.some((s) => new Date(s.at).toDateString() === new Date(now).toDateString());

  const back = () => {
    setList(loadSessions());
    setView({ kind: "home" });
  };

  if (view.kind === "routine")
    return <AimArena steps={view.steps} title={t("Rotina do dia")} onDone={() => setList(loadSessions())} onExit={back} />;
  if (view.kind === "drill") return <AimArena steps={[{ mode: view.mode, dur: modeDuration(view.mode) }]} title={t(MODE_LABEL[view.mode])} onExit={back} />;

  const totalMin = Math.round(routine.reduce((a, s) => a + s.dur, 0) / 60_000);

  return (
    <div className="aim-dash">
      <div className="aim-top">
        <div className="aim-rank">
          <span className="finder-step">{t("Seu nível de mira")}</span>
          {rank ? (
            <>
              <strong className={`rank-name tier-${rank.tier}`}>
                {t(rank.name)} {rank.div ?? ""}
              </strong>
              <span className="rank-score">{t("{n} de 100", { n: profile.overall! })}</span>
              <div className="rank-bar" aria-hidden>
                <i style={{ width: `${Math.round(rank.progress * 100)}%` }} />
              </div>
            </>
          ) : (
            <>
              <strong className="rank-name">{t("Sem nível ainda")}</strong>
              <span className="rank-score">{t("Faça a rotina do dia para o app medir sua mira.")}</span>
            </>
          )}
          <span className="note">{t("{n} treino(s) nos últimos 30 dias", { n: profile.sessions })}</span>
          {weak.length > 0 && (
            <span className="note">
              {t("Foco agora")}: <em>{weak.map((k) => t(SKILL_LABEL[k])).join(" · ")}</em>
            </span>
          )}
        </div>
        <SkillRadar skills={profile.skills} />
      </div>

      <div className="aim-routine">
        <div>
          <span className="finder-step">{doneToday ? t("Rotina do dia · feita hoje") : t("Rotina do dia")}</span>
          <strong>{t("{n} treinos · ~{m} min", { n: routine.length, m: Math.max(1, totalMin) })}</strong>
          <ol>
            {routine.map((s, i) => (
              <li key={i}>{t(MODE_LABEL[s.mode])}</li>
            ))}
          </ol>
        </div>
        <button type="button" className="btn primary" onClick={() => setView({ kind: "routine", steps: routine })}>
          {t("Começar rotina")}
        </button>
      </div>

      <div className="aim-grid">
        <div>
          <h3>{t("Coach")}</h3>
          {tips.length ? (
            <InsightList items={tips} onDrill={(m) => setView({ kind: "drill", mode: m })} onSens={() => setPage("sensitivity")} />
          ) : (
            <p className="note">{t("Depois de alguns treinos, aqui aparecem dicas sobre o que corrigir na sua mira.")}</p>
          )}
        </div>
        <div>
          <h3>{t("Evolução")}</h3>
          <Spark values={history} />
          <h3>{t("Últimos treinos")}</h3>
          {list.length ? (
            <ul className="recent">
              {list.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <span>{t(MODE_LABEL[s.mode])}</span>
                  <b>{s.score}</b>
                  <time>{new Date(s.at).toLocaleDateString()}</time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">{t("Nenhum treino ainda.")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
