import { ReactNode, useId } from "react";
import { T } from "../lib/i18n";
import { MonitorInfo, THEMES, ThemeId } from "../lib/types";
import { useT } from "../lib/useT";
import { CheckIcon, ChevronDown } from "./Icons";

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function ToggleRow(props: { label: string; checked: boolean; onChange(v: boolean): void; disabled?: boolean; extra?: ReactNode }) {
  return (
    <div className="row">
      <span>
        {props.label}
        {props.extra}
      </span>
      <Toggle {...props} />
    </div>
  );
}

export function monitorLabel(m: MonitorInfo, t: T = (x) => x): string {
  const main = t("Monitor principal");
  return m.primary ? `${main}${m.name && m.name !== "Monitor principal" ? ` — ${m.name}` : ""}` : m.name;
}

export function MonitorSelect({
  monitors,
  value,
  onChange,
  label,
  showLabel = true,
}: {
  monitors: MonitorInfo[];
  value: string | null;
  onChange(id: string): void;
  label: string;
  showLabel?: boolean;
}) {
  const id = useId();
  const t = useT();
  return (
    <div>
      {showLabel && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="select">
        <select
          id={id}
          aria-label={showLabel ? undefined : label}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={monitors.length === 0}
        >
          {monitors.length === 0 && <option value="">{t("Nenhum monitor detectado")}</option>}
          {monitors.map((m) => (
            <option key={m.id} value={m.id}>
              {monitorLabel(m, t)}
            </option>
          ))}
        </select>
        <ChevronDown />
      </div>
    </div>
  );
}

/** Seletor de tema da sidebar (ordem: rosa, roxo, amarelo). */
export function ThemeSwatches({ value, onChange }: { value: ThemeId; onChange(t: ThemeId): void }) {
  const t = useT();
  const move = (dir: number) => {
    const i = THEMES.findIndex((x) => x.id === value);
    onChange(THEMES[(i + dir + THEMES.length) % THEMES.length].id);
  };
  return (
    <div
      className="swatches"
      role="radiogroup"
      aria-label={t("Tema")}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      }}
    >
      {THEMES.map((th) => {
        const on = th.id === value;
        return (
          <button
            key={th.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={t("Tema {name}", { name: t(th.label) })}
            tabIndex={on ? 0 : -1}
            className="swatch"
            style={{ background: th.color, color: th.id === "amarelo" ? "#1a1606" : "#fff" }}
            onClick={() => onChange(th.id)}
          >
            {on && <CheckIcon />}
          </button>
        );
      })}
    </div>
  );
}
