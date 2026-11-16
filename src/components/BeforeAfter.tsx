import { KeyboardEvent, PointerEvent, useRef, useState } from "react";
import scene from "../assets/cenario-preview.png";
import { clamp } from "../lib/vibrance";
import { ArrowsLR } from "./Icons";

/**
 * Comparador Antes/Depois. A mesma imagem nos dois lados; o lado "Depois"
 * recebe CSS saturate(). É só ilustração — não mede o ajuste real do monitor.
 */
export function BeforeAfter({ saturation }: { saturation: number }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const fromPointer = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    setPos(clamp(((x - r.left) / r.width) * 100, 0, 100));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fromPointer(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) fromPointer(e.clientX);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -2 : e.key === "ArrowRight" ? 2 : e.key === "PageDown" ? -10 : e.key === "PageUp" ? 10 : 0;
    if (d) { e.preventDefault(); setPos((p) => clamp(p + d, 0, 100)); }
    if (e.key === "Home") { e.preventDefault(); setPos(0); }
    if (e.key === "End") { e.preventDefault(); setPos(100); }
  };

  return (
    <div
      ref={ref}
      className="compare"
      role="slider"
      tabIndex={0}
      aria-label="Divisor da comparação antes e depois"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onKeyDown={onKey}
    >
      <img src={scene} alt="Cena ilustrativa sem ajuste" draggable={false} />
      <img
        src={scene}
        alt="Cena ilustrativa com o ajuste"
        draggable={false}
        style={{ filter: `saturate(${saturation})`, clipPath: `inset(0 0 0 ${pos}%)` }}
      />
      <div className="divider" style={{ left: `${pos}%` }} />
      <div className="handle" style={{ left: `${pos}%` }}>
        <ArrowsLR />
      </div>
      <span className="tag before">Antes</span>
      <span className="tag after">Depois</span>
      <span className="disclaimer" title="A cena é ilustrativa e não mede o ajuste real do monitor">Prévia ilustrativa</span>
    </div>
  );
}
