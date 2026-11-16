import { BeforeAfter } from "../components/BeforeAfter";
import { MonitorSelect, ToggleRow } from "../components/Controls";
import { VibranceSlider, vibranceMax } from "../components/VibranceSlider";
import { DRIVER_MAX } from "../lib/types";
import { previewSaturation } from "../lib/vibrance";
import { selectedMonitor, useStore, valorantProfile } from "../state/store";

const DRIVER_NAME = { nvidia: "NVIDIA", amd: "AMD", none: "" } as const;

export function Overview() {
  const s = useStore();
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
    <div className="overview">
      <div className="ov-top">
        <section className="card monitor-card" aria-label="Digital Vibrance do monitor">
          <div className="head">
            <MonitorSelect
              label="Monitor"
              monitors={s.monitors}
              value={s.selectedMonitorId}
              onChange={s.selectMonitor}
            />
            <div className="value-box">
              <div className="big-value" aria-live="polite">{value}%</div>
            </div>
          </div>

          <VibranceSlider
            value={value}
            onChange={s.setEdited}
            capabilities={caps}
            disabled={!canApply}
          />

          <div className="actions">
            <button className="btn primary" disabled={!canApply || s.busy} onClick={s.apply}>
              Aplicar
            </button>
            <button className="btn" disabled={!monitor || s.busy} onClick={s.restore}>
              {monitor && monitor.driverDefault == null ? "Restaurar anterior" : "Restaurar padrão"}
            </button>
          </div>

          <div className="status">
            {monitor && (
              <span className={`pill ${pending ? "" : "accent"}`}>
                <span className="dot" />
                {pending ? (applied === null ? "Não aplicado" : `Aplicado: ${applied}% · alteração pendente`) : `Aplicado: ${applied}%`}
              </span>
            )}
            {monitor && hasDriver && <span className="pill">Driver {DRIVER_NAME[monitor.driver]}</span>}
            {monitor && !hasDriver && (
              <span className="pill warn">
                {hasSuper ? "Driver sem vibrance — usando a camada Super" : "Sem ajuste disponível neste monitor"}
              </span>
            )}
            {value > DRIVER_MAX && hasSuper && <span className="pill accent">Super Vibrance (todos os monitores)</span>}
            {!hasSuper && caps.superReason && <span className="pill warn">{caps.superReason}</span>}
          </div>
        </section>

        <section className="card valorant-card" aria-label="Perfil do Valorant">
          <h2>Perfil do Valorant</h2>
          {valorant ? (
            <>
              <ToggleRow
                label="Aplicar ao abrir"
                checked={valorant.applyOnOpen}
                onChange={(v) => s.setValorantFlag("applyOnOpen", v)}
              />
              <ToggleRow
                label="Restaurar ao fechar"
                checked={valorant.restoreOnClose}
                onChange={(v) => s.setValorantFlag("restoreOnClose", v)}
              />
              <div className="game-status">
                <GameBadge />
              </div>
            </>
          ) : (
            <p className="note">Perfil não encontrado. Crie um na aba Perfis.</p>
          )}
        </section>
      </div>

      <BeforeAfter saturation={previewSaturation(value)} />
    </div>
  );
}

function GameBadge() {
  const game = useStore((s) => s.game);
  const valorant = useStore(valorantProfile);
  if (game.state === "unavailable")
    return <span className="pill warn" title={game.message ?? undefined}>Detecção indisponível</span>;
  if (game.state === "active")
    return (
      <span className="pill accent">
        <span className="dot" />
        {game.profileId === valorant?.id ? `Valorant aberto · ${valorant?.vibrance}% aplicado` : "Perfil ativo"}
      </span>
    );
  return (
    <span className="pill">
      <span className="dot" />
      Aguardando o jogo abrir · {valorant?.vibrance}%
    </span>
  );
}
