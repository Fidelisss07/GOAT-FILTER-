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
 * Teclas que podem ser atalho sozinhas: não são usadas para andar, mirar ou
 * digitar no chat (o atalho global "rouba" a tecla do jogo).
 */
export function isBareSafe(code: string): boolean {
  return (
    /^F([1-9]|1[0-9]|2[0-4])$/.test(code) ||
    // Enter do teclado numérico é o mesmo Enter do chat no Windows: fica de fora.
    /^Numpad([0-9]|Add|Decimal|Divide|Multiply|Subtract)$/.test(code) ||
    ["Insert", "Home", "End", "PageUp", "PageDown", "Pause", "ScrollLock", "PrintScreen"].includes(code)
  );
}

/**
 * Converte uma tecla apertada no formato aceito pelo app.
 * Exige Ctrl ou Alt para não roubar teclas usadas no jogo ou no chat; com
 * `allowBare`, aceita sozinhas as teclas de isBareSafe (ex.: F8, Insert, Num 0).
 */
export function bindingFromEvent(
  e: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean },
  allowBare = false,
): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  if (!e.ctrlKey && !e.altKey && !(allowBare && isBareSafe(e.code))) return null;
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
  allowBare = false,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  conflict?: string | null;
  disabled?: boolean;
  /** Aceita F1–F12, Insert, Home, teclado numérico etc. sem Ctrl/Alt. */
  allowBare?: boolean;
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
    const b = bindingFromEvent(e, allowBare);
    if (!b) {
      if (!MODIFIER_CODES.has(e.code))
        setHint(
          allowBare
            ? t("Sozinhas só F1–F12, Insert, Home, End, Page Up/Down, Pause ou o teclado numérico. Letras precisam de Ctrl ou Alt.")
            : t("Use Ctrl ou Alt junto com a tecla."),
        );
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
          {listening ? t(allowBare ? "Aperte a tecla…" : "Aperte a combinação…") : prettyBinding(value)}
        </button>
        {(hint || conflict) && <span className="field-error">{hint ?? conflict}</span>}
      </div>
    </div>
  );
}
