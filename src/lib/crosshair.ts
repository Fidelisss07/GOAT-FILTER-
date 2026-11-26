/**
 * Lê um código de mira do Valorant ("0;P;c;5;h;0;0l;4;…") para desenhar a
 * prévia. Só a mira principal (seção P); valores ausentes usam o padrão do jogo.
 */
export interface LineSet {
  show: boolean;
  thickness: number;
  length: number;
  /** Comprimento vertical, quando diferente do horizontal. */
  vertical: number;
  offset: number;
  alpha: number;
}

export interface CrosshairLook {
  color: string;
  outline: boolean;
  outlineThickness: number;
  outlineAlpha: number;
  dot: boolean;
  dotThickness: number;
  dotAlpha: number;
  inner: LineSet;
  outer: LineSet;
}

const COLORS = ["#ffffff", "#00ff00", "#7fff00", "#dfff00", "#ffff00", "#00ffff", "#ff00ff", "#ff0000"];

/** Pares chave → valor da seção principal (P). */
export function primaryValues(code: string): Map<string, string> {
  const parts = code.trim().split(";");
  const out = new Map<string, string>();
  let section = "P";
  // parts[0] é a versão do formato.
  for (let i = 1; i < parts.length; ) {
    const k = parts[i];
    if (k === "P" || k === "A" || k === "S") {
      section = k;
      i += 1;
      continue;
    }
    const v = parts[i + 1];
    if (section === "P" && v !== undefined) out.set(k, v);
    i += 2;
  }
  return out;
}

export function parseCrosshair(code: string): CrosshairLook {
  const m = primaryValues(code);
  const num = (k: string, d: number) => {
    const v = Number(m.get(k));
    return Number.isFinite(v) && m.has(k) ? v : d;
  };
  const flag = (k: string, d: boolean) => (m.has(k) ? m.get(k) !== "0" : d);
  const ci = num("c", 0);
  let color = COLORS[ci] ?? COLORS[0];
  const hex = m.get("u");
  if (ci === 8 && hex && /^[0-9a-fA-F]{6,8}$/.test(hex)) color = `#${hex.slice(0, 6)}`;
  const lines = (p: "0" | "1", d: Omit<LineSet, "vertical">): LineSet => {
    const length = num(`${p}l`, d.length);
    return {
      show: flag(`${p}b`, d.show),
      thickness: num(`${p}t`, d.thickness),
      length,
      vertical: num(`${p}v`, length),
      offset: num(`${p}o`, d.offset),
      alpha: num(`${p}a`, d.alpha),
    };
  };
  return {
    color,
    outline: flag("h", true),
    outlineThickness: num("t", 1),
    outlineAlpha: num("o", 0.5),
    dot: flag("d", false),
    dotThickness: num("z", 2),
    dotAlpha: num("a", 1),
    inner: lines("0", { show: true, thickness: 2, length: 6, offset: 3, alpha: 0.8 }),
    outer: lines("1", { show: true, thickness: 2, length: 2, offset: 10, alpha: 0.35 }),
  };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  alpha: number;
}

/** Retângulos da mira em pixels do jogo, centro em (0, 0). Contorno vem antes. */
export function crosshairRects(look: CrosshairLook): Rect[] {
  const fill: Rect[] = [];
  const set = (s: LineSet) => {
    if (!s.show || s.alpha <= 0 || s.thickness <= 0) return;
    const t = s.thickness, o = s.offset;
    if (s.length > 0) {
      fill.push({ x: o, y: -t / 2, w: s.length, h: t, fill: look.color, alpha: s.alpha }); // direita
      fill.push({ x: -o - s.length, y: -t / 2, w: s.length, h: t, fill: look.color, alpha: s.alpha }); // esquerda
    }
    if (s.vertical > 0) {
      fill.push({ x: -t / 2, y: o, w: t, h: s.vertical, fill: look.color, alpha: s.alpha }); // baixo
      fill.push({ x: -t / 2, y: -o - s.vertical, w: t, h: s.vertical, fill: look.color, alpha: s.alpha }); // cima
    }
  };
  set(look.inner);
  set(look.outer);
  if (look.dot && look.dotAlpha > 0) {
    const z = look.dotThickness;
    fill.push({ x: -z / 2, y: -z / 2, w: z, h: z, fill: look.color, alpha: look.dotAlpha });
  }
  if (!look.outline || look.outlineAlpha <= 0 || look.outlineThickness <= 0) return fill;
  const k = look.outlineThickness;
  const outline = fill.map((r) => ({ x: r.x - k, y: r.y - k, w: r.w + 2 * k, h: r.h + 2 * k, fill: "#000000", alpha: look.outlineAlpha }));
  return [...outline, ...fill];
}

export type PresetKind = "pro" | "estilo" | "divertida";

