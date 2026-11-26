/**
 * Skins da arma da arena (desenhos próprios do Goat Filter, não são skins do
 * Valorant). Cada uma é um gradiente, uma cor de detalhe e um padrão.
 */

/** Marca frases para tradução (o teste de i18n procura as chamadas de tr). */
const tr = (s: string) => s;

export type SkinPattern = "none" | "stars" | "camo" | "carbon" | "petals" | "stripes" | "flames" | "frost";

export interface WeaponSkin {
  id: string;
  name: string;
  /** Gradiente do corpo (de trás para a ponta). */
  body: [string, string];
  /** Detalhes (faixa, mira de cima, cano). */
  accent: string;
  pattern: SkinPattern;
  /** Brilho em volta (neon). */
  glow?: string;
}

export const WEAPON_SKINS: WeaponSkin[] = [
  { id: "padrao", name: tr("Padrão"), body: ["#3b3f48", "#22252c"], accent: "#8a93a3", pattern: "none" },
  { id: "goat-neon", name: tr("Goat Neon"), body: ["#ff48a8", "#7c5cff"], accent: "#ffffff", pattern: "stripes", glow: "#ff48a8" },
  { id: "galaxia", name: tr("Galáxia"), body: ["#1b1446", "#3a1d6e"], accent: "#b69cff", pattern: "stars", glow: "#7c5cff" },
  { id: "ouro", name: tr("Ouro Real"), body: ["#f7d774", "#b8860b"], accent: "#fff3c4", pattern: "stripes" },
  { id: "gelo", name: tr("Gelo"), body: ["#dff6ff", "#6cc6e8"], accent: "#ffffff", pattern: "frost", glow: "#8be3ff" },
  { id: "inferno", name: tr("Inferno"), body: ["#ff6a1f", "#8a0d0d"], accent: "#ffd25e", pattern: "flames", glow: "#ff5a1f" },
  { id: "camuflado", name: tr("Camuflado Digital"), body: ["#4e5d3a", "#2f3a24"], accent: "#a7b585", pattern: "camo" },
  { id: "carbono", name: tr("Carbono"), body: ["#202226", "#0c0d0f"], accent: "#e33b3b", pattern: "carbon" },
  { id: "sakura", name: tr("Sakura"), body: ["#ffd6e7", "#f49ac1"], accent: "#ffffff", pattern: "petals" },
  { id: "toxico", name: tr("Tóxico"), body: ["#1d2a12", "#0d1408"], accent: "#9dff2e", pattern: "stripes", glow: "#9dff2e" },
  { id: "oceano", name: tr("Oceano"), body: ["#0a4d8c", "#00c2c7"], accent: "#c9fbff", pattern: "frost" },
  { id: "vazio", name: tr("Vazio"), body: ["#0b0912", "#000000"], accent: "#b18cff", pattern: "stars", glow: "#9b5cff" },
];

export const skinById = (id: string) => WEAPON_SKINS.find((s) => s.id === id) ?? WEAPON_SKINS[0];
