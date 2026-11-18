import { DEFAULT_TUNING, EmphasisColor, Profile, Tuning } from "./types";

/**
 * Código curto para compartilhar a configuração de cor de um perfil
 * (ex.: mandar no Discord). Leva só vibrância e ajustes finos: nada do PC
 * (caminho do jogo, monitor).
 */
const PREFIX = "GF1-";
const EMPH: EmphasisColor[] = ["none", "red", "yellow", "purple"];

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  const p = s.replace(/-/g, "+").replace(/_/g, "/");
  return atob(p + "=".repeat((4 - (p.length % 4)) % 4));
}

export function encodeProfile(p: Pick<Profile, "vibrance" | "tuning">): string {
  const t = p.tuning;
  const parts = [p.vibrance, EMPH.indexOf(t.emphasis), t.emphasisStrength, t.brightness, t.contrast, t.gamma];
  return PREFIX + b64url(parts.join("."));
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Math.round(v)));

/** Lê um código. Devolve null se não for um código válido. */
export function decodeProfile(code: string): { vibrance: number; tuning: Tuning } | null {
  const c = code.trim();
  if (!c.startsWith(PREFIX) || c.length > 80) return null;
  let raw: string;
  try {
    raw = unb64url(c.slice(PREFIX.length));
  } catch {
    return null;
  }
  const n = raw.split(".").map(Number);
  if (n.length !== 6 || n.some((x) => !Number.isFinite(x))) return null;
  const [v, e, es, b, ct, g] = n;
  if (e < 0 || e >= EMPH.length) return null;
  return {
    vibrance: clamp(v, 0, 200),
    tuning: {
      ...DEFAULT_TUNING,
      emphasis: EMPH[e],
      emphasisStrength: clamp(es, 0, 100),
      brightness: clamp(b, -50, 50),
      contrast: clamp(ct, 50, 150),
      gamma: clamp(g, 50, 200),
    },
  };
}
