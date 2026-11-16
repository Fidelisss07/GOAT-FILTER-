import { useEffect, useState } from "react";
import { getNative } from "../lib/native";
import { Capabilities, EMPHASIS, MonitorHwState, Tuning } from "../lib/types";
import { CheckIcon } from "./Icons";
import { Slider } from "./Slider";

function Fine(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  neutral: number;
  format(v: number): string;
  onChange(v: number): void;
  disabled?: boolean;
}) {
  const { min, max, neutral, format } = props;
  return (
    <div className="fine">
      <div className="fine-head">
        <span>{props.label}</span>
        <span className={`fine-value ${props.value !== neutral ? "changed" : ""}`}>
          {format(props.value)}
          {props.value !== neutral && !props.disabled && (
            <button type="button" className="reset" aria-label={`Voltar ${props.label} ao normal`} onClick={() => props.onChange(neutral)}>
              ↺
            </button>
          )}
        </span>
      </div>
      <Slider
        value={props.value}
        min={min}
        max={max}
        onChange={props.onChange}
        label={props.label}
        disabled={props.disabled}
        marks={[
          { value: min, label: format(min) },
          { value: max, label: format(max) },
        ]}
      />
    </div>
  );
}

type HwKey = "monitorBrightness" | "monitorContrast" | "monitorSaturation";
const HW_ROWS: { key: HwKey; read: keyof MonitorHwState; label: string }[] = [
  { key: "monitorBrightness", read: "brightness", label: "Brilho do monitor" },
  { key: "monitorContrast", read: "contrast", label: "Contraste do monitor" },
  { key: "monitorSaturation", read: "saturation", label: "Saturação do monitor" },
];

/** Controles do próprio monitor (DDC/CI). Lê os valores atuais ao abrir. */
function MonitorHwEditor({ tuning, set, monitorId }: { tuning: Tuning; set(p: Partial<Tuning>): void; monitorId: string | null }) {
  const [hw, setHw] = useState<MonitorHwState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setHw(null);
    setErr(null);
    if (!monitorId) return;
    getNative()
      .then((n) => n.monitorHw(monitorId))
      .then((s) => live && setHw(s))
      .catch((e) => live && setErr(String(e)));
    return () => {
      live = false;
    };
  }, [monitorId]);

  if (err) return <p className="note">Não foi possível ler o monitor: {err}</p>;
  if (!hw) return <p className="note">Lendo o monitor…</p>;
  const none = HW_ROWS.every((r) => hw[r.read] == null);
  if (none)
    return (
      <p className="note">
        Este monitor não respondeu ao DDC/CI. Procure a opção “DDC/CI” no menu do próprio monitor e ligue-a.
      </p>
    );
  return (
    <div className="hw-rows">
      {HW_ROWS.map((r) => {
        const current = hw[r.read];
        const value = tuning[r.key];
        if (current == null)
          return (
            <div key={r.key} className="hw-row off">
              <span>{r.label}</span>
              <span className="pill">não suportado</span>
            </div>
          );
        return (
          <div key={r.key} className="hw-row">
            <label className="check">
              <input
                type="checkbox"
                checked={value != null}
                onChange={(e) => set({ [r.key]: e.target.checked ? current : null } as Partial<Tuning>)}
              />
              {r.label}
              {value != null && <span className="fine-value changed">{value}%</span>}
            </label>
            {value != null ? (
              <Fine label={r.label} value={value} min={0} max={100} neutral={current} format={(v) => `${v}%`} onChange={(v) => set({ [r.key]: v } as Partial<Tuning>)} />
            ) : (
              <span className="note">atual: {current}% (não muda)</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Realce de cor do inimigo + brilho/contraste/gama de um perfil. */
export function TuningEditor({
  tuning,
  onChange,
  capabilities,
  monitorId,
}: {
  tuning: Tuning;
  onChange(t: Tuning): void;
  capabilities: Capabilities;
  /** Monitor onde o perfil é aplicado (para ler o DDC/CI). */
  monitorId: string | null;
}) {
  const set = (patch: Partial<Tuning>) => onChange({ ...tuning, ...patch });
  const hasMatrix = capabilities.superMethod !== "none";
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

  return (
    <div className="tuning">
      <div className="fine">
        <div className="fine-head">
          <span>Realçar cor do inimigo</span>
          {!hasMatrix && <span className="pill warn">indisponível neste PC</span>}
        </div>
        <div className="seg" role="radiogroup" aria-label="Cor do contorno do inimigo">
          {EMPHASIS.map((e) => {
            const on = tuning.emphasis === e.id;
            return (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!hasMatrix && e.id !== "none"}
                onClick={() => set({ emphasis: e.id })}
              >
                {e.color ? <span className="dot" style={{ background: e.color }} /> : null}
                {e.label}
                {on && <CheckIcon className="seg-check" />}
              </button>
            );
          })}
        </div>
        <p className="note">Use a mesma cor do contorno escolhida no Valorant (Configurações › Geral › Cor de destaque do inimigo).</p>
      </div>

      {tuning.emphasis !== "none" && (
        <Fine
          label="Força do realce"
          value={tuning.emphasisStrength}
          min={0}
          max={100}
          neutral={50}
          format={(v) => `${v}%`}
          onChange={(v) => set({ emphasisStrength: v })}
        />
      )}

      <div className="fine-grid">
        <Fine label="Brilho" value={tuning.brightness} min={-50} max={50} neutral={0} format={signed} onChange={(v) => set({ brightness: v })} disabled={!capabilities.curves} />
        <Fine label="Contraste" value={tuning.contrast} min={50} max={150} neutral={100} format={(v) => `${v}%`} onChange={(v) => set({ contrast: v })} disabled={!capabilities.curves} />
        <Fine label="Gama" value={tuning.gamma} min={50} max={200} neutral={100} format={(v) => (v / 100).toFixed(2).replace(".", ",")} onChange={(v) => set({ gamma: v })} disabled={!capabilities.curves} />
      </div>
      <p className="note">Gama acima de 1,00 clareia as sombras e ajuda a ver inimigos em cantos escuros.</p>

      {capabilities.monitorHw && (
        <div className="fine">
          <div className="fine-head">
            <span>Monitor (pelo cabo, DDC/CI)</span>
          </div>
          <MonitorHwEditor tuning={tuning} set={set} monitorId={monitorId} />
        </div>
      )}
    </div>
  );
}
