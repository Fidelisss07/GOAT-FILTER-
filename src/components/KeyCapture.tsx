import { KeyboardEvent as ReactKeyboardEvent, useState } from "react";
import { useT } from "../lib/useT";

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]);

/** "Ctrl+Alt+KeyG" → "Ctrl + Alt + G" */
export function prettyBinding(b: string): string {
  if (!b) return "—";
  return b
    .split("+")
    .map((p) =>
      p
        .replace(/^Key/, "")
        .replace(/^Digit/, "")
        .replace(/^Numpad/, "Num ")
        .replace("ArrowUp", "↑")
        .replace("ArrowDown", "↓")
        .replace("ArrowLeft", "←")
        .replace("ArrowRight", "→"),
    )
    .join(" + ");
}

/**
 * Converte uma tecla apertada no formato aceito pelo app.
 * Exige Ctrl ou Alt para não roubar teclas usadas no jogo ou no chat.
 */
export function bindingFromEvent(e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  if (!e.ctrlKey && !e.altKey) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(e.code);
  return parts.join("+");
}

export function KeyCapture({
  label,
  value,
  onChange,
  conflict,
  disabled,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  conflict?: string | null;
  disabled?: boolean;
}) {
  const t = useT();
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      setListening(false);
      setHint(null);
      return;
    }
    const b = bindingFromEvent(e);
    if (!b) {
      if (!MODIFIER_CODES.has(e.code)) setHint(t("Use Ctrl ou Alt junto com a tecla."));
      return;
    }
    setListening(false);
    setHint(null);
    onChange(b);
  };

  return (
    <div className="bind-row">
      <span className="bind-label">{label}</span>
      <div className="bind-ctl">
        <button
          type="button"
          className={`bind-key ${listening ? "listening" : ""} ${conflict ? "conflict" : ""}`}
          aria-label={t("{label}: {key}. Clique para trocar.", { label, key: prettyBinding(value) })}
          disabled={disabled}
          onClick={() => {
            setListening((v) => !v);
            setHint(null);
          }}
          onKeyDown={onKey}
          onBlur={() => setListening(false)}
        >
          {listening ? t("Aperte a combinação…") : prettyBinding(value)}
        </button>
        {(hint || conflict) && <span className="field-error">{hint ?? conflict}</span>}
      </div>
    </div>
  );
}
