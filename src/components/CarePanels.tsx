import { useEffect, useId, useState } from "react";
import { getNative } from "../lib/native";
import { formatSize } from "../lib/rec";
import { CacheReport, HistoryView, MonitorMode, PerfStatus, WindowsTweaks } from "../lib/types";
import { useT } from "../lib/useT";
import { xrayItems, xrayScore } from "../lib/xray";
import { useStore } from "../state/store";
import { CheckIcon, ChevronDown, SparkIcon } from "./Icons";

/** Itens e nota do Raio-X (lê o PC uma vez e de novo quando os ajustes mudam). */
export function useXray() {
  const settings = useStore((s) => s.settings);
  const [modes, setModes] = useState<MonitorMode[] | null>(null);
  const [tweaks, setTweaks] = useState<WindowsTweaks | null>(null);
  const [perf, setPerf] = useState<PerfStatus | null>(null);
  useEffect(() => {
    void getNative().then(async (n) => {
      setModes(await n.displayModes().catch(() => null));
      setTweaks(await n.windowsTweaks().catch(() => null));
      setPerf(await n.perfStatus().catch(() => null));
    });
  }, [settings.perf, settings.closeOnGame]);
  const items = xrayItems({ modes, tweaks, perf, settings });
  return { items, score: xrayScore(items) };
}

