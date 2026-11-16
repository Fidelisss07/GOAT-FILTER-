import { KeyboardEvent, PointerEvent, useRef } from "react";
import { clamp } from "../lib/vibrance";

export interface Mark {
  value: number;
  label: string;
  hint?: string;
}

interface Props {
  value: number;
  min?: number;
  max: number;
  onChange(v: number): void;
  marks: Mark[];
  label: string;
  /** Início da faixa "Super" (desenhada com hachura). */
  superFrom?: number;
  disabled?: boolean;
}

/** Slider inteiro, acessível por mouse, toque e teclado. */
export function Slider({ value, min = 0, max, onChange, marks, label, superFrom, disabled }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = (v: number) => ((clamp(v, min, max) - min) / (max - min)) * 100;

  const fromPointer = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const t = clamp((clientX - r.left) / r.width, 0, 1);
    onChange(Math.round(min + t * (max - min)));
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    fromPointer(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    fromPointer(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const step: Record<string, number> = {
      ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10,
    };
    let next: number | null = null;
    if (e.key in step) next = value + step[e.key];
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next !== null) {
      e.preventDefault();
      onChange(clamp(next, min, max));
    }
  };

  return (
    <div className="slider" aria-disabled={disabled || undefined}>
      <div
        ref={ref}
        className="slider-hit"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value}%`}
        aria-disabled={disabled || undefined}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKey}
      >
        <div className="slider-track" />
        {superFrom !== undefined && superFrom < max && (
          <div className="slider-zone" style={{ left: `${pct(superFrom)}%`, right: 0 }} />
        )}
        <div className="slider-fill" style={{ width: `${pct(value)}%` }} />
        <div className="slider-thumb" style={{ left: `${pct(value)}%` }} />
      </div>
      <div className="slider-marks" aria-hidden>
        {marks.map((m, i) => (
          <span
            key={m.value}
            className={`slider-mark${i === 0 ? " first" : ""}${i === marks.length - 1 ? " last" : ""}`}
            style={{ left: `${pct(m.value)}%` }}
          >
            {m.label}
            {m.hint && <span className="hint">{m.hint}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
