import { KeyboardEvent, PointerEvent, useId, useRef, WheelEvent } from "react";
import { clamp } from "../lib/vibrance";

const START = 135; // graus (0 = direita, 90 = embaixo): começa embaixo à esquerda
const SWEEP = 270; // e vai por cima até embaixo à direita
const R = 150; // raio do arco (viewBox 400)

const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [200 + r * Math.cos(a), 200 + r * Math.sin(a)] as const;
};
const arc = (from: number, to: number, r: number) => {
  if (to - from < 0.01) return "";
  const [x1, y1] = pt(from, r);
  const [x2, y2] = pt(to, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

interface Props {
  value: number;
  max: number;
  onChange(v: number): void;
  label: string;
  /** Início da faixa "super" (acima do limite do driver). */
  superFrom?: number;
  disabled?: boolean;
  /** Texto pequeno embaixo do número (ex.: "super"). */
  badge?: string;
  caption: string;
}

/** Seletor circular do vibrance (como uma roda de habilidades). Mouse, roda do mouse, toque e teclado. */
export function VibranceDial({ value, max, onChange, label, superFrom, disabled, badge, caption }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const gid = useId().replace(/:/g, "");
  const v = clamp(value, 0, max);
  const ang = (x: number) => START + (clamp(x, 0, max) / max) * SWEEP;

  const fromPointer = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    let deg = (Math.atan2(clientY - (r.top + r.height / 2), clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    // Vão embaixo (45°–135°): encosta no começo ou no fim, o que estiver mais perto.
    if (deg > 45 && deg < 135) {
      onChange(deg < 90 ? max : 0);
      return;
    }
    const a = deg >= START ? deg : deg + 360;
    onChange(Math.round(((a - START) / SWEEP) * max));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus();
    fromPointer(e.clientX, e.clientY);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture?.(e.pointerId)) return;
    fromPointer(e.clientX, e.clientY);
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 };
    let next: number | null = null;
    if (e.key in step) next = v + step[e.key];
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    if (next !== null) {
      e.preventDefault();
      onChange(clamp(next, 0, max));
    }
  };
  const onWheel = (e: WheelEvent) => {
    if (disabled || !e.deltaY) return;
    onChange(clamp(v + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, max));
  };

  const labelEvery = max > 100 ? 20 : 10;
  const ticks = [];
  for (let x = 0; x <= max; x += max > 100 ? 5 : 2.5) {
    const a = ang(x);
    const major = x % labelEvery === 0;
    const [x1, y1] = pt(a, major ? 166 : 170);
    const [x2, y2] = pt(a, 178);
    ticks.push(<line key={`t${x}`} className={major ? "major" : undefined} x1={x1} y1={y1} x2={x2} y2={y2} />);
    if (major) {
      const [lx, ly] = pt(a, 196);
      ticks.push(
        <text key={`l${x}`} x={lx} y={ly} textAnchor="middle" dominantBaseline="central">
          {x}
        </text>,
      );
    }
  }
  const [kx, ky] = pt(ang(v), R);

  return (
    <div
      ref={ref}
      className="dial"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={v}
      aria-valuetext={`${v}%`}
      aria-disabled={disabled || undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onKeyDown={onKey}
      onWheel={onWheel}
    >
      <div className="dial-glass" />
      <svg className="dial-svg" viewBox="-20 -20 440 440" aria-hidden>
        <defs>
          <linearGradient id={`g${gid}`} gradientUnits="userSpaceOnUse" x1="60" y1="330" x2="350" y2="200">
            <stop offset="0" style={{ stopColor: "var(--g1)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--g2)" }} />
            <stop offset="1" style={{ stopColor: "var(--g3)" }} />
          </linearGradient>
          <pattern id={`s${gid}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="3" height="8" fill="rgba(255,255,255,0.14)" />
          </pattern>
          <filter id={`f${gid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle className="dial-orbit" cx="200" cy="200" r="214" />
        <g className="dial-ticks">{ticks}</g>
        <path className="dial-track" d={arc(START, START + SWEEP, R)} />
        {superFrom !== undefined && superFrom < max && (
          <path className="dial-super" d={arc(ang(superFrom), START + SWEEP, R)} stroke={`url(#s${gid})`} />
        )}
        <path className="dial-glow" d={arc(START, ang(v), R)} stroke={`url(#g${gid})`} filter={`url(#f${gid})`} />
        <path className="dial-fill" d={arc(START, ang(v), R)} stroke={`url(#g${gid})`} />
        <circle className="dial-knob-halo" cx={kx} cy={ky} r="20" />
        <circle className="dial-knob" cx={kx} cy={ky} r="12" />
      </svg>
      <div className="dial-center" aria-hidden>
        <span className="dial-caption">{caption}</span>
        <strong className="dial-value">
          {v}
          <small>%</small>
        </strong>
        {badge && <span className="dial-badge">{badge}</span>}
      </div>
    </div>
  );
}
