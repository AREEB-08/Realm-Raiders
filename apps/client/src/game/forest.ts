import Phaser from 'phaser';
import { GRID } from '@realm/game-data';
import { iso } from './iso';
import { FOREST_PATH, forestLayout } from './forest-layout';

export { FOREST_PATH, forestLayout };

/**
 * The forest around the island (spec F2): a tileable grass floor (one quad), a dirt path to the
 * island's edge, rocks, and a dense ring of layered trees — pines and broadleaf in three shades
 * with soft shadows. Every tree and rock comes from ONE canvas atlas, so the few hundred sprites
 * batch into a handful of draw calls (FPS ≥ 50 on a mid-range phone). Decoration only: nothing
 * here is part of the battle grid. All art is drawn in code.
 */

export type ForestLook = 'day' | 'night' | 'dawn';

const OUT = '#1a1208';
type Frame = { key: string; x: number; y: number; w: number; h: number; ox: number; oy: number };

let seed = 0x5eed;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

const PINE_SHADES = [
  ['#2f6b3a', '#3f8a46', '#245430'],
  ['#3a7d3c', '#55a04c', '#2a5e2e'],
  ['#28583a', '#357048', '#1d4429'],
] as const;
const LEAF_SHADES = [
  ['#4f9a3a', '#76c04e', '#3a7a2c'],
  ['#3f8a3c', '#62ad4a', '#2f6b2e'],
  ['#6aa63a', '#94cc56', '#4f8a2c'],
] as const;

function shadow(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) {
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, rx);
  g.addColorStop(0, 'rgba(10,25,10,0.42)');
  g.addColorStop(1, 'rgba(10,25,10,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shade: readonly string[]) {
  const cx = x + w / 2;
  const base = y + h - 10;
  shadow(ctx, cx + 6, base, w * 0.42, w * 0.16);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUT;
  ctx.fillStyle = '#6b4424';
  ctx.fillRect(cx - 5, base - 18, 10, 18);
  ctx.strokeRect(cx - 5, base - 18, 10, 18);
  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const tw = w * (0.9 - i * 0.22);
    const top = y + 6 + i * (h * 0.2);
    const bot = base - 12 - i * (h * 0.16);
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx + tw / 2, bot);
    ctx.quadraticCurveTo(cx, bot + 8, cx - tw / 2, bot);
    ctx.closePath();
    ctx.fillStyle = shade[0]!;
    ctx.fill();
    ctx.stroke();
    // light side + rim
    ctx.beginPath();
    ctx.moveTo(cx, top + 4);
    ctx.lineTo(cx - tw / 2 + 6, bot - 2);
    ctx.quadraticCurveTo(cx - tw / 4, bot + 2, cx - 2, bot + 2);
    ctx.closePath();
    ctx.fillStyle = shade[1]!;
    ctx.fill();
    ctx.fillStyle = shade[2]!;
    ctx.fillRect(cx + tw / 6, bot - 6, tw / 4, 3);
  }
}

