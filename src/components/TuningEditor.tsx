import { Capabilities, EMPHASIS, Tuning } from "../lib/types";
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

/** Realce de cor do inimigo + brilho/contraste/gama de um perfil. */
export function TuningEditor({
  tuning,
  onChange,
  capabilities,
}: {
  tuning: Tuning;
  onChange(t: Tuning): void;
  capabilities: Capabilities;
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
    </div>
  );
}
