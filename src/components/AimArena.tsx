import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArenaMode,
  ArenaSession,
  bestScore,
  buildProfile,
  coach,
  loadLevels,
  loadSessions,
  MODE_HELP,
  MODE_LABEL,
  modeDuration,
  nextLevel,
  RoutineStep,
  saveLevel,
  saveSession,
  sessionScore,
  sessionStats,
  Shot,
} from "../lib/aimStats";
import { crosshairRects, parseCrosshair, Rect } from "../lib/crosshair";
import { convertSens } from "../lib/sens";
import { angularDistance, Approach, degPerCount, loadProfile, VALORANT_HFOV } from "../lib/sensFinder";
import { saveResult, TrainMode } from "../lib/trainStats";
import { useT } from "../lib/useT";
import { skinById, WeaponSkin, WEAPON_SKINS } from "../lib/weaponSkins";
import { useStore } from "../state/store";
import { InsightList } from "./AimProfile";

/* ================================================================ mundo 3D */
type V3 = [number, number, number];
const R = Math.PI / 180;
const NEAR = 0.1;
/** Altura do chão em relação ao olho (m). A cabeça de um inimigo de pé fica na altura do olho. */
const FLOOR = -1.75;
const HEAD_R = 0.13;
const BODY_W = 0.24;
const RUN = 5.4; // velocidade de corrida no Valorant (m/s)

const dirOf = (yaw: number, pitch: number): V3 => [Math.cos(pitch * R) * Math.sin(yaw * R), Math.sin(pitch * R), Math.cos(pitch * R) * Math.cos(yaw * R)];
const yawOf = (p: V3) => Math.atan2(p[0], p[2]) / R;
const pitchOf = (p: V3) => Math.atan2(p[1], Math.hypot(p[0], p[2])) / R;
const len = (p: V3) => Math.hypot(p[0], p[1], p[2]);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

type Mat = "plaster" | "brick" | "wood" | "panel" | "metal";

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  color: string;
  /** Textura desenhada por cima (padrão: pela cor). */
  mat?: Mat;
  /** Letra pintada na frente (ex.: "A" do bomb). */
  decal?: string;
}

interface Cam {
  f: V3;
  r: V3;
  u: V3;
  F: number;
  w: number;
  h: number;
}

function camera(yaw: number, pitch: number, w: number, h: number): Cam {
  const f = dirOf(yaw, pitch);
  const r: V3 = [Math.cos(yaw * R), 0, -Math.sin(yaw * R)];
  const u: V3 = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  return { f, r, u, F: w / 2 / Math.tan((VALORANT_HFOV / 2) * R), w, h };
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const toCam = (c: Cam, p: V3): V3 => [dot(p, c.r), dot(p, c.u), dot(p, c.f)];
const screen = (c: Cam, q: V3) => ({ x: c.w / 2 + (q[0] / q[2]) * c.F, y: c.h / 2 - (q[1] / q[2]) * c.F });

/** Raio a partir do olho: distância até a esfera (ou null). */
function hitSphere(d: V3, c: V3, r: number): number | null {
  const tca = dot(c, d);
  if (tca < 0) return null;
  const d2 = dot(c, c) - tca * tca;
  if (d2 > r * r) return null;
  return tca - Math.sqrt(r * r - d2);
}

function hitBox(d: V3, b: Box): number | null {
  let tmin = 0, tmax = Infinity;
  const lo = [b.x0, b.y0, b.z0], hi = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (0 < lo[i] || 0 > hi[i]) return null;
      continue;
    }
    let t1 = lo[i] / d[i], t2 = hi[i] / d[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/* ================================================================ alvos */
interface Tgt {
  id: number;
  kind: "ball" | "agent";
  /** Centro da bola ou da cabeça. */
  pos: V3;
  rad: number;
  hp: number;
  spawnAt: number;
  visibleAt: number;
  expires: number;
  approach: Approach | null;
  aimAtVisible: { yaw: number; pitch: number } | null;
  angle0: number;
  reactAt: number | null;
  miss: number;
  // movimento lateral (inimigos)
  vx: number;
  stopX: number | null;
  phase: "wait" | "out" | "stay" | "back" | "cross" | "strafe" | "up";
  phaseAt: number;
  stayMs: number;
  homeX: number;
  minX: number;
  maxX: number;
  nextTurn: number;
  /** Inimigo em cima de uma caixa (desenha a caixa embaixo). */
  raised: boolean;
}

interface Hit {
  at: number;
  head: boolean;
  kill: boolean;
}

interface Sim {
  mode: ArenaMode;
  level: number;
  sens: number;
  yaw: number;
  pitch: number;
  lastYaw: number;
  lastPitch: number;
  lastT: number;
  speed: number;
  start: number;
  dur: number;
  pausedAt: number;
  pausedTotal: number;
  paused: boolean;
  targets: Tgt[];
  walls: Box[];
  shots: Shot[];
  pendingMiss: number;
  nextAt: number;
  lastKillAt: number;
  ids: number;
  hits: Hit[];
  track: { frames: number; head: number; body: number; lag: number; off: number };
  fired: number;
  killsLive: number;
  /** Mapa: metros andados, checkpoint atual, andando, rota limpa. */
  walked: number;
  cp: number;
  walking: boolean;
  routeDone: boolean;
  lastShotAt: number;
}

/* ---------------------------------------------------------------- cenário por modo */
// Paleta do cenário: fim de tarde, reboco claro, tijolo, madeira e metal.
const WALL = "#d2b892";
const WALL2 = "#b07a5c";
const CRATE = "#b37440";
const METAL = "#5d8a91";
const BACK = "#c4a37e";

function wallsFor(mode: ArenaMode): Box[] {
  const back: Box = { x0: -60, x1: 60, y0: FLOOR, y1: 6, z0: 42, z1: 43, color: BACK, mat: "panel" };
  const box = (x0: number, x1: number, z0: number, depth: number, h: number, color = WALL): Box => ({ x0, x1, y0: FLOOR, y1: FLOOR + h, z0, z1: z0 + depth, color });
  if (mode === "peek")
    return [back, box(-9, -4, 11, 0.6, 3.2), box(3.5, 8.5, 15, 0.6, 3.2, WALL2), box(-1.2, 1.2, 22, 2, 1.1, CRATE)];
  if (mode === "hold") return [back, box(-14, -1.4, 18, 2, 4), box(1.4, 14, 18, 2, 4)];
  if (mode === "headline")
    return [back, box(-12, -8, 12, 2, 1.0, CRATE), box(-3, 0, 18, 2, 1.0, CRATE), box(6, 10, 10, 2, 1.0, CRATE), box(-18, -14, 24, 3, 3, WALL2), box(13, 17, 22, 3, 3, WALL)];
  if (mode === "preaim") return ROUTE_WALLS.map((b) => ({ ...b }));
  return [back];
}

/* ---------------------------------------------------------------- mapa Base Goat (original) */
const box = (x0: number, x1: number, z0: number, z1: number, h: number, color = WALL): Box => ({ x0, x1, y0: FLOOR, y1: FLOOR + h, z0, z1, color });
/** Corredor de entrada, janela à direita e o bomb A com caixas, pilar e plataforma. */
const ROUTE_WALLS: Box[] = [
  { ...box(-60, 60, 48, 49, 7, BACK), mat: "panel", decal: "A" }, // fundo do bomb
  box(-3.1, -2.4, -2, 19, 4.2), // parede esquerda do corredor
  box(2.4, 3.1, -2, 14, 4.2), // parede direita (acaba na janela)
  box(3.1, 12, 18.6, 19.3, 4.2, WALL2), // fundo da janela
  { ...box(-30, -3.1, 18.6, 19.3, 4.2, WALL2), decal: "A" }, // parede da entrada do bomb
  box(-8, -5, 26, 29, 1.2, CRATE), // caixa baixa
  box(4, 7, 30, 33, 2.4, CRATE), // caixa alta
  box(-1, 1, 34, 36, 4.2, METAL), // pilar
  box(-16, -9, 38, 44, 2, WALL2), // plataforma (heaven)
  box(10, 13, 22, 25, 1.2, CRATE), // caixa da direita
];

interface Checkpoint {
  /** Onde o jogador para (metros andados). */
  z: number;
  enemies: { pos: V3; raised?: boolean }[];
}
/** Rota de pre-aim: em cada parada os inimigos já estão nos ângulos comuns. */
const ROUTE: Checkpoint[] = [
  { z: 12.8, enemies: [{ pos: [6, 0, 17] }] },
  { z: 17, enemies: [{ pos: [-6.5, 0, 30.6] }, { pos: [11.5, 0, 26.4] }] },
  { z: 21, enemies: [{ pos: [3.3, 0, 31.5] }, { pos: [-12.5, 2, 41], raised: true }] },
  { z: 26, enemies: [{ pos: [1.7, 0, 35.2] }, { pos: [-4, 0, 44] }] },
];
const ROUTE_TOTAL = ROUTE.reduce((a, c) => a + c.enemies.length, 0);

/** Pontos de peek: borda da parede, frente da parede (z), lado para onde o inimigo sai e onde ele fica (z). */
const PEEK_SPOTS = [
  { edge: -4, front: 11, side: 1, z: 12.1 },
  { edge: -9, front: 11, side: -1, z: 12.1 },
  { edge: 3.5, front: 15, side: -1, z: 16.1 },
  { edge: 8.5, front: 15, side: 1, z: 16.1 },
];

function newTarget(s: Sim, kind: Tgt["kind"], pos: V3, rad: number, now: number): Tgt {
  return {
    id: ++s.ids,
    kind,
    pos,
    rad,
    hp: kind === "agent" ? 2 : 1,
    spawnAt: now,
    visibleAt: -1,
    expires: Infinity,
    approach: null,
    aimAtVisible: null,
    angle0: 0,
    reactAt: null,
    miss: 0,
    vx: 0,
    stopX: null,
    phase: "stay",
    phaseAt: now,
    stayMs: 0,
    homeX: pos[0],
    minX: -Infinity,
    maxX: Infinity,
    nextTurn: Infinity,
    raised: false,
  };
}

/** Bola a `dist` metros na direção (yaw, pitch), com raio angular `deg`. */
function ballAt(s: Sim, yaw: number, pitch: number, deg: number, now: number): Tgt {
  const dist = 10;
  const d = dirOf(yaw, pitch);
  return newTarget(s, "ball", [d[0] * dist, d[1] * dist, d[2] * dist], Math.tan(deg * R) * dist, now);
}

const angSize = (t: Tgt) => Math.atan(t.rad / Math.max(0.5, len(t.pos))) / R;

function spawnFor(s: Sim, now: number) {
  const L = s.level;
  switch (s.mode) {
    case "flick": {
      let y = 0, p = 0;
      for (let k = 0; k < 20; k++) {
        y = rand(-40, 40);
        p = rand(-14, 18);
        if (angularDistance(s.yaw, s.pitch, y, p) > 12) break;
      }
      const t = ballAt(s, y, p, 1.8 - 0.09 * L, now);
      t.expires = now + 2600 - 120 * L;
      s.targets.push(t);
      break;
    }
    case "micro": {
      const a = rand(0, Math.PI * 2), d = rand(2.5, 8);
      const y = Math.max(-45, Math.min(45, s.yaw + Math.cos(a) * d));
      const p = Math.max(-20, Math.min(22, s.pitch + Math.sin(a) * d));
      const t = ballAt(s, y, p, 1.0 - 0.05 * L, now);
      t.expires = now + 2000 - 100 * L;
      s.targets.push(t);
      break;
    }
    case "switch": {
      while (s.targets.length < 3) {
        let y = 0, p = 0;
        for (let k = 0; k < 30; k++) {
          y = rand(-34, 34);
          p = rand(-12, 15);
          if (s.targets.every((o) => angularDistance(yawOf(o.pos), pitchOf(o.pos), y, p) > 9) && angularDistance(s.yaw, s.pitch, y, p) > 6) break;
        }
        const t = ballAt(s, y, p, 1.6 - 0.08 * L, now);
        t.visibleAt = s.lastKillAt;
        s.targets.push(t);
      }
      break;
    }
    case "tracking": {
      const z = 11 + L * 0.5;
      const t = newTarget(s, "agent", [0, 0, z], HEAD_R, now);
      t.phase = "strafe";
      t.minX = -4.5;
      t.maxX = 4.5;
      t.vx = RUN;
      t.nextTurn = now + rand(350, 900);
      t.visibleAt = now;
      s.targets.push(t);
      break;
    }
    case "peek": {
      const spot = PEEK_SPOTS[Math.floor(Math.random() * PEEK_SPOTS.length)];
      // A borda vista do jogador, na profundidade do inimigo (perspectiva).
      const edge = spot.edge * (spot.z / spot.front);
      const hidden = edge - spot.side * 0.7;
      const t = newTarget(s, "agent", [hidden, 0, spot.z], HEAD_R, now);
      t.phase = "out";
      t.vx = spot.side * RUN * (1 + 0.04 * L);
      t.stopX = edge + spot.side * rand(0.6, 1.8);
      t.homeX = hidden;
      t.stayMs = 900 - 45 * L;
      s.targets.push(t);
      break;
    }
    case "hold": {
      const fromLeft = Math.random() < 0.5;
      const t = newTarget(s, "agent", [fromLeft ? -3 : 3, 0, 20.5], HEAD_R, now);
      t.phase = "wait";
      t.phaseAt = now + rand(900, 3200);
      t.vx = (fromLeft ? 1 : -1) * RUN * (1 + 0.06 * L);
      // Às vezes para no meio da passagem (jiggle).
      t.stopX = Math.random() < 0.3 ? rand(-0.6, 0.6) : null;
      t.stayMs = 500 - 20 * L;
      s.targets.push(t);
      break;
    }
    case "headline": {
      const roll = Math.random();
      const crate = roll < 0.25;
      const crouch = !crate && roll < 0.35;
      const head = crate ? 1.0 : crouch ? -0.65 : 0;
      let pos: V3 = [0, head, 12];
      for (let k = 0; k < 30; k++) {
        const z = rand(8, 24);
        pos = [rand(-0.62, 0.62) * z, head, z];
        if (!occluded(s, pos) && angularDistance(s.yaw, s.pitch, yawOf(pos), pitchOf(pos)) > 4) break;
      }
      const t = newTarget(s, "agent", pos, HEAD_R, now);
      t.raised = crate;
      t.phase = "up";
      t.expires = now + 1500 - 70 * L;
      s.targets.push(t);
      break;
    }
  }
}

/** Esconde um inimigo atrás das paredes? */
function occluded(s: Sim, p: V3): boolean {
  const L = len(p);
  const d: V3 = [p[0] / L, p[1] / L, p[2] / L];
  return s.walls.some((b) => {
    const t = hitBox(d, b);
    return t != null && t < L - 0.3;
  });
}

/** Caixa do corpo de um inimigo (sem a cabeça). */
function bodyBox(t: Tgt): Box {
  const [x, y, z] = t.pos;
  const crouch = y < -0.3 && !t.raised;
  return { x0: x - BODY_W, x1: x + BODY_W, y0: crouch ? FLOOR : y - 1.75, y1: y - HEAD_R * 1.1, z0: z - 0.18, z1: z + 0.18, color: "" };
}

/* ---------------------------------------------------------------- desenho */
/** Corta o polígono no plano perto da câmera (paredes que passam ao lado). */
function clipNear(q: V3[]): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const ina = a[2] >= NEAR, inb = b[2] >= NEAR;
    if (ina) out.push(a);
    if (ina !== inb) {
      const k = (NEAR - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, NEAR]);
    }
  }
  return out;
}

