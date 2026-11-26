/**
 * Coleção gerada de miras do Valorant: cada combinação de estilo, cor e
 * tamanho vira um código válido do jogo (seção principal "P"). Junto das
 * miras de pros, passa de 1500 opções.
 */
import { CrosshairPreset } from "./crosshair";

/** Marca frases para tradução (o teste de i18n procura as chamadas de tr). */
const tr = (s: string) => s;

export interface XhColor {
  id: string;
  name: string;
  /** Índice das cores do jogo (0–7) ou cor própria em hex. */
  index?: number;
  hex?: string;
  /** Cor da bolinha no filtro. */
  swatch: string;
}

export const XH_COLORS: XhColor[] = [
  { id: "branca", name: tr("branca"), index: 0, swatch: "#ffffff" },
  { id: "verde", name: tr("verde"), index: 1, swatch: "#00ff00" },
  { id: "verde-claro", name: tr("verde-claro"), index: 2, swatch: "#7fff00" },
  { id: "verde-limao", name: tr("verde-limão"), index: 3, swatch: "#dfff00" },
  { id: "amarela", name: tr("amarela"), index: 4, swatch: "#ffff00" },
  { id: "ciano", name: tr("ciano"), index: 5, swatch: "#00ffff" },
  { id: "rosa", name: tr("rosa"), index: 6, swatch: "#ff00ff" },
  { id: "vermelha", name: tr("vermelha"), index: 7, swatch: "#ff0000" },
  { id: "preta", name: tr("preta"), hex: "000000", swatch: "#000000" },
  { id: "laranja", name: tr("laranja"), hex: "FF8C00", swatch: "#ff8c00" },
  { id: "roxa", name: tr("roxa"), hex: "9B5CFF", swatch: "#9b5cff" },
  { id: "pink", name: tr("pink"), hex: "FF2E9A", swatch: "#ff2e9a" },
  { id: "turquesa", name: tr("turquesa"), hex: "00E5C0", swatch: "#00e5c0" },
  { id: "azul", name: tr("azul"), hex: "3D8BFF", swatch: "#3d8bff" },
  { id: "dourada", name: tr("dourada"), hex: "FFC83D", swatch: "#ffc83d" },
  { id: "salmao", name: tr("salmão"), hex: "FF7A6B", swatch: "#ff7a6b" },
];

export const XH_FAMILIES = {
  ponto: tr("Ponto"),
  cruz: tr("Cruz"),
  cruzPonto: tr("Cruz com ponto"),
  horizontal: tr("Linha horizontal"),
  dupla: tr("Mira dupla"),
  bloco: tr("Bloco"),
  caixa: tr("Caixa"),
  longa: tr("Cruz longa"),
  alta: tr("Cruz alta"),
  moldura: tr("Ponto com moldura"),
  translucida: tr("Cruz translúcida"),
  divertida: tr("Divertida"),
} as const;
export type XhFamily = keyof typeof XH_FAMILIES;

interface Opts {
  outline?: number; // 0/1
  outlineT?: number;
  outlineA?: number;
  dot?: number;
  dotZ?: number;
  dotA?: number;
  inner?: { t: number; l: number; v?: number; o: number; a?: number } | null;
  outer?: { t: number; l: number; v?: number; o: number; a?: number } | null;
}

function colorPart(c: XhColor): string {
  return c.index != null ? (c.index === 0 ? "" : `c;${c.index};`) : `c;8;u;${c.hex}FF;`;
}

/** Monta um código de mira do Valorant. */
export function buildCode(c: XhColor, o: Opts): string {
  let s = `0;P;${colorPart(c)}h;${o.outline ?? 0};`;
  if (o.outline) s += `t;${o.outlineT ?? 1};o;${o.outlineA ?? 1};`;
  if (o.dot) s += `d;1;z;${o.dotZ ?? 2};a;${o.dotA ?? 1};`;
  s += "f;0;";
  if (o.inner) {
    const i = o.inner;
    s += `0t;${i.t};0l;${i.l};`;
    if (i.v != null && i.v !== i.l) s += `0v;${i.v};`;
    s += `0o;${i.o};0a;${i.a ?? 1};0m;0;0f;0;`;
  } else s += "0b;0;";
  if (o.outer) {
    const u = o.outer;
    s += `1t;${u.t};1l;${u.l};`;
    if (u.v != null && u.v !== u.l) s += `1v;${u.v};`;
    s += `1o;${u.o};1a;${u.a ?? 1};1m;0;1f;0`;
  } else s += "1b;0";
  return s;
}

export interface GenPreset extends CrosshairPreset {
  family: XhFamily;
  color: string;
  /** Detalhe do tamanho (ex.: "4·2"), sem tradução. */
  detail: string;
}