/** Raio-X: nota do PC para jogar, a partir dos ajustes que o app já mede. */
export function XrayPanel() {
  const t = useT();
  const settings = useStore((s) => s.settings);
  const [modes, setModes] = useState<MonitorMode[] | null>(null);
  const [tweaks, setTweaks] = useState<WindowsTweaks | null>(null);
  const [perf, setPerf] = useState<PerfStatus | null>(null);

  useEffect(() => {
    void getNative().then(async (n) => {
      setModes(await n.displayModes().catch(() => null));
      setTweaks(await n.windowsTweaks().catch(() => null));
      setPerf(await n.perfStatus().catch(() => null));
    });
  }, [settings.perf, settings.closeOnGame]);

  const items = xrayItems({ modes, tweaks, perf, settings });
  const score = xrayScore(items);
  const missing = items.filter((i) => i.ok === false);
  const level = score == null ? "" : score >= 85 ? "good" : score >= 60 ? "mid" : "bad";

  return (
    <section className="panel xray" aria-label={t("Raio-X do PC")}>
      <div className="section-head">
        <SparkIcon />
        <h2>{t("Raio-X do PC")}</h2>
      </div>
      <div className="xray-body">
        <div className={`xray-score ${level}`} role="img" aria-label={t("Nota {n} de 100", { n: score ?? 0 })}>
          <strong>{score ?? "—"}</strong>
          <span>/100</span>
        </div>
        <div className="xray-text">
          <p>
            {score == null
              ? t("Abra no Windows para ver a nota.")
              : missing.length === 0
                ? t("Tudo pronto para jogar.")
                : t("Faltam {n} ajuste(s) para o máximo:", { n: missing.length })}
          </p>
          <ul className="xray-list">
            {items.map((i) => (
              <li key={i.id} className={i.ok === true ? "ok" : i.ok === false ? "bad" : "muted"} title={i.ok === false ? t(i.tip) : undefined}>
                {i.ok === true ? <CheckIcon /> : <span className="dot" aria-hidden />}
                {t(i.label)}
                {i.ok === false && <small>{t(i.tip)}</small>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Limpeza de temporários e cache de shaders + aviso de temperatura. */
export function CarePanel() {
  const t = useT();
  const s = useStore();
  const [report, setReport] = useState<CacheReport | null>(null);
  const [busy, setBusy] = useState(false);
  const tempId = useId();

  const scan = (apply: boolean) => {
    setBusy(true);
    getNative()
      .then((n) => n.cleanCaches(apply))
      .then((r) => {
        setReport(apply ? { ...r, groups: [], bytes: 0 } : r);
        if (apply) s.showToast({ kind: "ok", text: t("{size} liberados.", { size: formatSize(r.freed) }) });
      })
      .catch((e) => s.showToast({ kind: "error", text: String(e) }))
      .finally(() => setBusy(false));
  };

  return (
    <section className="panel" aria-label={t("Limpeza e temperatura")}>
      <div className="section-head">
        <SparkIcon />
        <h2>{t("Limpeza e temperatura")}</h2>
      </div>
      <p className="meta">{t("Apaga arquivos temporários e o cache de shaders antigo (o jogo recria o que precisar).")}</p>
      {report && report.groups.length > 0 && (
        <ul className="cache-list">
          {report.groups.map((g) => (
            <li key={g.name}>
              <span>{t(g.name)}</span>
              <span className="meta">{formatSize(g.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {report && report.groups.length === 0 && <p className="note">{t("Nada para limpar agora.")}</p>}
      <div className="save-row">
        <button type="button" className="btn small" disabled={busy} onClick={() => scan(false)}>
          {busy ? t("Medindo…") : t("Ver quanto dá para limpar")}
        </button>
        {report && report.bytes > 0 && (
          <button type="button" className="btn small primary" disabled={busy} onClick={() => scan(true)}>
            {t("Limpar {size}", { size: formatSize(report.bytes) })}
          </button>
        )}
      </div>
      <div className="rows">
        <div className="row">
          <label htmlFor={tempId}>{t("Avisar se a GPU passar de")}</label>
          <div className="select small-select">
            <select id={tempId} value={s.settings.tempAlert} onChange={(e) => s.updateSettings({ tempAlert: Number(e.target.value) })}>
              <option value={0}>{t("Não avisar")}</option>
              {[75, 80, 85, 90].map((c) => (
                <option key={c} value={c}>
                  {c} °C
                </option>
              ))}
            </select>
            <ChevronDown />
          </div>
        </div>
      </div>
      <p className="note">{t("Com o jogo aberto, aparece um aviso do Windows (no máximo 1 a cada 10 min). Temperatura lida em placas NVIDIA.")}</p>
    </section>
  );
}

/** Histórico das partidas da semana. */
export function HistoryPanel() {
  const t = useT();
  const [h, setH] = useState<HistoryView | null>(null);
  useEffect(() => {
    void getNative()
      .then((n) => n.gameHistory())
      .then(setH)
      .catch(() => setH(null));
  }, []);
  if (!h) return null;
  const { summary } = h;
  const max = Math.max(60, ...summary.days);
  const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m} min`);
  const dayLabel = (i: number) => new Date(Date.now() - (6 - i) * 86_400_000).toLocaleDateString(undefined, { weekday: "narrow" });

  return (
    <section className="panel" aria-label={t("Sua semana")}>
      <div className="section-head">
        <SparkIcon />
        <h2>{t("Sua semana")}</h2>
      </div>
      <div className="week-stats">
        <div>
          <strong>{hours(summary.weekMinutes)}</strong>
          <span>{t("jogadas")}</span>
        </div>
        <div>
          <strong>{summary.weekSessions}</strong>
          <span>{t("partidas")}</span>
        </div>
        <div>
          <strong>{summary.weekClips}</strong>
          <span>{t("clipes")}</span>
        </div>
        <div>
          <strong>{summary.weekMaxTemp != null ? `${summary.weekMaxTemp}°C` : "—"}</strong>
          <span>{t("GPU máx.")}</span>
        </div>
      </div>
      <div className="week-bars" role="img" aria-label={t("Minutos por dia")}>
        {summary.days.map((m, i) => (
          <div key={i} className="bar-col" title={hours(m)}>
            <div className="bar" style={{ height: `${Math.max(3, (m / max) * 100)}%` }} />
            <span>{dayLabel(i)}</span>
          </div>
        ))}
      </div>
      {summary.weekSessions === 0 && <p className="note">{t("As partidas aparecem aqui quando você jogar com o Goat Filter aberto.")}</p>}
    </section>
  );
}