export interface CrosshairPreset {
  name: string;
  /** Time ou descrição curta. */
  info: string;
  kind: PresetKind;
  code: string;
}

/**
 * Miras prontas reunidas de sites de miras e de configurações de pros
 * (prosettings.net, thespike.gg, fragster.com, dotesports.com, specs.gg,
 * raidgg.com, velocrosshairs.com, ruinerlabs.com, valorantcrosshair.com,
 * vcrosshair.com, valorant-spind.de, beebom.com, unplayed.gg, eloboss.net,
 * dexerto.com, pcgamesn.com, bo3.gg e outros), em novembro de 2026. Pros trocam de mira com frequência.
 */
export const CROSSHAIR_PRESETS: CrosshairPreset[] = [
  { name: "TenZ", info: "Cruz ciano fina", kind: "pro", code: "0;s;1;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0" },
  { name: "aspas", info: "Cruz branca sem contorno", kind: "pro", code: "0;P;h;0;0l;4;0o;0;0a;1;0f;0;1b;0" },
  { name: "Demon1", info: "Cruz branca com contorno", kind: "pro", code: "0;s;1;P;o;1;f;0;0t;1;0l;3;0o;2;0a;1;0f;0;1b;0;S;c;1;o;1" },
  { name: "Less", info: "Cruz preta, linha vertical curta", kind: "pro", code: "0;P;c;8;u;000000FF;h;0;b;1;f;0;0l;4;0v;3;0o;0;0a;1;0f;0;1b;0" },
  { name: "cauanzin", info: "Cruz branca pequena", kind: "pro", code: "0;P;h;0;0l;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "tuyz", info: "Cruz branca média", kind: "pro", code: "0;s;1;P;u;000000FF;h;0;f;0;m;1;0l;3;0v;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "mwzera", info: "Cruz preta com ponto", kind: "pro", code: "0;s;1;P;c;8;u;000000FF;h;0;d;1;b;1;f;0;m;1;0l;3;0o;0;0a;1;0e;0.5;1b;0;S;s;0.8;o;1" },
  { name: "Asuna", info: "Cruz pequena com contorno", kind: "pro", code: "0;P;o;1;0t;1;0l;2;0a;1;0f;0;1b;0" },
  { name: "Shroud", info: "Cruz colada", kind: "pro", code: "0;P;h;0;0l;5;0o;0;0a;1;0f;0;1b;0" },
  { name: "Benkai", info: "Ponto ciano", kind: "pro", code: "0;P;c;5;o;1;d;1;f;0;0t;0;0l;0;0o;0;0a;0;0f;0;1b;0" },
  { name: "Cruz ciano pequena", info: "Boa em qualquer mapa", kind: "estilo", code: "0;P;c;5;o;1;0t;1;0l;2;0o;1;0a;1;0f;0;1b;0" },
  { name: "Mais verde mínimo", info: "Discreta", kind: "estilo", code: "0;P;c;1;h;0;0t;1;0l;2;0o;1;0a;1;0f;0;1b;0" },
  { name: "Ponto", info: "Só o ponto central", kind: "estilo", code: "0;s;1;P;h;0;d;1;z;3;f;0;0t;3;0l;1;0o;1;0a;1;0f;0;1t;0;1l;0;1o;0;1a;0;1f;0" },
  { name: "Cruz colada branca", info: "Linhas encostadas no centro", kind: "estilo", code: "0;P;h;0;f;0;0l;4;0o;0;0a;1;0f;0;1b;0" },
  { name: "Ponto verde com contorno", info: "Ponto destacado", kind: "estilo", code: "0;P;c;1;s;1;d;1;z;2;a;1;0b;0;1b;0" },
  { name: "Cruz grossa amarela", info: "Bloco amarelo", kind: "estilo", code: "0;P;c;4;h;0;d;1;f;0;0t;6;0l;1;0o;1;0a;1;0f;0;1b;0" },
  { name: "Sorriso", info: "Divertida", kind: "divertida", code: "0;P;c;7;t;2;o;1;d;1;z;3;a;0;f;0;0t;10;0l;2;0o;2;0a;1;0f;0;1b;0" },
  { name: "Coração", info: "Divertida", kind: "divertida", code: "0;P;c;6;o;0.1;m;1;0t;5;0l;3;0o;1;0a;0.7;0f;0;1t;1;1l;5;1o;0;1a;0.7;1m;0;1f;0" },
  { name: "Quadrado", info: "Divertida", kind: "divertida", code: "0;P;c;1;o;1;0t;10;0l;1;0o;5;0a;1;0f;0;1l;0;1o;0;1a;1;1m;0;1f;0" },
  { name: "Setas", info: "Divertida", kind: "divertida", code: "0;P;h;0;f;0;m;1;0t;4;0l;1;0a;1;0f;0;1l;5;1o;2;1a;1;1m;0;1f;0" },
  { name: "Flash rosa", info: "Divertida", kind: "divertida", code: "0;P;c;6;t;6;o;0.3;f;0;0t;1;0l;5;0o;5;0a;1;0f;0;1t;10;1l;4;1o;5;1a;0.5;1m;0;1f;0" },
  { name: "f0rsakeN", info: "Paper Rex · ponto branco", kind: "pro", code: "0;p;0;c;1;s;1;P;h;0;f;0;s;0;0l;3;0v;3;0g;1;0o;0;0a;1;0f;0;1b;0;A;o;1;d;1;0b;0;1b;0;S;d;0" },
  { name: "something", info: "Paper Rex · cruz pequena branca", kind: "pro", code: "0;s;1;P;h;0;0l;2;0o;1;0a;1;0f;0;1b;0;S;c;0;s;0.713;o;1" },
  { name: "Zekken", info: "Cruz ciano sem contorno", kind: "pro", code: "0;s;1;P;c;5;h;0;0l;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "Zekken (ponto)", info: "Ponto verde com contorno", kind: "pro", code: "0;P;c;1;o;1;d;1;0b;0;1b;0" },
  { name: "ScreaM", info: "Ponto ciano", kind: "pro", code: "0;P;c;5;o;0.286;d;1;f;0;0t;0;0l;0;0o;0;0a;1;0f;0;1b;0" },
  { name: "TenZ (antiga)", info: "Cruz ciano sem contorno", kind: "pro", code: "0;P;c;5;h;0;0l;4;0o;2;0a;1;1b;0" },
  { name: "TenZ (2026)", info: "Cruz ciano pequena", kind: "pro", code: "0;s;1;P;c;5;o;0;f;0;0l;2;0v;2;0g;1;0o;1;0a;1;0f;0;1b;0" },
  { name: "aspas (ponto)", info: "Ponto ciano grande", kind: "pro", code: "0;P;c;5;o;1;d;1;z;3;f;0;0b;0;1b;0" },
  { name: "Verno", info: "MIBR · ponto branco com contorno", kind: "pro", code: "0;P;o;1;d;1;0b;0;1b;0" },
  { name: "pANcada", info: "Cruz verde", kind: "pro", code: "0;P;c;1;h;0;s;0;0l;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "pANcada (branca)", info: "Cruz branca", kind: "pro", code: "0;P;h;0;f;0;0l;3;0o;2;0a;1;0f;0;1b;0" },
  { name: "Less (fina)", info: "Cruz colada fina", kind: "pro", code: "0;P;o;0;0t;1;0l;2;0o;0;0a;1;0f;0;1b;0" },
  { name: "Less (ponto)", info: "Cruz branca com ponto", kind: "pro", code: "0;s;1;P;o;1;d;1;f;0;0l;2;0o;0;0a;1;0f;0;1b;0" },
  { name: "Sacy", info: "Cruz com linhas de fora", kind: "pro", code: "0;P;h;0;f;0;0t;1;0l;4;0o;1;0a;1;0f;0;1t;3;1o;2;1a;1;1m;0;1f;0" },
  { name: "Clássica 1-4-2-2", info: "Cruz ciano equilibrada", kind: "estilo", code: "0;P;c;5;h;0;0t;1;0l;4;0o;2;0a;1;0f;0;1b;0" },
  { name: "Sorriso amarelo", info: "Divertida", kind: "divertida", code: "0;P;c;4;t;2;o;1;d;1;z;3;a;0;f;0;0t;10;0l;2;0o;2;0a;1;0f;0;1b;0" },
  { name: "Coração rosa-claro", info: "Divertida", kind: "divertida", code: "0;P;c;8;u;F97AC0FF;o;0.1;m;1;0t;5;0l;3;0o;1;0a;0.7;0f;0;1t;1;1l;5;1o;0;1a;0.7;1m;0;1f;0" },
  { name: "Sorriso humilde", info: "Divertida", kind: "divertida", code: "0;P;c;8;u;000000FF;h;0;b;1;0t;4;0l;20;0v;0;0g;1;0o;0;0a;1;0f;0;1t;10;1l;10;1v;0;1g;1;1o;40;1a;1" },
];

export const CROSSHAIR_SOURCES = [
  "prosettings.net",
  "thespike.gg",
  "fragster.com",
  "dotesports.com",
  "specs.gg",
  "raidgg.com",
  "velocrosshairs.com",
  "ruinerlabs.com",
  "valorantcrosshair.com",
  "vcrosshair.com",
  "valorant-spind.de",
  "beebom.com",
  "unplayed.gg",
  "agatasmurf.com",
  "overgear.com",
  "valorantcrosshair.cc",
  "eloboss.net",
  "dexerto.com",
  "pcgamesn.com",
  "bo3.gg",
  "pichauarena.com.br",
  "theclutch.com.br",
];