/** Gera a coleção (determinística: sempre a mesma ordem e os mesmos códigos). */
export function generateCrosshairs(): GenPreset[] {
  const out: GenPreset[] = [];
  const seen = new Set<string>();
  const add = (family: XhFamily, c: XhColor, detail: string, o: Opts) => {
    const code = buildCode(c, o);
    if (seen.has(code)) return;
    seen.add(code);
    out.push({
      name: `${XH_FAMILIES[family]} ${c.name} ${detail}`.trim(),
      info: XH_FAMILIES[family],
      kind: family === "divertida" ? "divertida" : "estilo",
      code,
      family,
      color: c.id,
      detail,
    });
  };
  for (const c of XH_COLORS) {
    // Contorno preto ajuda a ver cores claras; em mira preta, contorno branco não existe no jogo, então fica sem.
    const ol = c.id === "preta" ? 0 : 1;
    // Ponto: 4 tamanhos, com e sem contorno.
    for (const z of [2, 3, 4, 6]) for (const h of [0, ol]) add("ponto", c, `${z}${h ? "+" : ""}`, { outline: h, dot: 1, dotZ: z, inner: null, outer: null });
    // Cruz: comprimento × espaço × espessura.
    for (const l of [2, 3, 4, 6])
      for (const g of [0, 1, 2, 4])
        for (const th of [1, 2]) add("cruz", c, `${l}·${g}·${th}`, { outline: th === 2 ? ol : 0, inner: { t: th, l, o: g } });
    // Cruz com ponto.
    for (const l of [2, 4]) for (const g of [2, 3]) for (const th of [1, 2]) add("cruzPonto", c, `${l}·${g}·${th}`, { outline: ol, dot: 1, dotZ: 2, inner: { t: th, l, o: g } });
    // Só a linha horizontal.
    for (const l of [3, 5, 8]) for (const g of [2, 4]) add("horizontal", c, `${l}·${g}`, { outline: ol, inner: { t: 2, l, v: 0, o: g } });
    // Mira dupla: linhas de dentro + de fora.
    for (const il of [2, 3]) for (const oo of [6, 10]) for (const ol2 of [2, 4]) add("dupla", c, `${il}·${oo}·${ol2}`, { outline: ol, inner: { t: 2, l: il, o: 2 }, outer: { t: 2, l: ol2, o: oo, a: 0.6 } });
    // Bloco: cruz grossa e curta.
    for (const th of [3, 4, 6]) for (const l of [1, 2]) add("bloco", c, `${th}·${l}`, { outline: ol, inner: { t: th, l, o: 0 } });
    // Caixa: linhas grossas afastadas formam um quadrado vazado.
    for (const b of [3, 4, 5]) add("caixa", c, `${b}`, { outline: 0, inner: { t: b * 2, l: 1, o: b } });
    // Cruz longa (estilo sniper).
    for (const l of [8, 10, 14]) for (const th of [1, 2]) add("longa", c, `${l}·${th}`, { outline: th === 2 ? ol : 0, inner: { t: th, l, o: 3 } });
    // Cruz alta: linha vertical maior que a horizontal.
    for (const v of [6, 8]) for (const l of [2, 3]) add("alta", c, `${l}·${v}`, { outline: ol, inner: { t: 2, l, v, o: 2 } });
    // Ponto com moldura (linhas de fora em volta do ponto).
    for (const oo of [4, 6]) for (const z of [2, 3]) add("moldura", c, `${z}·${oo}`, { outline: ol, dot: 1, dotZ: z, inner: null, outer: { t: 1, l: 2, o: oo, a: 0.8 } });
    // Translúcida: menos opaca, para quem acha a mira chamativa.
    for (const a of [0.5, 0.7]) for (const l of [3, 4]) for (const g of [1, 3]) add("translucida", c, `${l}·${g}·${Math.round(a * 100)}%`, { outline: 0, inner: { t: 2, l, o: g, a } });
    // Divertidas.
    add("divertida", c, "X", { outline: ol, dot: 1, dotZ: 1, inner: { t: 1, l: 1, o: 3 }, outer: { t: 1, l: 1, o: 5 } });
    add("divertida", c, "▣", { outline: 0, inner: { t: 10, l: 1, o: 5 }, outer: { t: 4, l: 1, o: 1 } });
    add("divertida", c, "✚", { outline: ol, inner: { t: 4, l: 6, o: 0 }, outer: { t: 2, l: 2, o: 8, a: 0.6 } });
    add("divertida", c, "◎", { outline: 0, dot: 1, dotZ: 2, inner: { t: 12, l: 1, o: 6, a: 0.7 } });
    add("divertida", c, "⊕", { outline: 0, dot: 1, dotZ: 3, inner: { t: 1, l: 4, o: 4 } });
  }
  return out;
}

let cache: GenPreset[] | null = null;
/** A coleção, gerada uma vez só. */
export function generatedCrosshairs(): GenPreset[] {
  return (cache ??= generateCrosshairs());
}
