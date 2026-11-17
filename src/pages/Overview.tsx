import { BeforeAfter } from "../components/BeforeAfter";
import { MonitorSelect, ToggleRow } from "../components/Controls";
import { GamepadIcon, MonitorIcon, SlidersIcon } from "../components/Icons";
import { VibranceSlider, vibranceMax } from "../components/VibranceSlider";
import { DRIVER_MAX } from "../lib/types";
import { previewSaturation } from "../lib/vibrance";
import { useT } from "../lib/useT";
import { selectedMonitor, useStore, valorantProfile } from "../state/store";

const DRIVER_NAME = { nvidia: "NVIDIA", amd: "AMD", none: "" } as const;

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
    <div className="ov-grid">
      <BeforeAfter saturation={previewSaturation(value)} />

      <section className="panel ov-panel" aria-label={t("Ajustes do monitor")}>
        <div className="section">
          <div className="section-head">
            <MonitorIcon />
            <h2>{t("Monitor")}</h2>
          </div>
          <MonitorSelect
            label={t("Monitor")}
            showLabel={false}
            monitors={s.monitors}
            value={s.selectedMonitorId}
            onChange={s.selectMonitor}
          />
          <p className="meta">
            {!monitor
              ? t("Nenhum monitor detectado")
              : hasDriver
                ? `Driver ${DRIVER_NAME[monitor.driver]}`
                : hasSuper
                  ? t("Driver sem vibrance — usando a camada Super")
                  : t("Sem ajuste disponível neste monitor")}
          </p>
        </div>

        <div className="section">
          <div className="section-head">
            <SlidersIcon />
            <h2>{t("Vibrância")}</h2>
            <span className="big-value" aria-live="polite">{value}%</span>
          </div>
          <VibranceSlider value={value} onChange={s.setEdited} capabilities={caps} disabled={!canApply} />
          <div className="actions">
            <button className="btn primary" disabled={!canApply || s.busy} onClick={s.apply}>
              {t("Aplicar")}
            </button>
            <button className="btn" disabled={!monitor || s.busy} onClick={s.restore}>
              {t(monitor && monitor.driverDefault == null ? "Restaurar anterior" : "Restaurar padrão")}
            </button>
          </div>
          <div className="status">
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
            {value > DRIVER_MAX && hasSuper && (
              <span className="pill accent">
                {t(caps.superMethod === "mhc2" ? "Super Vibrance · perfil MHC2" : "Super Vibrance · todos os monitores")}
              </span>
            )}
            {!hasSuper && caps.superReason && <span className="pill warn">{t(caps.superReason)}</span>}
          </div>
        </div>

        <div className="section valorant-section" aria-label={t("Perfil do Valorant")}>
          <div className="section-head">
            <GamepadIcon />
            <h2>{t("Perfil do Valorant")}</h2>
          </div>
          {valorant ? (
            <>
              <div className="rows">
                <ToggleRow
                  label={t("Aplicar ao abrir")}
                  checked={valorant.applyOnOpen}
                  onChange={(v) => s.setValorantFlag("applyOnOpen", v)}
                />
                <ToggleRow
                  label={t("Restaurar ao fechar")}
                  checked={valorant.restoreOnClose}
                  onChange={(v) => s.setValorantFlag("restoreOnClose", v)}
                />
              </div>
              <GameBadge />
              {caps.superMethod === "magnifier" && valorant.vibrance > DRIVER_MAX && (
                <p className="note">{t("Acima de 100%: deixe o Valorant em “Janela em tela cheia”.")}</p>
              )}
            </>
          ) : (
            <p className="note">{t("Perfil não encontrado. Crie um na aba Perfis.")}</p>
          )}
        </div>
      </section>
    </div>
  );
}

function GameBadge() {
  const game = useStore((s) => s.game);
  const valorant = useStore(valorantProfile);
  const t = useT();
  let text: string;
  let kind = "";
  if (game.state === "unavailable") {
    text = t("Detecção indisponível");
    kind = "warn";
  } else if (game.state === "paused") {
    text = t("Valorant em segundo plano");
  } else if (game.state === "active") {
    text = game.profileId === valorant?.id ? t("Valorant aberto · {v}% aplicado", { v: valorant?.vibrance ?? 0 }) : t("Perfil ativo");
    kind = "accent";
  } else {
    text = t("Aguardando o jogo abrir · {v}%", { v: valorant?.vibrance ?? 0 });
  }
  return (
    <div className={`game-status ${kind}`} title={game.message ?? undefined}>
      <span className="dot" />
      {text}
    </div>
  );
}