function poly(ctx: CanvasRenderingContext2D, c: Cam, pts: V3[], fill: string, stroke?: string) {
  const q = clipNear(pts.map((p) => toCam(c, p)));
  if (q.length < 3) return;
  ctx.beginPath();
  q.forEach((v, i) => {
    const s = screen(c, v);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function line(ctx: CanvasRenderingContext2D, c: Cam, a: V3, b: V3) {
  let p = toCam(c, a), q = toCam(c, b);
  if (p[2] < NEAR && q[2] < NEAR) return;
  if (p[2] < NEAR || q[2] < NEAR) {
    const k = (NEAR - p[2]) / (q[2] - p[2]);
    const m: V3 = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, NEAR];
    if (p[2] < NEAR) p = m;
    else q = m;
  }
  const s1 = screen(c, p), s2 = screen(c, q);
  ctx.moveTo(s1.x, s1.y);
  ctx.lineTo(s2.x, s2.y);
}

const matOf = (b: Box): Mat => b.mat ?? (b.color === CRATE ? "wood" : b.color === WALL2 ? "brick" : b.color === METAL ? "metal" : b.color === BACK ? "panel" : "plaster");

/** Mistura duas cores (#rrggbb ou rgb()) — usada para a névoa de distância. */
function mix(a: string, b: string, k: number): string {
  const rgb = (c: string) => (c.startsWith("#") ? [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)] : c.match(/\d+/g)!.slice(0, 3).map(Number));
  const x = rgb(a), y = rgb(b);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(",")})`;
}
const FOG = "#f0c9a0";

/** Linhas de textura numa face: ponto(u, v) = P + U·u + V·v (U horizontal, V vertical). */
function faceTexture(ctx: CanvasRenderingContext2D, c: Cam, P: V3, U: V3, V: V3, W: number, H: number, mat: Mat, top: boolean) {
  const at = (u: number, v: number): V3 => [P[0] + U[0] * u + V[0] * v, P[1] + U[1] * u + V[1] * v, P[2] + U[2] * u + V[2] * v];
  ctx.beginPath();
  if (mat === "brick" && !top) {
    const rh = 0.42, bw = 0.9;
    for (let v = rh, row = 0; v < H; v += rh, row++) line(ctx, c, at(0, v), at(W, v));
    for (let v = 0, row = 0; v < H; v += rh, row++) for (let u = (row % 2) * bw * 0.5 + bw; u < W; u += bw) line(ctx, c, at(u, v), at(u, Math.min(H, v + rh)));
  } else if (mat === "plaster" && !top) {
    for (const v of [1.1, 2.6]) if (v < H) line(ctx, c, at(0, v), at(W, v));
    for (let u = 2; u < W; u += 2) line(ctx, c, at(u, 0), at(u, H));
  } else if (mat === "panel" && !top) {
    for (const v of [1.4, 3.6]) if (v < H) line(ctx, c, at(0, v), at(W, v));
    for (let u = 4; u < W; u += 4) line(ctx, c, at(u, 0), at(u, H));
  } else if (mat === "wood") {
    for (let v = 0.3; v < H; v += 0.3) line(ctx, c, at(0.08, v), at(W - 0.08, v));
    if (!top) {
      line(ctx, c, at(0.12, 0.12), at(W - 0.12, H - 0.12));
      line(ctx, c, at(0.12, H - 0.12), at(W - 0.12, 0.12));
    }
  } else if (mat === "metal" && !top) {
    for (let u = 0.35; u < W; u += 0.35) line(ctx, c, at(u, 0), at(u, H));
  }
  ctx.strokeStyle = mat === "wood" ? "rgba(60,30,10,.35)" : "rgba(60,40,30,.22)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Letra pintada numa face (traços grossos), centrada em (cu, cv), altura S. */
function faceDecal(ctx: CanvasRenderingContext2D, c: Cam, P: V3, U: V3, V: V3, cu: number, cv: number, S: number, letter: string) {
  const at = (u: number, v: number): V3 => [P[0] + U[0] * u + V[0] * v, P[1] + U[1] * u + V[1] * v, P[2] + U[2] * u + V[2] * v];
  const strokes: [number, number, number, number][] =
    letter === "A"
      ? [[-0.42, -0.5, 0, 0.5], [0, 0.5, 0.42, -0.5], [-0.22, -0.08, 0.22, -0.08]]
      : [[-0.3, -0.5, -0.3, 0.5], [-0.3, 0.5, 0.25, 0.25], [0.25, 0.25, -0.3, 0], [-0.3, 0, 0.3, -0.25], [0.3, -0.25, -0.3, -0.5]];
  const t = 0.09;
  for (const [a, b, d, e] of strokes) {
    const du = d - a, dv = e - b, L = Math.hypot(du, dv) || 1;
    const nu = (-dv / L) * t, nv = (du / L) * t;
    poly(ctx, c, [at(cu + (a + nu) * S, cv + (b + nv) * S), at(cu + (d + nu) * S, cv + (e + nv) * S), at(cu + (d - nu) * S, cv + (e - nv) * S), at(cu + (a - nu) * S, cv + (b - nv) * S)], "rgba(255,206,74,.92)");
  }
}

function drawBox(ctx: CanvasRenderingContext2D, c: Cam, b: Box) {
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const dist = Math.hypot(cl(0, b.x0, b.x1), cl(0, b.y0, b.y1), cl(0, b.z0, b.z1));
  const fog = Math.max(0, Math.min(0.5, (dist - 8) / 70));
  const col = (k: number) => mix(shade(b.color, k), FOG, fog);
  const mat = matOf(b);
  const W = b.x1 - b.x0, H = b.y1 - b.y0, D = b.z1 - b.z0;
  // Luz do sol vindo da esquerda e de cima.
  poly(ctx, c, [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], col(1.16));
  faceTexture(ctx, c, [b.x0, b.y1, b.z0], [1, 0, 0], [0, 0, 1], W, D, mat, true);
  const side = (x: number, k: number, dir: 1 | -1) => {
    poly(ctx, c, [[x, b.y0, b.z0], [x, b.y1, b.z0], [x, b.y1, b.z1], [x, b.y0, b.z1]], col(k));
    faceTexture(ctx, c, dir > 0 ? [x, b.y0, b.z0] : [x, b.y0, b.z1], [0, 0, dir], [0, 1, 0], D, H, mat, false);
    poly(ctx, c, [[x, b.y0, b.z0], [x, b.y0 + 0.28, b.z0], [x, b.y0 + 0.28, b.z1], [x, b.y0, b.z1]], "rgba(40,25,20,.18)");
  };
  if (b.x0 > 0) side(b.x0, 1.04, 1);
  if (b.x1 < 0) side(b.x1, 0.8, -1);
  if (b.z0 > 0) {
    poly(ctx, c, [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]], col(0.95));
    faceTexture(ctx, c, [b.x0, b.y0, b.z0], [1, 0, 0], [0, 1, 0], W, H, mat, false);
    poly(ctx, c, [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0 + 0.28, b.z0], [b.x0, b.y0 + 0.28, b.z0]], "rgba(40,25,20,.18)");
    if (b.decal) {
      // No fundo do bomb a letra fica em frente ao pilar; na parede da entrada, perto da quina.
      const cu = W > 50 ? -b.x0 - 6 : W - 2.2;
      faceDecal(ctx, c, [b.x0, b.y0, b.z0 - 0.01], [1, 0, 0], [0, 1, 0], cu, H * 0.55, Math.min(H * 0.55, 3), b.decal);
    }
  }
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function quad(ctx: CanvasRenderingContext2D, c: Cam, x0: number, x1: number, y0: number, y1: number, z: number): boolean {
  const q = [toCam(c, [x0, y0, z]), toCam(c, [x1, y0, z]), toCam(c, [x1, y1, z]), toCam(c, [x0, y1, z])];
  if (q.some((v) => v[2] < NEAR)) return false;
  q.forEach((v, i) => {
    const p = screen(c, v);
    if (i) ctx.lineTo(p.x, p.y);
    else ctx.moveTo(p.x, p.y);
  });
  ctx.closePath();
  return true;
}

function drawAgent(ctx: CanvasRenderingContext2D, c: Cam, t: Tgt, enemy: string) {
  const b = bodyBox(t);
  if (t.raised) drawBox(ctx, c, { x0: b.x0 - 0.5, x1: b.x1 + 0.5, y0: FLOOR, y1: b.y0, z0: b.z0 - 0.4, z1: b.z1 + 0.4, color: CRATE });
  const z = b.z0;
  const x = t.pos[0];
  const top = b.y1; // pescoço
  const hip = b.y0 + (top - b.y0) * 0.48;
  const q = toCam(c, t.pos);
  if (q[2] < NEAR) return;
  const px = c.F / q[2]; // pixels por metro nessa distância
  // Silhueta: pernas, tronco, ombros e cabeça, com o contorno vermelho de inimigo.
  ctx.beginPath();
  quad(ctx, c, x - BODY_W * 0.95, x - 0.03, b.y0, hip, z);
  quad(ctx, c, x + 0.03, x + BODY_W * 0.95, b.y0, hip, z);
  quad(ctx, c, x - BODY_W, x + BODY_W, hip - 0.05, top - 0.16, z);
  quad(ctx, c, x - BODY_W - 0.08, x + BODY_W + 0.08, top - 0.42, top - 0.02, z);
  quad(ctx, c, x - 0.07, x + 0.07, top - 0.05, top + 0.04, z);
  const s = screen(c, q);
  const r = Math.max(1.5, t.rad * px);
  ctx.moveTo(s.x + r, s.y);
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  const g = ctx.createLinearGradient(0, s.y - r, 0, s.y + 1.9 * px);
  g.addColorStop(0, "#3d3650");
  g.addColorStop(1, "#1c1924");
  ctx.save();
  ctx.shadowColor = enemy;
  ctx.shadowBlur = Math.max(4, px * 0.12);
  ctx.lineWidth = Math.max(1.5, px * 0.025);
  ctx.strokeStyle = enemy;
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = g;
  ctx.fill();
  // Brilho na cabeça (ajuda a achar o ponto de mira).
  ctx.beginPath();
  ctx.arc(s.x - r * 0.3, s.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.12)";
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, c: Cam, t: Tgt, accent: string) {
  const q = toCam(c, t.pos);
  if (q[2] < NEAR) return;
  const s = screen(c, q);
  const r = Math.max(2, (t.rad / q[2]) * c.F);
  const g = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, r * 0.1, s.x, s.y, r);
  g.addColorStop(0, "#fff");
  g.addColorStop(0.35, accent);
  g.addColorStop(1, shade(accent.startsWith("#") && accent.length === 7 ? accent : "#ff48a8", 0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Céu de fim de tarde, sol com brilho e montanhas ao longe. */
function drawSky(ctx: CanvasRenderingContext2D, c: Cam, w: number, h: number, horizon: number) {
  const top = horizon - c.F * 1.2;
  const g = ctx.createLinearGradient(0, top, 0, horizon);
  g.addColorStop(0, "#2d2a6e");
  g.addColorStop(0.45, "#8f4f9a");
  g.addColorStop(0.78, "#f08a7a");
  g.addColorStop(1, "#ffcf8f");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, Math.max(0, Math.min(h, horizon)) + 1);
  // Sol.
  const sq = toCam(c, dirOf(-32, 7).map((v) => v * 500) as V3);
  if (sq[2] > NEAR) {
    const p = screen(c, sq);
    const r = c.F * 0.05;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 8);
    glow.addColorStop(0, "rgba(255,240,200,.95)");
    glow.addColorStop(0.12, "rgba(255,214,150,.75)");
    glow.addColorStop(1, "rgba(255,170,120,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - r * 8, p.y - r * 8, r * 16, r * 16);
  }
  // Montanhas (duas camadas).
  for (const [dist, col, amp, seed] of [[420, "#7a4f86", 9, 1.3], [300, "#5a3c6e", 6, 2.1]] as [number, string, number, number][]) {
    ctx.beginPath();
    let started = false;
    for (let yw = -100; yw <= 100; yw += 4) {
      const hgt = amp * (0.55 + 0.45 * Math.sin(yw * 0.09 * seed) * Math.cos(yw * 0.031 + seed));
      const q = toCam(c, dirOf(yw, Math.atan2(hgt, dist) / R).map((v) => v * dist) as V3);
      if (q[2] < NEAR) continue;
      const p = screen(c, q);
      if (!started) {
        ctx.moveTo(p.x, horizon + 2);
        started = true;
      }
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(w + 50, horizon + 2);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }
}

/** Chão de placas de pedra (com névoa perto do horizonte). */
function drawFloor(ctx: CanvasRenderingContext2D, c: Cam, w: number, h: number, horizon: number, walked: number, plantZone: boolean) {
  const y0 = Math.max(0, Math.min(h, horizon));
  const g = ctx.createLinearGradient(0, y0, 0, h);
  g.addColorStop(0, "#d9b58f");
  g.addColorStop(0.25, "#a88e74");
  g.addColorStop(1, "#6f6152");
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, w, h - y0);
  const T = 4;
  const off = walked % T;
  for (let zi = 0; zi < 13; zi++) {
    const z0 = zi * T - off - T;
    for (let xi = -6; xi < 6; xi++) {
      const x0 = xi * T;
      if ((xi + zi + Math.floor(walked / T)) % 2 === 0) continue;
      poly(ctx, c, [[x0, FLOOR, z0], [x0 + T, FLOOR, z0], [x0 + T, FLOOR, z0 + T], [x0, FLOOR, z0 + T]], "rgba(70,50,35,.10)");
    }
  }
  ctx.beginPath();
  for (let z = -off; z <= 48; z += T) line(ctx, c, [-24, FLOOR, z], [24, FLOOR, z]);
  for (let x = -24; x <= 24; x += T) line(ctx, c, [x, FLOOR, 0.2], [x, FLOOR, 48]);
  ctx.strokeStyle = "rgba(60,40,30,.22)";
  ctx.stroke();
  if (plantZone) {
    // Área de plantar do bomb (tinta laranja no chão).
    const zz = 29 - walked;
    ctx.beginPath();
    line(ctx, c, [-6, FLOOR + 0.01, zz], [6, FLOOR + 0.01, zz]);
    line(ctx, c, [6, FLOOR + 0.01, zz], [6, FLOOR + 0.01, zz + 9]);
    line(ctx, c, [6, FLOOR + 0.01, zz + 9], [-6, FLOOR + 0.01, zz + 9]);
    line(ctx, c, [-6, FLOOR + 0.01, zz + 9], [-6, FLOOR + 0.01, zz]);
    ctx.strokeStyle = "rgba(255,150,40,.85)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.lineWidth = 1;
  }
}

/** Arma em primeira pessoa com a skin escolhida, mãos com luva, recuo e clarão do tiro. */
function drawGun(ctx: CanvasRenderingContext2D, w: number, h: number, skin: WeaponSkin, since: number) {
  const u = h / 100;
  const kick = since < 140 ? 1 - since / 140 : 0;
  ctx.save();
  ctx.translate(w / 2 + 85 * u + kick * 1.8 * u, h + 4 * u + kick * 3.5 * u);
  ctx.rotate(0.36 + kick * 0.05);
  ctx.scale(u * 1.2, u * 1.2);
  ctx.lineJoin = "round";

  drawLeftArm(ctx);

  // Silhueta da arma (desenho do Goat Filter), cano para a esquerda.
  const body = new Path2D();
  body.moveTo(0, -5); body.lineTo(16, -6.2); body.lineTo(19.5, -4); body.lineTo(19.5, 4.5); body.lineTo(14, 6.5); body.lineTo(1, 3); body.closePath(); // coronha
  body.moveTo(-31, -6.4); body.lineTo(-6, -7.6); body.lineTo(1.5, -6); body.lineTo(1.5, 3); body.lineTo(-31, 2.6); body.closePath(); // corpo
  body.moveTo(-55, -5); body.lineTo(-31, -6); body.lineTo(-31, 1.8); body.lineTo(-55, 1.2); body.closePath(); // guarda-mão
  body.rect(-69, -3.5, 14.5, 2.5); // cano
  body.rect(-72.5, -4.3, 4, 4.1); // quebra-chama
  body.moveTo(-53, -5); body.lineTo(-52, -10); body.lineTo(-48.5, -10); body.lineTo(-47.5, -5.2); body.closePath(); // massa de mira
  body.moveTo(-21, 2.5); body.lineTo(-13, 2.5); body.quadraticCurveTo(-10.5, 8, -9.5, 14.5); body.lineTo(-16.5, 15.5); body.quadraticCurveTo(-17.5, 8, -21, 2.5); body.closePath(); // pente
  body.moveTo(-6, 2.6); body.lineTo(0.5, 2.6); body.lineTo(4, 12); body.lineTo(-1.5, 13); body.closePath(); // empunhadura
  const g = ctx.createLinearGradient(20, 0, -72, 0);
  g.addColorStop(0, skin.body[0]);
  g.addColorStop(1, skin.body[1]);
  if (skin.glow) {
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 12;
  }
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip(body);
  drawPattern(ctx, skin);
  if (skin.special === "dragon") dragonPanels(ctx);
  const sh = ctx.createLinearGradient(0, -10, 0, 15);
  sh.addColorStop(0, "rgba(255,255,255,.2)");
  sh.addColorStop(0.35, "rgba(255,255,255,0)");
  sh.addColorStop(1, "rgba(0,0,0,.38)");
  ctx.fillStyle = sh;
  ctx.fillRect(-74, -11, 96, 28);
  ctx.restore();
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.stroke(body);
  // Guarda-mato e gatilho.
  ctx.beginPath();
  ctx.moveTo(-12, 2.8);
  ctx.quadraticCurveTo(-10, 7.5, -5.5, 6.8);
  ctx.strokeStyle = skin.special === "dragon" ? "#e8b64a" : "rgba(20,20,24,.9)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Detalhes comuns: trilho e faixa.
  ctx.fillStyle = skin.accent;
  ctx.fillRect(-27, -9.6, 19, 2);
  if (skin.special !== "dragon") ctx.fillRect(-29, -2.2, 27, 0.9);
  if (skin.special === "dragon") dragonHead(ctx);

  drawRightHand(ctx);
  drawLeftFingers(ctx);

  // Clarão do tiro.
  if (since < 55) {
    const f = ctx.createRadialGradient(-74, -2.3, 0, -74, -2.3, 10);
    f.addColorStop(0, "rgba(255,250,220,.95)");
    f.addColorStop(0.4, "rgba(255,190,80,.6)");
    f.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(-74, -2.3, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- mãos (luva tática sem dedos) */
const GLOVE = "#26272d";
const GLOVE_HI = "#3c3e47";
const SKIN = "#d39b77";
const SLEEVE = "#3a2f5c";

function capsule(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = fill;
  ctx.lineWidth = r * 2;
  ctx.stroke();
}

/** Dedo de luva com a ponta de fora (pele). */
function finger(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number) {
  capsule(ctx, x1, y1, x2, y2, r * 1.05, "rgba(0,0,0,.45)");
  capsule(ctx, x1, y1, x2, y2, r, GLOVE);
  const k = 0.72;
  capsule(ctx, x1 + (x2 - x1) * k, y1 + (y2 - y1) * k, x2, y2, r * 0.92, SKIN);
}

function drawLeftArm(ctx: CanvasRenderingContext2D) {
  // Antebraço esquerdo saindo por baixo, até a mão no guarda-mão.
  const arm = ctx.createLinearGradient(-60, 50, -42, 4);
  arm.addColorStop(0, "#241d3b");
  arm.addColorStop(1, SLEEVE);
  ctx.beginPath();
  ctx.moveTo(-49, 5);
  ctx.lineTo(-36, 6);
  ctx.lineTo(-40, 60);
  ctx.lineTo(-70, 60);
  ctx.closePath();
  ctx.fillStyle = arm;
  ctx.fill();
  // Punho da luva.
  ctx.beginPath();
  ctx.moveTo(-50, 4);
  ctx.lineTo(-36, 5);
  ctx.lineTo(-37, 11);
  ctx.lineTo(-52, 10.5);
  ctx.closePath();
  ctx.fillStyle = GLOVE;
  ctx.fill();
  // Palma por baixo do guarda-mão.
  ctx.beginPath();
  ctx.ellipse(-44, 2.6, 7.5, 3.6, -0.05, 0, Math.PI * 2);
  ctx.fillStyle = GLOVE;
  ctx.fill();
}

function drawLeftFingers(ctx: CanvasRenderingContext2D) {
  // Dedos envolvendo o lado de cá do guarda-mão; polegar aparece por cima.
  for (const [i, x] of [-48.5, -46, -43.5, -41].entries()) finger(ctx, x + 0.6, 3, x - 0.3, -1.4 + (i === 0 ? 0.5 : 0), 0.95);
  ctx.fillStyle = GLOVE_HI;
  ctx.fillRect(-48.5, 1.4, 7.5, 0.9);
  finger(ctx, -40, -5.6, -48, -6.6, 1.0);
}

function drawRightHand(ctx: CanvasRenderingContext2D) {
  // Antebraço direito saindo pela direita de baixo.
  ctx.beginPath();
  ctx.moveTo(3, 6);
  ctx.lineTo(9, 2);
  ctx.lineTo(48, 30);
  ctx.lineTo(30, 48);
  ctx.closePath();
  const arm = ctx.createLinearGradient(5, 4, 40, 40);
  arm.addColorStop(0, SLEEVE);
  arm.addColorStop(1, "#1e1832");
  ctx.fillStyle = arm;
  ctx.fill();
  // Faixa do punho.
  ctx.beginPath();
  ctx.moveTo(4.5, 5);
  ctx.lineTo(10, 1.2);
  ctx.lineTo(13.5, 4);
  ctx.lineTo(8, 8.6);
  ctx.closePath();
  ctx.fillStyle = "#ff48a8";
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Mão fechada na empunhadura.
  ctx.beginPath();
  ctx.moveTo(-8, 1.6);
  ctx.quadraticCurveTo(-2, -0.6, 5, 1.4);
  ctx.quadraticCurveTo(9.5, 6, 6.5, 13.5);
  ctx.quadraticCurveTo(1, 16.5, -5, 14.5);
  ctx.quadraticCurveTo(-9.5, 9, -8, 1.6);
  ctx.closePath();
  const gl = ctx.createLinearGradient(0, 0, 0, 16);
  gl.addColorStop(0, GLOVE_HI);
  gl.addColorStop(1, GLOVE);
  ctx.fillStyle = gl;
  ctx.fill();
  ctx.lineWidth = 0.4;
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.stroke();
  // Nós dos dedos e placa de proteção.
  for (let i = 0; i < 3; i++) capsule(ctx, -6.5, 6 + i * 2.6, -1.5, 6.3 + i * 2.6, 0.95, i % 2 ? "#2d2f36" : "#33353d");
  ctx.fillStyle = "#575a66";
  ctx.beginPath();
  ctx.moveTo(-1, 3);
  ctx.lineTo(4, 3.5);
  ctx.lineTo(3.5, 7);
  ctx.lineTo(-1.5, 6.5);
  ctx.closePath();
  ctx.fill();
  // Indicador no gatilho.
  finger(ctx, -6.5, 3.6, -10.8, 4.9, 0.95);
}

/* ---------------------------------------------------------------- skin Dracônica */
const CRIMSON = ["#e0353f", "#8f1420"] as const;
const GOLD = "#e8b64a";

function glowLine(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, width = 0.55) {
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,.75)";
  ctx.lineWidth = width * 0.35;
  ctx.stroke();
  ctx.restore();
}

/** Painéis carmesim, escamas, frisos dourados e linhas neon (dentro da arma). */
function dragonPanels(ctx: CanvasRenderingContext2D) {
  const red = ctx.createLinearGradient(0, -8, 0, 3);
  red.addColorStop(0, CRIMSON[0]);
  red.addColorStop(1, CRIMSON[1]);
  ctx.fillStyle = red;
  ctx.beginPath();
  ctx.moveTo(-30, -6.4); ctx.lineTo(-7, -7.6); ctx.lineTo(-4, -4); ctx.lineTo(-30, -3.2); ctx.closePath(); // painel do corpo
  ctx.moveTo(2, -5.2); ctx.lineTo(16, -6.2); ctx.lineTo(19.5, -4); ctx.lineTo(19.5, 0.5); ctx.lineTo(3, -0.5); ctx.closePath(); // coronha
  ctx.moveTo(-54, 1.2); ctx.lineTo(-31, 1.8); ctx.lineTo(-31, -0.4); ctx.lineTo(-54, -0.8); ctx.closePath(); // base do guarda-mão
  ctx.fill();
  // Escamas no guarda-mão.
  for (let i = 0; i < 9; i++) {
    const x = -54 + i * 2.6;
    ctx.beginPath();
    ctx.moveTo(x, -5);
    ctx.quadraticCurveTo(x + 1.6, -6.2, x + 3, -5.2);
    ctx.quadraticCurveTo(x + 2.4, -3.2, x + 1.2, -2.6);
    ctx.quadraticCurveTo(x + 0.2, -3.4, x, -5);
    ctx.fillStyle = i % 2 ? CRIMSON[0] : "#b51f2b";
    ctx.fill();
    ctx.strokeStyle = "rgba(60,0,8,.6)";
    ctx.lineWidth = 0.25;
    ctx.stroke();
  }
  // Frisos dourados.
  ctx.fillStyle = GOLD;
  ctx.fillRect(-31.8, -7, 1.5, 10);
  ctx.fillRect(0.6, -6.2, 1.3, 9.4);
  ctx.fillRect(-72.5, -4.3, 1.6, 4.1);
  ctx.fillRect(-21, 6.5, 7.8, 0.9);
  // Linhas neon roxas e ciano.
  glowLine(ctx, [[-29, -1.4], [-17, -1.9], [-12, -0.4], [-4, -0.9]], "#b46bff");
  glowLine(ctx, [[3, 1.6], [12, 1.1], [17, 3.4]], "#b46bff");
  glowLine(ctx, [[-53, 0.2], [-42, 0.5], [-33, 0.1]], "#3ff2ff");
  glowLine(ctx, [[-18.5, 4.5], [-15.8, 9], [-14.6, 13.6]], "#3ff2ff");
  glowLine(ctx, [[-66, -2.3], [-61, -2.3]], "#3ff2ff", 0.4);
}

/** Cabeça de dragão estilizada sobre a frente do corpo, com chifres dourados e olho ciano. */
function dragonHead(ctx: CanvasRenderingContext2D) {
  // Pescoço em escamas indo para trás.
  for (let i = 0; i < 6; i++) {
    const x = -22 + i * 2.6;
    ctx.beginPath();
    ctx.moveTo(x, -7);
    ctx.quadraticCurveTo(x + 1.3, -9.6 + i * 0.25, x + 2.8, -7.2);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? "#c42634" : CRIMSON[0];
    ctx.fill();
  }
  // Chifres.
  const horn = (x: number, y: number, tx: number, ty: number, wd: number) => {
    ctx.beginPath();
    ctx.moveTo(x - wd, y);
    ctx.quadraticCurveTo((x + tx) / 2 - 1, ty + 2.5, tx, ty);
    ctx.quadraticCurveTo((x + tx) / 2 + 1, ty + 4, x + wd, y);
    ctx.closePath();
    const gg = ctx.createLinearGradient(x, y, tx, ty);
    gg.addColorStop(0, "#9c6a14");
    gg.addColorStop(1, "#ffe08a");
    ctx.fillStyle = gg;
    ctx.fill();
  };
  horn(-25.5, -12.6, -14, -19.5, 1.1);
  horn(-23, -11.8, -12.5, -15.2, 0.8);
  // Cabeça.
  ctx.beginPath();
  ctx.moveTo(-35, -8.6);
  ctx.lineTo(-32, -10.6);
  ctx.lineTo(-28.5, -11.4);
  ctx.lineTo(-25.5, -13.2);
  ctx.lineTo(-21.5, -11.8);
  ctx.lineTo(-19.5, -7.4);
  ctx.lineTo(-26, -6.6);
  ctx.lineTo(-30, -7.2);
  ctx.lineTo(-34.5, -7);
  ctx.closePath();
  const hg = ctx.createLinearGradient(-30, -13, -26, -6);
  hg.addColorStop(0, "#ff5560");
  hg.addColorStop(1, "#8f1420");
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 3;
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(70,0,10,.8)";
  ctx.lineWidth = 0.3;
  ctx.stroke();
  // Sobrancelha dourada e dentes.
  ctx.beginPath();
  ctx.moveTo(-31.5, -10.4);
  ctx.lineTo(-27.5, -11.2);
  ctx.lineTo(-25.8, -12.6);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.6;
  ctx.stroke();
  ctx.fillStyle = "#fff1c2";
  for (let i = 0; i < 4; i++) {
    const x = -34 + i * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, -7.2);
    ctx.lineTo(x + 0.45, -6.2);
    ctx.lineTo(x + 0.9, -7.15);
    ctx.fill();
  }
  // Olho ciano brilhando.
  ctx.save();
  ctx.shadowColor = "#3ff2ff";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#3ff2ff";
  ctx.beginPath();
  ctx.ellipse(-28.6, -10.1, 0.9, 0.45, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Narina.
  ctx.fillStyle = "rgba(40,0,6,.8)";
  ctx.beginPath();
  ctx.arc(-33.6, -8.8, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPattern(ctx: CanvasRenderingContext2D, skin: WeaponSkin) {
  const a = skin.accent;
  switch (skin.pattern) {
    case "stars":
      ctx.fillStyle = a;
      for (let i = 0; i < 60; i++) {
        const x = -68 + ((i * 37) % 88), y = -9 + ((i * 53) % 23);
        ctx.globalAlpha = 0.35 + ((i * 7) % 10) / 16;
        ctx.fillRect(x, y, 0.5, 0.5);
      }
      ctx.globalAlpha = 1;
      break;
    case "stripes":
      ctx.strokeStyle = a;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let x = -80; x < 30; x += 6) {
        ctx.moveTo(x, 15);
        ctx.lineTo(x + 14, -10);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    case "camo":
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = i % 3 === 0 ? a : i % 3 === 1 ? "#26301b" : "#6b7a4a";
        ctx.globalAlpha = 0.55;
        ctx.fillRect(-68 + ((i * 29) % 88), -9 + ((i * 17) % 23), 3, 2);
      }
      ctx.globalAlpha = 1;
      break;
    case "carbon":
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let x = -70; x < 20; x += 2) for (let y = -10; y < 16; y += 2) if (((x + y) / 2) % 2 === 0) ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = a;
      ctx.fillRect(-52, -1.2, 22, 0.7);
      break;
    case "petals":
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < 22; i++) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.ellipse(-66 + ((i * 41) % 86), -8 + ((i * 23) % 21), 1.4, 0.7, i, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    case "flames": {
      const f = ctx.createLinearGradient(0, 14, 0, -8);
      f.addColorStop(0, "rgba(255,210,80,.7)");
      f.addColorStop(1, "rgba(255,80,0,0)");
      ctx.fillStyle = f;
      ctx.beginPath();
      ctx.moveTo(-70, 14);
      for (let x = -70; x <= 20; x += 5) ctx.lineTo(x + 2.5, -2 - ((x * 7) % 5));
      ctx.lineTo(20, 14);
      ctx.fill();
      break;
    }
    case "frost":
      ctx.strokeStyle = a;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      for (let i = 0; i < 14; i++) {
        const x = -64 + ((i * 47) % 80), y = -6 + ((i * 13) % 16);
        for (let k = 0; k < 3; k++) {
          const ang = (k * Math.PI) / 3;
          ctx.moveTo(x - Math.cos(ang) * 2, y - Math.sin(ang) * 2);
          ctx.lineTo(x + Math.cos(ang) * 2, y + Math.sin(ang) * 2);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    default:
      break;
  }
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, s: Sim, look: { accent: string; enemy: string; xh: Rect[]; skin: WeaponSkin | null }, now: number) {
  const c = camera(s.yaw, s.pitch, w, h);
  const horizon = h / 2 + Math.tan(s.pitch * R) * c.F;
  drawSky(ctx, c, w, h, horizon);
  drawFloor(ctx, c, w, h, horizon, s.walked, s.mode === "preaim");
  // Pintor: do mais longe para o mais perto.
  // Pintor: paredes do mais longe para o mais perto; cada alvo entra logo
  // antes da primeira parede que está na frente dele.
  const cl = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const near = (b: Box) => Math.hypot(cl(0, b.x0, b.x1), cl(0, b.y0, b.y1), cl(0, b.z0, b.z1));
  /** A parede fica atrás do alvo (há um plano dela separando o alvo do lado da câmera)? */
  const behind = (b: Box, t: Tgt) => {
    const [x, , z] = t.pos, r = t.kind === "agent" ? BODY_W + 0.1 : t.rad;
    return (b.z0 > 0 && z + r <= b.z0) || (b.x0 > 0 && x + r <= b.x0) || (b.x1 < 0 && x - r >= b.x1);
  };
  type D = { draw(): void; wall?: Box };
  const order: D[] = [...s.walls].sort((a, b) => near(b) - near(a)).map((b) => ({ wall: b, draw: () => drawBox(ctx, c, b) }));
  const vis = s.targets.filter((t) => !(t.kind === "agent" && t.phase === "wait")).sort((a, b) => len(b.pos) - len(a.pos));
  for (const t of vis) {
    const d: D = { draw: () => (t.kind === "ball" ? drawBall(ctx, c, t, look.accent) : drawAgent(ctx, c, t, look.enemy)) };
    const i = order.findIndex((o) => o.wall && !behind(o.wall, t));
    if (i < 0) order.push(d);
    else order.splice(i, 0, d);
  }
  order.forEach((d) => d.draw());
  if (look.skin) drawGun(ctx, w, h, look.skin, now - s.lastShotAt);
  // Mira do jogador.
  const k = Math.max(1, h / 1080);
  ctx.save();
  ctx.translate(Math.round(w / 2), Math.round(h / 2));
  for (const r of look.xh) {
    ctx.globalAlpha = r.alpha;
    ctx.fillStyle = r.fill;
    ctx.fillRect(Math.round(r.x * k), Math.round(r.y * k), Math.max(1, Math.round(r.w * k)), Math.max(1, Math.round(r.h * k)));
  }
  ctx.globalAlpha = 1;
  // Marcador de acerto.
  const last = s.hits[s.hits.length - 1];
  if (last && now - last.at < 160) {
    ctx.strokeStyle = last.head ? "#ffd54a" : "#ffffff";
    ctx.lineWidth = 2 * Math.max(1, k * 1.5);
    const a = 8 * Math.max(1, k * 1.5), b = 16 * Math.max(1, k * 1.5);
    ctx.beginPath();
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.moveTo(sx * a, sy * a);
      ctx.lineTo(sx * b, sy * b);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- som */
let audio: AudioContext | null = null;
function blip(head: boolean) {
  try {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    audio ??= new AC();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "triangle";
    o.frequency.value = head ? 1250 : 720;
    g.gain.setValueAtTime(0.06, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.09);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.1);
  } catch {
    /* sem áudio */
  }
}

/* ================================================================ regras */
function recordShot(s: Sim, t: Tgt, now: number, head: boolean | null, timeout: boolean) {
  const vis = t.visibleAt >= 0 ? t.visibleAt : t.spawnAt;
  const aim = t.aimAtVisible ?? { yaw: s.yaw, pitch: s.pitch };
  const ty = yawOf(t.pos), tp = pitchOf(t.pos);
  const shot: Shot = {
    ms: Math.max(1, now - vis),
    react: t.reactAt != null ? t.reactAt - vis : now - vis,
    angle: t.angle0 || angularDistance(aim.yaw, aim.pitch, ty, tp),
    size: angSize(t),
    over: t.approach?.overshoot ?? false,
    corr: t.approach?.corrections ?? 0,
    miss: t.miss + s.pendingMiss,
    head: t.kind === "agent" && !timeout ? head : null,
    dx: ty - aim.yaw,
    dy: tp - aim.pitch,
    t: now - s.start - s.pausedTotal,
  };
  if (t.kind === "agent" && t.aimAtVisible && s.mode !== "tracking") {
    shot.pitchErr = t.aimAtVisible.pitch - tp;
    shot.place = s.mode === "headline" ? Math.abs(shot.pitchErr) : t.angle0;
  }
  if (timeout) shot.timeout = true;
  s.pendingMiss = 0;
  s.shots.push(shot);
}

function markVisible(s: Sim, t: Tgt, now: number) {
  if (t.visibleAt >= 0 && t.aimAtVisible) return;
  if (t.visibleAt < 0) t.visibleAt = now;
  t.aimAtVisible = { yaw: s.yaw, pitch: s.pitch };
  // Para onde a mira precisa ir: posição final do inimigo (peek) ou a atual.
  const final: V3 = t.stopX != null && s.mode === "peek" ? [t.stopX, t.pos[1], t.pos[2]] : t.pos;
  const ty = yawOf(final), tp = pitchOf(final);
  t.angle0 = angularDistance(s.yaw, s.pitch, ty, tp);
  if (s.mode !== "hold" && s.mode !== "tracking") t.approach = new Approach(s.yaw, s.pitch, ty, tp, Math.max(0.3, angSize(t)));
}

function step(s: Sim, now: number, dt: number) {
  // Movimento dos inimigos.
  for (const t of [...s.targets]) {
    if (t.kind !== "agent") continue;
    const age = now - t.phaseAt;
    switch (t.phase) {
      case "strafe": {
        if (now >= t.nextTurn || t.pos[0] < t.minX || t.pos[0] > t.maxX) {
          const dirn = t.pos[0] < t.minX ? 1 : t.pos[0] > t.maxX ? -1 : -Math.sign(t.vx) || 1;
          t.vx = dirn * RUN * rand(0.75, 1) * (1 + 0.03 * s.level);
          t.nextTurn = now + rand(280, 950 - 40 * s.level);
        }
        t.pos[0] += t.vx * dt;
        break;
      }
      case "out": {
        t.pos[0] += t.vx * dt;
        if (t.stopX != null && (t.pos[0] - t.stopX) * Math.sign(t.vx) >= 0) {
          t.pos[0] = t.stopX;
          t.phase = "stay";
          t.phaseAt = now;
        }
        break;
      }
      case "stay": {
        if (s.mode === "peek" && age > t.stayMs) {
          t.phase = "back";
          t.vx = -t.vx;
          t.phaseAt = now;
        }
        if (s.mode === "hold" && age > t.stayMs) {
          t.phase = "cross";
          t.phaseAt = now;
        }
        break;
      }
      case "back": {
        t.pos[0] += t.vx * dt;
        if ((t.pos[0] - t.homeX) * Math.sign(t.vx) >= 0) {
          recordShot(s, t, now, null, true);
          s.targets = s.targets.filter((o) => o !== t);
          s.nextAt = now + rand(500, 1300);
        }
        break;
      }
      case "wait": {
        if (now >= t.phaseAt) {
          t.phase = "cross";
          t.phaseAt = now;
        }
        break;
      }
      case "cross": {
        const before = t.pos[0];
        t.pos[0] += t.vx * dt;
        if (t.stopX != null && (before - t.stopX) * (t.pos[0] - t.stopX) <= 0) {
          t.pos[0] = t.stopX;
          t.stopX = null;
          t.phase = "stay";
          t.phaseAt = now;
        }
        if (Math.abs(t.pos[0]) > 3.4 && Math.sign(t.pos[0]) === Math.sign(t.vx)) {
          recordShot(s, t, now, null, true);
          s.targets = s.targets.filter((o) => o !== t);
          s.nextAt = now + 300;
        }
        break;
      }
    }
  }
  // Visibilidade, reação e aproximação.
  for (const t of s.targets) {
    const hidden = t.kind === "agent" && (t.phase === "wait" || occluded(s, t.pos));
    if (!hidden && !t.aimAtVisible && (s.mode !== "switch" || now >= t.visibleAt)) markVisible(s, t, now);
    if (t.visibleAt < 0 || now < t.visibleAt) continue;
    if (t.reactAt == null && t.aimAtVisible && s.speed > 30 && angularDistance(t.aimAtVisible.yaw, t.aimAtVisible.pitch, s.yaw, s.pitch) > 0.35) t.reactAt = now;
    if (t.approach) t.approach.update(s.yaw, s.pitch, s.speed, now);
  }
  // Tempo esgotado (bolas e inimigos que surgem).
  for (const t of [...s.targets]) {
    if (now > t.expires) {
      recordShot(s, t, now, null, true);
      s.targets = s.targets.filter((o) => o !== t);
      s.nextAt = now + 180;
    }
  }
  // Tracking: mede a mira em cima do inimigo a cada quadro.
  if (s.mode === "tracking" && s.targets[0]) {
    const t = s.targets[0];
    const d = dirOf(s.yaw, s.pitch);
    const onHead = hitSphere(d, t.pos, t.rad * 1.15) != null;
    const onBody = !onHead && hitBox(d, bodyBox(t)) != null;
    const ty = yawOf(t.pos);
    const tr = s.track;
    tr.frames++;
    if (onHead) tr.head++;
    if (onBody) tr.body++;
    tr.off += angularDistance(s.yaw, s.pitch, ty, pitchOf(t.pos));
    // Atraso: quanto a mira está atrás do inimigo na direção em que ele anda.
    tr.lag += -(s.yaw - ty) * Math.sign(t.vx || 1);
  }
  // Mapa: anda pela rota e para em cada checkpoint.
  if (s.mode === "preaim") {
    routeStep(s, now, dt);
    return;
  }
  // Novos alvos.
  if (now >= s.nextAt) {
    if (s.mode === "switch") spawnFor(s, now);
    else if (s.targets.length === 0) spawnFor(s, now);
  }
}

/** Anda o mundo para trás (a câmera fica parada no centro). */
function shiftWorld(s: Sim, dz: number) {
  s.walked += dz;
  for (const b of s.walls) {
    b.z0 -= dz;
    b.z1 -= dz;
  }
  for (const t of s.targets) t.pos[2] -= dz;
}

function routeStep(s: Sim, now: number, dt: number) {
  if (s.routeDone) return;
  if (s.walking) {
    const cp = ROUTE[s.cp];
    const dz = Math.min(RUN * dt, cp.z - s.walked);
    if (dz > 0) shiftWorld(s, dz);
    if (s.walked >= cp.z - 1e-3) {
      s.walking = false;
      for (const e of cp.enemies) {
        const t = newTarget(s, "agent", [e.pos[0], e.pos[1], e.pos[2] - s.walked], HEAD_R, now);
        t.raised = !!e.raised;
        t.phase = "up";
        t.expires = now + 6000;
        s.targets.push(t);
      }
    }
    return;
  }
  if (s.targets.length === 0 && now >= s.nextAt) {
    if (s.cp + 1 < ROUTE.length) {
      s.cp++;
      s.walking = true;
    } else s.routeDone = true;
  }
}

function fire(s: Sim, now: number) {
  if (s.mode === "tracking") return; // tracking não usa clique
  s.lastShotAt = now;
  s.fired++;
  const d = dirOf(s.yaw, s.pitch);
  const wallT = Math.min(...s.walls.map((b) => hitBox(d, b) ?? Infinity));
  let best: { t: Tgt; dist: number; head: boolean } | null = null;
  for (const t of s.targets) {
    if (t.kind === "agent" && t.phase === "wait") continue;
    if (t.kind === "ball") {
      const h = hitSphere(d, t.pos, t.rad);
      if (h != null && h < wallT && (!best || h < best.dist)) best = { t, dist: h, head: false };
    } else {
      const hh = hitSphere(d, t.pos, t.rad * 1.15);
      const hb = hitBox(d, bodyBox(t));
      const hit = hh != null && (hb == null || hh <= hb + 0.3) ? { dist: hh, head: true } : hb != null ? { dist: hb, head: false } : null;
      if (hit && hit.dist < wallT && (!best || hit.dist < best.dist)) best = { t, ...hit };
    }
  }
  if (!best) {
    const cur = s.targets.find((t) => t.visibleAt >= 0 && s.mode !== "switch");
    if (cur) cur.miss++;
    else s.pendingMiss++;
    return;
  }
  const { t, head } = best;
  if (t.visibleAt < 0) markVisible(s, t, now);
  if (t.kind === "agent" && !head && t.hp > 1) {
    t.hp--;
    s.hits.push({ at: now, head: false, kill: false });
    blip(false);
    return;
  }
  recordShot(s, t, now, t.kind === "agent" ? head : null, false);
  s.killsLive++;
  s.hits.push({ at: now, head: t.kind === "agent" && head, kill: true });
  if (s.hits.length > 20) s.hits.splice(0, 10);
  blip(t.kind === "agent" && head);
  s.targets = s.targets.filter((o) => o !== t);
  s.lastKillAt = now;
  if (s.mode === "switch") {
    // Os outros alvos passam a contar a partir daqui.
    for (const o of s.targets) {
      o.visibleAt = now;
      o.reactAt = null;
      o.miss = 0;
      o.aimAtVisible = null;
      markVisible(s, o, now);
    }
    spawnFor(s, now);
    const fresh = s.targets[s.targets.length - 1];
    markVisible(s, fresh, now);
  } else {
    s.nextAt = now + (s.mode === "flick" || s.mode === "micro" ? 120 : s.mode === "preaim" ? 250 : rand(450, 1100));
  }
}

/* ================================================================ componente */
type LockEl = HTMLCanvasElement & { requestPointerLock(o?: { unadjustedMovement?: boolean }): Promise<void> | void };
type Phase = "setup" | "ready" | "running" | "result" | "summary";

const SENS_KEY = "goat-filter:arena-sens";
const XH_KEY = "goat-filter:arena-xh";
const SKIN_KEY = "goat-filter:arena-skin";
const DEFAULT_XH = "0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0";

function initialSens(): number {
  try {
    const v = Number(localStorage.getItem(SENS_KEY));
    if (v > 0) return v;
  } catch {
    /* ignora */
  }
  const p = loadProfile();
  return Math.round(convertSens(p.sens, p.game, "valorant") * 1000) / 1000;
}

const TRAIN_MAP: Partial<Record<ArenaMode, TrainMode>> = { flick: "flick", micro: "micro", peek: "peek", tracking: "tracking" };

/**
 * Arena de mira 3D: mesmo campo de visão e mesmo cálculo de sensibilidade do
 * Valorant, mouse bruto. Roda um treino ou uma sequência (rotina).
 */
export function AimArena({
  mode: fixedMode,
  steps,
  title,
  onDone,
  onExit,
}: {
  mode?: ArenaMode;
  steps?: RoutineStep[];
  title?: string;
  onDone?(sessions: ArenaSession[]): void;
  onExit?(): void;
}) {
  const t = useT();
  const crosshairs = useStore((s) => s.settings.crosshairs);
  const [mode, setMode] = useState<ArenaMode>(fixedMode ?? steps?.[0]?.mode ?? "flick");
  const [sens, setSens] = useState(initialSens);
  const [xh, setXh] = useState(() => {
    try {
      return localStorage.getItem(XH_KEY) || "";
    } catch {
      return "";
    }
  });
  const [skinId, setSkinId] = useState(() => {
    try {
      return localStorage.getItem(SKIN_KEY) || "draconica";
    } catch {
      return "draconica";
    }
  });
  const changeSkin = (id: string) => {
    setSkinId(id);
    try {
      localStorage.setItem(SKIN_KEY, id);
    } catch {
      /* ignora */
    }
  };
  const plan: RoutineStep[] = useMemo(() => steps ?? [{ mode, dur: modeDuration(mode) }], [steps, mode]);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>(steps ? "ready" : "setup");
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState({ left: 0, kills: 0, acc: 100 });
  const [last, setLast] = useState<{ session: ArenaSession; record: number | null; from: number; to: number } | null>(null);
  const [done, setDone] = useState<ArenaSession[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim | null>(null);
  const raf = useRef(0);
  const ignoreUntil = useRef(0);
  const skipNext = useRef(false);
  const cur = plan[Math.min(idx, plan.length - 1)];
  if (import.meta.env.DEV) (window as unknown as { __arena?: typeof sim }).__arena = sim;

  const xhCode = xh || crosshairs[0]?.code || DEFAULT_XH;
  const xhRects = useMemo(() => {
    try {
      return crosshairRects(parseCrosshair(xhCode));
    } catch {
      return crosshairRects(parseCrosshair(DEFAULT_XH));
    }
  }, [xhCode]);

  // Laço principal.
  useEffect(() => {
    if (phase !== "running") return;
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const look = { accent: css.getPropertyValue("--accent").trim() || "#ff48a8", enemy: "#ff4655", xh: xhRects, skin: skinId === "none" ? null : skinById(skinId) };
    let hudAt = 0;
    const loop = () => {
      const s = sim.current;
      if (!s) return;
      const now = performance.now();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(el.clientWidth * dpr), h = Math.round(el.clientHeight * dpr);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - s.lastT) / 1000));
      s.speed = angularDistance(s.lastYaw, s.lastPitch, s.yaw, s.pitch) / dt;
      s.lastYaw = s.yaw;
      s.lastPitch = s.pitch;
      s.lastT = now;
      const elapsed = now - s.start - s.pausedTotal;
      if (!s.paused) {
        step(s, now, dt);
        if (elapsed >= s.dur || s.routeDone) {
          finish(s);
          return;
        }
      }
      drawScene(ctx, w, h, s, look, now);
      if (now - hudAt > 100) {
        hudAt = now;
        const hitsShots = s.shots.filter((x) => !x.timeout).length;
        const tot = hitsShots + s.shots.reduce((a, x) => a + x.miss + (x.timeout ? 1 : 0), 0) + s.pendingMiss;
        setHud({
          left: Math.max(0, s.dur - elapsed),
          kills: s.mode === "tracking" ? Math.round((s.track.head / Math.max(1, s.track.frames)) * 100) : s.killsLive,
          acc: tot ? Math.round((hitsShots / tot) * 100) : 100,
        });
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Mouse bruto → graus, como no jogo.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = sim.current;
      if (!s || s.paused || document.pointerLockElement !== canvas.current) return;
      // Logo depois de travar, o navegador às vezes manda um salto falso.
      if (skipNext.current || performance.now() < ignoreUntil.current || Math.abs(e.movementX) > 1500 || Math.abs(e.movementY) > 1500) {
        skipNext.current = false;
        return;
      }
      const d = degPerCount(s.sens);
      s.yaw += e.movementX * d;
      if (s.yaw > 180) s.yaw -= 360;
      if (s.yaw < -180) s.yaw += 360;
      s.pitch = Math.max(-88, Math.min(88, s.pitch - e.movementY * d));
    };
    const onDown = (e: MouseEvent) => {
      const s = sim.current;
      if (!s || s.paused || e.button !== 0 || document.pointerLockElement !== canvas.current) return;
      fire(s, performance.now());
    };
    const onLock = () => {
      if (document.pointerLockElement === canvas.current) {
        ignoreUntil.current = performance.now() + 120;
        skipNext.current = true;
      }
      const s = sim.current;
      if (!s || s.paused) return;
      if (document.pointerLockElement !== canvas.current) {
        s.paused = true;
        s.pausedAt = performance.now();
        setPaused(true);
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("pointerlockchange", onLock);
    };
  }, []);

  useEffect(() => () => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  async function lock() {
    const el = canvas.current as LockEl | null;
    // O salto falso pode chegar antes do aviso de "travou": ignora o começo.
    ignoreUntil.current = performance.now() + 250;
    skipNext.current = true;
    try {
      await el?.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await el?.requestPointerLock();
      } catch {
        /* sem trava (ex.: testes) */
      }
    }
  }

  function begin() {
    const m = cur.mode;
    const level = loadLevels()[m] ?? 2;
    const now = performance.now();
    sim.current = {
      mode: m,
      level,
      sens,
      yaw: 0,
      pitch: 0,
      lastYaw: 0,
      lastPitch: 0,
      lastT: now,
      speed: 0,
      start: now,
      dur: cur.dur,
      pausedAt: 0,
      pausedTotal: 0,
      paused: false,
      targets: [],
      walls: wallsFor(m),
      shots: [],
      pendingMiss: 0,
      nextAt: now + 600,
      lastKillAt: now + 600,
      ids: 0,
      hits: [],
      track: { frames: 0, head: 0, body: 0, lag: 0, off: 0 },
      fired: 0,
      killsLive: 0,
      walked: 0,
      cp: 0,
      walking: true,
      routeDone: false,
      lastShotAt: -1e9,
    };
    setPaused(false);
    setHud({ left: cur.dur, kills: 0, acc: 100 });
    setPhase("running");
    void lock();
  }

  function resume() {
    const s = sim.current;
    if (!s) return;
    s.pausedTotal += performance.now() - s.pausedAt;
    s.paused = false;
    s.lastT = performance.now();
    setPaused(false);
    void lock();
  }

  function finish(s: Sim) {
    if (document.pointerLockElement) document.exitPointerLock();
    sim.current = null;
    const fr = Math.max(1, s.track.frames);
    const session: ArenaSession = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      mode: s.mode,
      at: Date.now(),
      dur: s.mode === "preaim" ? Math.round(Math.min(s.dur, performance.now() - s.start - s.pausedTotal)) : s.dur,
      level: s.level,
      sens: s.sens,
      shots: s.shots,
      track: s.mode === "tracking" ? { onHead: s.track.head / fr, onBody: s.track.body / fr, lag: s.track.lag / fr, offset: s.track.off / fr } : undefined,
      score: 0,
    };
    session.score = sessionScore(session);
    const before = loadSessions();
    const record = bestScore(before, s.mode);
    saveSession(session);
    const to = nextLevel(s.level, session);
    saveLevel(s.mode, to);
    // Também entra no gráfico de Evolução.
    const tm = TRAIN_MAP[s.mode];
    if (tm) {
      const st = sessionStats(session);
      saveResult(
        tm === "tracking"
          ? { mode: tm, score: Math.round((session.track?.onHead ?? 0) * 100), at: session.at }
          : { mode: tm, score: st.kills, accuracy: Math.round(st.accuracy * 100), avgMs: Math.round(st.medianMs ?? 0), at: session.at },
      );
    }
    const all = [...done, session];
    setDone(all);
    setLast({ session, record, from: s.level, to });
    setPhase("result");
  }

  function next() {
    if (idx + 1 < plan.length) {
      setIdx(idx + 1);
      setPhase("ready");
    } else {
      setPhase(plan.length > 1 ? "summary" : "setup");
      onDone?.(done);
      if (plan.length === 1) setIdx(0);
    }
  }

  function stop() {
    const s = sim.current;
    if (s) finish(s);
  }

  const changeSens = (v: number) => {
    setSens(v);
    try {
      if (v > 0) localStorage.setItem(SENS_KEY, String(v));
    } catch {
      /* ignora */
    }
  };
  const changeXh = (code: string) => {
    setXh(code);
    try {
      localStorage.setItem(XH_KEY, code);
    } catch {
      /* ignora */
    }
  };

  const level = loadLevels()[cur.mode] ?? 2;

  return (
    <div className="arena">
      {phase === "setup" && !fixedMode && (
        <div className="arena-setup">
          <div className="seg" role="radiogroup" aria-label={t("Modo do treino")}>
            {(Object.keys(MODE_LABEL) as ArenaMode[]).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                {t(MODE_LABEL[m])}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="finder-stage arena-stage">
        <canvas ref={canvas} className="finder-canvas" aria-label={t("Arena de treino")} />
        {(phase === "setup" || phase === "ready") && (
          <div className="finder-overlay">
            {plan.length > 1 && <span className="finder-step">{t("{title} · treino {i} de {n}", { title: title ?? t("Rotina"), i: idx + 1, n: plan.length })}</span>}
            <strong>{t(MODE_LABEL[cur.mode])}</strong>
            <p>{t(MODE_HELP[cur.mode])}</p>
            <p className="note">
              {t("{s} s · nível {l} · clique para travar o mouse, Esc pausa", { s: Math.round(cur.dur / 1000), l: level })}
            </p>
            <div className="arena-opts">
              <label>
                {t("Sensibilidade do Valorant")}
                <input
                  type="number"
                  min={0.05}
                  max={5}
                  step={0.001}
                  value={sens}
                  onChange={(e) => changeSens(Number(e.target.value))}
                  aria-label={t("Sensibilidade do Valorant")}
                />
              </label>
              <label>
                {t("Skin da arma")}
                <select value={skinId} onChange={(e) => changeSkin(e.target.value)} aria-label={t("Skin da arma")}>
                  {WEAPON_SKINS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {t(k.name)}
                    </option>
                  ))}
                  <option value="none">{t("Sem arma")}</option>
                </select>
              </label>
              {crosshairs.length > 0 && (
                <label>
                  {t("Mira")}
                  <select value={xhCode} onChange={(e) => changeXh(e.target.value)} aria-label={t("Mira")}>
                    {crosshairs.map((c) => (
                      <option key={c.id} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                    <option value={DEFAULT_XH}>{t("Padrão")}</option>
                  </select>
                </label>
              )}
            </div>
            <div className="finder-choices">
              {onExit && (
                <button type="button" className="btn" onClick={onExit}>
                  {t("Voltar")}
                </button>
              )}
              <button type="button" className="btn primary" onClick={begin} disabled={!(sens > 0)}>
                {t("Começar")}
              </button>
            </div>
          </div>
        )}
        {phase === "running" && paused && (
          <div className="finder-overlay">
            <strong>{t("Pausado")}</strong>
            <div className="finder-choices">
              <button type="button" className="btn" onClick={stop}>{t("Encerrar")}</button>
              <button type="button" className="btn primary" onClick={resume}>{t("Continuar")}</button>
            </div>
          </div>
        )}
        {phase === "running" && !paused && (
          <div className="arena-hud" aria-live="off">
            <span>{(hud.left / 1000).toFixed(1)}s</span>
            <span>{cur.mode === "tracking" ? t("{p}% na cabeça", { p: hud.kills }) : t("{n} abates", { n: hud.kills })}</span>
            {cur.mode !== "tracking" && <span>{t("{p}% precisão", { p: hud.acc })}</span>}
            {cur.mode === "preaim" && <span>{t("{n} inimigos na rota", { n: ROUTE_TOTAL })}</span>}
          </div>
        )}
        {phase === "result" && last && <ResultCard {...last} hasNext={idx + 1 < plan.length} onNext={next} onAgain={() => setPhase("ready")} single={plan.length === 1} />}
        {phase === "summary" && (
          <div className="finder-overlay">
            <span className="finder-step">{title ?? t("Rotina")}</span>
            <strong>{t("Rotina completa!")}</strong>
            <p>{t("{n} treinos, {k} abates. Seu perfil de mira foi atualizado.", { n: done.length, k: done.reduce((a, x) => a + sessionStats(x).kills, 0) })}</p>
            <div className="finder-choices">
              {onExit && (
                <button type="button" className="btn primary" onClick={onExit}>
                  {t("Ver meu perfil")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({
  session,
  record,
  from,
  to,
  hasNext,
  single,
  onNext,
  onAgain,
}: {
  session: ArenaSession;
  record: number | null;
  from: number;
  to: number;
  hasNext: boolean;
  single: boolean;
  onNext(): void;
  onAgain(): void;
}) {
  const t = useT();
  const st = sessionStats(session);
  const newRecord = record == null || session.score > record;
  const tips = coach(buildProfile([session])).slice(0, 2);
  const chips: [string, string][] =
    session.mode === "tracking"
      ? [
          [t("Na cabeça"), `${Math.round((session.track?.onHead ?? 0) * 100)}%`],
          [t("No corpo"), `${Math.round((session.track?.onBody ?? 0) * 100)}%`],
          [t("Atraso médio"), `${(session.track?.lag ?? 0).toFixed(1)}°`],
        ]
      : [
          [t("Abates"), String(st.kills)],
          [t("Precisão"), `${Math.round(st.accuracy * 100)}%`],
          ...(st.headRate != null ? ([[t("Na cabeça"), `${Math.round(st.headRate * 100)}%`]] as [string, string][]) : []),
          ...(st.medianMs != null ? ([[t("Tempo por alvo"), `${Math.round(st.medianMs)} ms`]] as [string, string][]) : []),
          ...(st.react != null && (session.mode === "peek" || session.mode === "hold") ? ([[t("Reação"), `${Math.round(st.react)} ms`]] as [string, string][]) : []),
          ...(st.place != null ? ([[t("Mira longe da cabeça"), `${st.place.toFixed(1)}°`]] as [string, string][]) : []),
          ...(session.mode === "preaim" ? ([[t("Tempo da rota"), `${(session.dur / 1000).toFixed(2)} s`]] as [string, string][]) : []),
          ...(session.mode === "flick" || session.mode === "micro" || session.mode === "switch"
            ? ([[t("Passou do alvo"), `${Math.round(st.overRate * 100)}%`]] as [string, string][])
            : []),
        ];
  return (
    <div className="finder-overlay arena-result">
      <span className="finder-step">{t(MODE_LABEL[session.mode])}</span>
      <strong className="finder-big">{session.score}</strong>
      <p className="note">
        {newRecord ? t("Novo recorde!") : t("Recorde: {n}", { n: record ?? 0 })}
        {" · "}
        {to > from ? t("Subiu para o nível {n}", { n: to }) : to < from ? t("Nível ajustado para {n}", { n: to }) : t("Nível {n}", { n: to })}
      </p>
      <div className="arena-chips">
        {chips.map(([k, v]) => (
          <span key={k}>
            <b>{v}</b>
            {k}
          </span>
        ))}
      </div>
      {tips.length > 0 && <InsightList items={tips} compact />}
      <div className="finder-choices">
        {single && (
          <button type="button" className="btn" onClick={onAgain}>
            {t("De novo")}
          </button>
        )}
        <button type="button" className="btn primary" onClick={onNext}>
          {hasNext ? t("Próximo treino") : single ? t("Outro modo") : t("Concluir")}
        </button>
      </div>
    </div>
  );
}
