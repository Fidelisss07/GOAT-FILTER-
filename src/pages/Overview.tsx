import { useEffect, useState } from "react";
import { useXray } from "../components/CarePanels";
import { MonitorSelect, ToggleRow } from "../components/Controls";
import { EyeIcon, GamepadIcon } from "../components/Icons";
import { vibranceMax } from "../components/VibranceSlider";
import { VibranceDial } from "../components/VibranceDial";
import { DRIVER_MAX } from "../lib/types";
import { useT } from "../lib/useT";
import { selectedMonitor, useStore, valorantProfile } from "../state/store";

const DRIVER_NAME = { nvidia: "NVIDIA", amd: "AMD", none: "" } as const;

/**
 * Visão geral ("tela viva"): o fundo do app é a cena do jogo e o seletor circular
 * no centro controla o vibrance. Perfil do Valorant e Raio-X ficam em ilhas nos cantos.
 */
export function Overview() {
  const s = useStore();
  const t = useT();
  const monitor = selectedMonitor(s);
  const valorant = valorantProfile(s);
  const caps = s.capabilities;
  const max = vibranceMax(caps);
  const value = Math.min(monitor ? s.edited[monitor.id] ?? 50 : 50, max);

  const hasDriver = monitor?.driver !== undefined && monitor.driver !== "none";
  const hasSuper = caps.superMethod !== "none";
  const canApply = !!monitor && (hasDriver || hasSuper);
  const applied = monitor?.current ?? null;
  const pending = applied === null || applied !== value;

  return (
    <div className="ov">
      <div className="ov-center">
        <VibranceDial
          value={value}
          max={max}
          onChange={s.setEdited}
          label={t("Digital Vibrance")}
          caption={t("Digital Vibrance")}
          superFrom={max > DRIVER_MAX ? DRIVER_MAX : undefined}
          badge={value > DRIVER_MAX ? t("super") : value === 50 ? t("normal") : undefined}
          disabled={!canApply}
        />

        <div className="ov-bar glass">
          <MonitorSelect
            label={t("Monitor")}
            showLabel={false}
            monitors={s.monitors}
            value={s.selectedMonitorId}
            onChange={s.selectMonitor}
          />
          <button className="btn primary" disabled={!canApply || s.busy} onClick={s.apply}>
            {t("Aplicar")}
          </button>
          <button className="btn" disabled={!monitor || s.busy} onClick={s.restore}>
            {t(monitor && monitor.driverDefault == null ? "Restaurar anterior" : "Restaurar padrão")}
          </button>
          <HoldCompare />
        </div>

        <div className="ov-status">
          {monitor && (
            <span className={`pill ${pending ? "" : "accent"}`}>
              <span className="dot" />
              {pending
                ? applied === null
                  ? t("Não aplicado")
                  : t("Aplicado: {v}% · alteração pendente", { v: applied })
                : t("Aplicado: {v}%", { v: applied })}
            </span>
          )}
          <span className="pill">
            {!monitor
              ? t("Nenhum monitor detectado")
              : hasDriver
                ? `Driver ${DRIVER_NAME[monitor.driver]}`
                : hasSuper
                  ? t("Driver sem vibrance — usando a camada Super")
                  : t("Sem ajuste disponível neste monitor")}
          </span>
          {value > DRIVER_MAX && hasSuper && (
            <span className="pill accent">
              {t(caps.superMethod === "mhc2" ? "Super Vibrance · perfil MHC2" : "Super Vibrance · todos os monitores")}
            </span>
          )}
          {!hasSuper && caps.superReason && <span className="pill warn">{t(caps.superReason)}</span>}
        </div>
      </div>

      <section className="glass island ov-valorant" aria-label={t("Perfil do Valorant")}>
        <div className="island-head">
          <span className="badge-ico"><GamepadIcon /></span>
          <h2>{t("Perfil do Valorant")}</h2>
        </div>
        {valorant ? (
          <>
            <div className="rows">
              <ToggleRow label={t("Aplicar ao abrir")} checked={valorant.applyOnOpen} onChange={(v) => s.setValorantFlag("applyOnOpen", v)} />
              <ToggleRow label={t("Restaurar ao fechar")} checked={valorant.restoreOnClose} onChange={(v) => s.setValorantFlag("restoreOnClose", v)} />
            </div>
            {caps.superMethod === "magnifier" && valorant.vibrance > DRIVER_MAX && (
              <p className="note">{t("Acima de 100%: deixe o Valorant em “Janela em tela cheia”.")}</p>
            )}
          </>
        ) : (
          <p className="note">{t("Perfil não encontrado. Crie um na aba Perfis.")}</p>
        )}
      </section>

      <XrayIsland />
    </div>
  );
}

/** Segurar o botão mostra a cena sem cor (o "antes"). */
function HoldCompare() {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (on) root.dataset.compare = "true";
    else delete root.dataset.compare;
    return () => { delete root.dataset.compare; };
  }, [on]);
  return (
    <button
      type="button"
      className="btn icon hold"
      aria-pressed={on}
      title={t("Segure para ver sem o ajuste")}
      aria-label={t("Segure para ver sem o ajuste")}
      onPointerDown={() => setOn(true)}
      onPointerUp={() => setOn(false)}
      onPointerLeave={() => setOn(false)}
      onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") setOn(true); }}
      onKeyUp={() => setOn(false)}
      onBlur={() => setOn(false)}
    >
      <EyeIcon />
    </button>
  );
}

function XrayIsland() {
  const t = useT();
  const setPage = useStore((s) => s.setPage);
  const { items, score } = useXray();
  const missing = items.filter((i) => i.ok === false).length;
  const pct = score ?? 0;
  const C = 2 * Math.PI * 26;
  return (
    <button type="button" className="glass island ov-xray" onClick={() => setPage("performance")} aria-label={t("Raio-X do PC: nota {n} de 100", { n: score ?? 0 })}>
      <svg className="ring" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="26" className="ring-track" />
        <circle cx="32" cy="32" r="26" className="ring-fill" strokeDasharray={`${(C * pct) / 100} ${C}`} />
      </svg>
      <strong className="ring-num" aria-hidden>{score ?? "—"}</strong>
      <span className="ov-xray-text" aria-hidden>
        <b>{t("Raio-X")}</b>
        <small>{score == null ? t("Abra no Windows") : missing === 0 ? t("Pronto para jogar") : t("{n} ajuste(s) a fazer", { n: missing })}</small>
      </span>
    </button>
  );
}