function broadleaf(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, shade: readonly string[]) {
  const cx = x + w / 2;
  const base = y + h - 10;
  shadow(ctx, cx + 6, base, w * 0.46, w * 0.17);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUT;
  ctx.fillStyle = '#7a4c28';
  ctx.beginPath();
  ctx.moveTo(cx - 6, base);
  ctx.lineTo(cx - 4, base - h * 0.42);
  ctx.lineTo(cx + 4, base - h * 0.42);
  ctx.lineTo(cx + 7, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const blobs: [number, number, number][] = [
    [-0.22, 0.45, 0.27],
    [0.22, 0.45, 0.27],
    [0, 0.3, 0.32],
    [-0.12, 0.2, 0.22],
    [0.16, 0.22, 0.2],
  ];
  // outline pass, then fill pass, so the crown reads as one shape
  for (const pass of [0, 1]) {
    for (const [bx, by, br] of blobs) {
      ctx.beginPath();
      ctx.arc(cx + bx * w, y + by * h, br * w + (pass ? 0 : 3), 0, Math.PI * 2);
      ctx.fillStyle = pass ? shade[0]! : OUT;
      ctx.fill();
    }
  }
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(cx + bx * w - br * w * 0.25, y + by * h - br * w * 0.25, br * w * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = shade[1]!;
    ctx.fill();
  }
  ctx.fillStyle = shade[2]!;
  ctx.beginPath();
  ctx.ellipse(cx + w * 0.12, y + h * 0.55, w * 0.18, w * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
}

function rock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number) {
  const cx = x + w / 2;
  const base = y + h - 8;
  shadow(ctx, cx + 4, base, w * 0.45, w * 0.14);
  ctx.lineWidth = 3;
  ctx.strokeStyle = OUT;
  ctx.beginPath();
  const pts = k === 0 ? [-0.42, 0, -0.3, -0.55, 0.05, -0.75, 0.38, -0.45, 0.45, 0] : [-0.45, 0, -0.35, -0.4, -0.05, -0.55, 0.3, -0.62, 0.45, -0.2, 0.4, 0];
  ctx.moveTo(cx + pts[0]! * w, base + pts[1]! * h);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cx + pts[i]! * w, base + pts[i + 1]! * h);
  ctx.closePath();
  ctx.fillStyle = '#8b949c';
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#c1c8cd';
  ctx.beginPath();
  ctx.moveTo(cx - 0.28 * w, base - 0.45 * h);
  ctx.lineTo(cx + 0.02 * w, base - 0.66 * h);
  ctx.lineTo(cx + 0.1 * w, base - 0.4 * h);
  ctx.closePath();
  ctx.fill();
}

/** Paint the shared atlas once: 3 pines, 3 broadleaf, 2 rocks. */
function paintAtlas(): { canvas: HTMLCanvasElement; frames: Frame[] } {
  const cells: { key: string; w: number; h: number; draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void }[] = [];
  PINE_SHADES.forEach((s, i) => cells.push({ key: `pine${i}`, w: 92, h: 150, draw: (ctx, x, y) => pine(ctx, x, y, 92, 150, s) }));
  LEAF_SHADES.forEach((s, i) => cells.push({ key: `leaf${i}`, w: 110, h: 130, draw: (ctx, x, y) => broadleaf(ctx, x, y, 110, 130, s) }));
  cells.push({ key: 'rock0', w: 70, h: 52, draw: (ctx, x, y) => rock(ctx, x, y, 70, 52, 0) });
  cells.push({ key: 'rock1', w: 90, h: 50, draw: (ctx, x, y) => rock(ctx, x, y, 90, 50, 1) });
  const W = cells.reduce((s, c) => s + c.w + 4, 0);
  const H = Math.max(...cells.map((c) => c.h));
  const [c, ctx] = canvas(W, H);
  const frames: Frame[] = [];
  let x = 0;
  for (const cell of cells) {
    cell.draw(ctx, x, H - cell.h);
    frames.push({ key: cell.key, x, y: H - cell.h, w: cell.w, h: cell.h, ox: 0.5, oy: (cell.h - 10) / cell.h });
    x += cell.w + 4;
  }
  return { canvas: c, frames };
}

/** A tileable patch of forest floor (grass, clover, darker tufts). */
function paintFloor(): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = '#3d7a34';
  ctx.fillRect(0, 0, W, H);
  seed = 0x1f1f;
  const wrap = (f: (dx: number, dy: number) => void) => {
    for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) f(dx, dy);
  };
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 16 + rnd() * 30;
    const dark = rnd() < 0.5;
    wrap((dx, dy) => {
      const g = ctx.createRadialGradient(x + dx, y + dy, 1, x + dx, y + dy, r);
      g.addColorStop(0, dark ? 'rgba(25,60,25,0.35)' : 'rgba(120,180,80,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
    });
  }
  for (let i = 0; i < 380; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const col = rnd() < 0.6 ? '#2f6329' : rnd() < 0.5 ? '#5d9a44' : '#77b052';
    wrap((dx, dy) => {
      ctx.fillStyle = col;
      ctx.fillRect(x + dx, y + dy, 2, 4);
    });
  }
  for (let i = 0; i < 10; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const col = rnd() < 0.5 ? '#f3e7a0' : '#e7a0c0';
    wrap((dx, dy) => {
      ctx.fillStyle = col;
      ctx.fillRect(x + dx, y + dy, 3, 3);
    });
  }
  return c;
}

