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

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  color: string;
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
const WALL = "#3a3350";
const WALL2 = "#2e2942";
const CRATE = "#4a3c2c";

function wallsFor(mode: ArenaMode): Box[] {
  const back: Box = { x0: -60, x1: 60, y0: FLOOR, y1: 6, z0: 42, z1: 43, color: "#221d33" };
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
  box(-60, 60, 48, 49, 7, "#221d33"), // fundo do bomb
  box(-3.1, -2.4, -2, 19, 4.2), // parede esquerda do corredor
  box(2.4, 3.1, -2, 14, 4.2), // parede direita (acaba na janela)
  box(3.1, 12, 18.6, 19.3, 4.2, WALL2), // fundo da janela
  box(-30, -3.1, 18.6, 19.3, 4.2, WALL2), // parede da entrada do bomb
  box(-8, -5, 26, 29, 1.2, CRATE), // caixa baixa
  box(4, 7, 30, 33, 2.4, CRATE), // caixa alta
  box(-1, 1, 34, 36, 4.2, WALL2), // pilar
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

function drawBox(ctx: CanvasRenderingContext2D, c: Cam, b: Box) {
  // Topo e frente (o jogador sempre olha de frente para o cenário).
  poly(ctx, c, [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]], shade(b.color, 1.25));
  if (b.x0 > 0) poly(ctx, c, [[b.x0, b.y0, b.z0], [b.x0, b.y1, b.z0], [b.x0, b.y1, b.z1], [b.x0, b.y0, b.z1]], shade(b.color, 0.8));
  if (b.x1 < 0) poly(ctx, c, [[b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x1, b.y0, b.z1]], shade(b.color, 0.8));
  poly(ctx, c, [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0]], b.color, "rgba(255,255,255,.06)");
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

/** Arma em primeira pessoa com a skin escolhida, recuo e clarão do tiro. */
function drawGun(ctx: CanvasRenderingContext2D, w: number, h: number, skin: WeaponSkin, since: number) {
  const u = h / 100;
  const kick = since < 140 ? 1 - since / 140 : 0;
  ctx.save();
  ctx.translate(w / 2 + 96 * u + kick * 1.5 * u, h + 1 * u + kick * 3 * u);
  ctx.rotate(0.28 + kick * 0.05);
  ctx.scale(u * 1.25, u * 1.25);
  const rr = (x: number, y: number, wd: number, ht: number, r: number) => {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + wd, y, x + wd, y + ht, r);
    ctx.arcTo(x + wd, y + ht, x, y + ht, r);
    ctx.arcTo(x, y + ht, x, y, r);
    ctx.arcTo(x, y, x + wd, y, r);
    ctx.closePath();
  };
  // Silhueta (cano para a esquerda).
  ctx.beginPath();
  rr(0, -5, 18, 8, 2.5); // coronha
  rr(-30, -7, 31, 9, 1.5); // corpo
  rr(-53, -5.5, 24, 6, 1.2); // guarda-mão
  rr(-67, -3.6, 15, 2.6, 0.8); // cano
  ctx.moveTo(-20, 2);
  ctx.lineTo(-12, 2);
  ctx.lineTo(-10, 13);
  ctx.lineTo(-17, 14);
  ctx.closePath(); // pente
  ctx.moveTo(-6, 2);
  ctx.lineTo(0, 2);
  ctx.lineTo(3, 12);
  ctx.lineTo(-2, 12.5);
  ctx.closePath(); // empunhadura
  const g = ctx.createLinearGradient(18, 0, -67, 0);
  g.addColorStop(0, skin.body[0]);
  g.addColorStop(1, skin.body[1]);
  if (skin.glow) {
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 14;
  }
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = "rgba(0,0,0,.6)";
  ctx.stroke();
  // Padrão por cima, só dentro da arma.
  ctx.save();
  ctx.clip();
  drawPattern(ctx, skin);
  // Luz de cima.
  const sh = ctx.createLinearGradient(0, -9, 0, 14);
  sh.addColorStop(0, "rgba(255,255,255,.22)");
  sh.addColorStop(0.35, "rgba(255,255,255,0)");
  sh.addColorStop(1, "rgba(0,0,0,.35)");
  ctx.fillStyle = sh;
  ctx.fillRect(-70, -10, 92, 26);
  ctx.restore();
  // Detalhes: faixa, trilho e mira de cima.
  ctx.fillStyle = skin.accent;
  ctx.fillRect(-29, -2.2, 27, 0.9);
  ctx.fillRect(-27, -9, 20, 2);
  ctx.fillRect(-50, -7.4, 3, 2);
  ctx.globalAlpha = 0.85;
  ctx.fillRect(-66, -3.1, 2, 1.6);
  ctx.globalAlpha = 1;
  // Clarão do tiro.
  if (since < 55) {
    const f = ctx.createRadialGradient(-69, -2.3, 0, -69, -2.3, 9);
    f.addColorStop(0, "rgba(255,250,220,.95)");
    f.addColorStop(0.4, "rgba(255,190,80,.6)");
    f.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = f;
    ctx.beginPath();
    ctx.arc(-69, -2.3, 9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, "#151127");
  sky.addColorStop(1, "#3a2f5a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1d1a26";
  ctx.fillRect(0, Math.max(0, Math.min(h, horizon)), w, h);
  // Grade do chão (dá noção de distância).
  ctx.beginPath();
  ctx.strokeStyle = "rgba(255,255,255,.05)";
  const off = s.walked % 2;
  for (let z = 2 - off; z <= 48; z += 2) line(ctx, c, [-40, FLOOR, z], [40, FLOOR, z]);
  for (let x = -40; x <= 40; x += 2) line(ctx, c, [x, FLOOR, 1], [x, FLOOR, 48]);
  ctx.stroke();
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
      return localStorage.getItem(SKIN_KEY) || "goat-neon";
    } catch {
      return "goat-neon";
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