const TINT: Record<ForestLook, number> = { day: 0xffffff, night: 0x6a78b8, dawn: 0xffc8b0 };

/**
 * Build the forest under the island. Returns the objects (destroyed on a look change).
 * Depth: floor −1000, path −950 (both under the island ground at −800); trees sort by their base.
 */
export function buildForest(scene: Phaser.Scene, look: ForestLook, bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const objs: Phaser.GameObjects.GameObject[] = [];
  if (!scene.textures.exists('forest:floor')) scene.textures.addCanvas('forest:floor', paintFloor());
  if (!scene.textures.exists('forest:atlas')) {
    const a = paintAtlas();
    const tex = scene.textures.addCanvas('forest:atlas', a.canvas)!;
    for (const f of a.frames) tex.add(f.key, 0, f.x, f.y, f.w, f.h);
    scene.registry.set('forest:frames', a.frames);
  }
  const frames = scene.registry.get('forest:frames') as Frame[];
  const pad = 1400;
  const floor = scene.add
    .tileSprite(bounds.minX - pad, bounds.minY - pad, bounds.maxX - bounds.minX + pad * 2, bounds.maxY - bounds.minY + pad * 2, 'forest:floor')
    .setOrigin(0, 0)
    .setDepth(-1000)
    .setTint(TINT[look]);
  objs.push(floor);

  // Dirt path: a wide dark edge, the dirt, and a lighter worn centre.
  const g = scene.add.graphics().setDepth(-950);
  const pts = FOREST_PATH.map((p) => iso(p.x, p.y));
  for (const [w, col] of [
    [70, 0x5a3d1e],
    [60, 0x9b7444],
    [26, 0xb8935a],
  ] as const) {
    g.lineStyle(w, col, 1);
    g.beginPath();
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.strokePath();
    for (const p of pts) g.fillStyle(col, 1).fillCircle(p.x, p.y, w / 2);
  }
  if (look !== 'day') g.setAlpha(0.75);
  objs.push(g);

  // Soft shade on the forest floor right around the island (ambient occlusion).
  const ring = scene.add.graphics().setDepth(-900);
  const T = iso(0, 0);
  const Rr = iso(GRID, 0);
  const B = iso(GRID, GRID);
  const L = iso(0, GRID);
  for (let i = 0; i < 6; i++) {
    const k = 28 - i * 4;
    ring.fillStyle(0x0c2410, 0.06);
    ring.fillPoints(
      [
        { x: T.x, y: T.y - k },
        { x: Rr.x + k * 2, y: Rr.y },
        { x: B.x, y: B.y + 34 + k },
        { x: L.x - k * 2, y: L.y },
      ] as unknown as Phaser.Math.Vector2[],
      true,
      true,
    );
  }
  objs.push(ring);

  const byKey = new Map(frames.map((f) => [f.key, f]));
  for (const t of forestLayout()) {
    const f = byKey.get(t.frame)!;
    const p = iso(t.x, t.y);
    const img = scene.add
      .image(p.x, p.y, 'forest:atlas', t.frame)
      .setOrigin(f.ox, f.oy)
      .setScale(t.scale)
      .setFlipX(t.flip)
      .setDepth(p.y)
      .setTint(TINT[look]);
    objs.push(img);
  }
  return objs;
}
