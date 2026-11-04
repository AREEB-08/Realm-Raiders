/**
 * Procedural art (original): every building, troop, projectile and the island itself is painted
 * with Canvas 2D at runtime, then handed to Phaser as a texture. No image files ship in the APK.
 * Style: low-poly diorama — flat-shaded iso prisms, warm timber and cold stone, ember accents.
 */
import { BUILDINGS, GRID, SHORE, type BuildingId, type TroopId } from '@realm/game-data';
import { TH, TW } from './iso';

type Ctx = CanvasRenderingContext2D;

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amt > 0 ? (255 - c) * amt : c * amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

function poly(ctx: Ctx, pts: number[], fill: string, stroke?: string) {
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Iso box: base diamond (half-width hw, half-height hh) centred at (cx, cy), raised H px. */
function box(ctx: Ctx, cx: number, cy: number, hw: number, hh: number, H: number, col: string, topCol?: string) {
  const top = topCol ?? shade(col, 0.18);
  poly(ctx, [cx - hw, cy - H, cx, cy + hh - H, cx, cy + hh, cx - hw, cy], shade(col, -0.18));
  poly(ctx, [cx, cy + hh - H, cx + hw, cy - H, cx + hw, cy, cx, cy + hh], shade(col, -0.36));
  poly(ctx, [cx, cy - hh - H, cx + hw, cy - H, cx, cy + hh - H, cx - hw, cy - H], top);
}

function pyramid(ctx: Ctx, cx: number, cy: number, hw: number, hh: number, base: number, peak: number, col: string) {
  const apexY = cy - base - peak;
  poly(ctx, [cx - hw, cy - base, cx, cy - hh - base, cx, apexY], shade(col, 0.1));
  poly(ctx, [cx, cy - hh - base, cx + hw, cy - base, cx, apexY], shade(col, -0.1));
  poly(ctx, [cx - hw, cy - base, cx, cy + hh - base, cx, apexY], shade(col, -0.05));
  poly(ctx, [cx, cy + hh - base, cx + hw, cy - base, cx, apexY], shade(col, -0.32));
}

function cylinder(ctx: Ctx, cx: number, cy: number, r: number, H: number, col: string) {
  const ry = r / 2;
  const g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
  g.addColorStop(0, shade(col, -0.05));
  g.addColorStop(0.55, shade(col, -0.25));
  g.addColorStop(1, shade(col, -0.5));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - r, cy - H);
  ctx.ellipse(cx, cy - H, r, ry, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(col, 0.2);
  ctx.beginPath();
  ctx.ellipse(cx, cy - H, r, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function cone(ctx: Ctx, cx: number, cy: number, r: number, H: number, col: string) {
  ctx.fillStyle = shade(col, -0.15);
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r / 2, 0, 0, Math.PI);
  ctx.lineTo(cx, cy - H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(col, 0.1);
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx, cy - H);
  ctx.lineTo(cx, cy + r / 2);
  ctx.closePath();
  ctx.fill();
}

function flag(ctx: Ctx, x: number, y: number, h: number, col: string) {
  ctx.strokeStyle = '#3a2b1c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - h);
  ctx.stroke();
  poly(ctx, [x, y - h, x + 14, y - h + 4, x + 11, y - h + 9, x, y - h + 10], col);
}

function glow(ctx: Ctx, x: number, y: number, r: number, col: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, col);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function windows(ctx: Ctx, cx: number, cy: number, hw: number, H: number, n: number, col = '#ffcf6b') {
  ctx.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const x = cx + hw * t;
    const y = cy - H * 0.55 + (hw * t) / 2 - hw / 2 + hw / 2;
    ctx.fillRect(x - 2, y - H * 0.15, 3, 5);
  }
}

const STONE = '#8d8a83';
const DARKSTONE = '#5f5d59';
const TIMBER = '#8a5a34';
const ROOF = '#7a2f24';
const SLATE = '#4a5866';

export interface BuildingArt {
  canvas: HTMLCanvasElement;
  /** Where the footprint centre sits inside the texture (0..1). */
  originX: number;
  originY: number;
}

/** Paint one building at one level. `banner` is the owner's faction colour. */
export function paintBuilding(type: BuildingId, level: number, banner: string): BuildingArt {
  const s = BUILDINGS[type].size;
  const hwF = (s * TW) / 2;
  const hhF = (s * TH) / 2;
  const tall = 34 + s * 26 + level * 4;
  const W = s * TW + 28;
  const Hc = s * TH + tall + 30;
  const [c, ctx] = canvas(W, Hc);
  const cx = W / 2;
  const cy = Hc - hhF - 8;
  // contact shadow
  ctx.fillStyle = 'rgba(10,20,10,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 4, cy + 3, hwF * 0.92, hhF * 0.92, 0, 0, Math.PI * 2);
  ctx.fill();
  const trim = level >= 4 ? '#e8c35a' : level >= 2 ? '#b38a3c' : null;
  const k = 0.82;
  const hw = hwF * k;
  const hh = hhF * k;
  switch (type) {
    case 'citadel': {
      box(ctx, cx, cy, hw, hh, 18, DARKSTONE);
      box(ctx, cx, cy - 18, hw * 0.72, hh * 0.72, 30 + level * 4, STONE);
      const H = 48 + level * 4;
      pyramid(ctx, cx, cy, hw * 0.74, hh * 0.74, H, 30, SLATE);
      for (const [dx, dy] of [
        [-hw * 0.92, 0],
        [hw * 0.92, 0],
        [0, hh * 0.92],
      ] as const) {
        cylinder(ctx, cx + dx, cy + dy - 4, 13, 58 + level * 3, STONE);
        cone(ctx, cx + dx, cy + dy - 62 - level * 3, 15, 22, ROOF);
      }
      windows(ctx, cx - hw * 0.7, cy - 18, hw * 0.7, 30, 3);
      flag(ctx, cx, cy - H - 30, 26, banner);
      if (trim) {
        ctx.strokeStyle = trim;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - hw * 0.72, cy - 18 - 30 - level * 4);
        ctx.lineTo(cx, cy - 18 - 30 - level * 4 + hh * 0.72);
        ctx.lineTo(cx + hw * 0.72, cy - 18 - 30 - level * 4);
        ctx.stroke();
      }
      break;
    }
    case 'goldworks': {
      box(ctx, cx, cy, hw, hh, 22, '#7a6a55');
      pyramid(ctx, cx, cy, hw, hh, 22, 16, ROOF);
      cylinder(ctx, cx + hw * 0.45, cy - 8, 8, 56, DARKSTONE);
      glow(ctx, cx - hw * 0.35, cy - 6, 16, 'rgba(255,190,70,0.9)');
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.ellipse(cx - hw * 0.35, cy - 4, 7, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'treasury': {
      box(ctx, cx, cy, hw, hh, 30 + level * 2, STONE);
      box(ctx, cx, cy - 30 - level * 2, hw * 0.95, hh * 0.95, 6, '#b8923f', '#e8c35a');
      for (const t of [0.3, 0.7]) {
        ctx.fillStyle = '#c8a04a';
        ctx.fillRect(cx - hw + hw * t * 2 - 2, cy - 30 + hh * (t - 0.5), 4, 24);
      }
      ctx.fillStyle = '#2b2116';
      ctx.fillRect(cx + hw * 0.35, cy - 18, 8, 14);
      break;
    }
    case 'lumbercamp': {
      box(ctx, cx - hw * 0.15, cy - hh * 0.1, hw * 0.7, hh * 0.7, 18, TIMBER);
      pyramid(ctx, cx - hw * 0.15, cy - hh * 0.1, hw * 0.72, hh * 0.72, 18, 18, '#5d6b3a');
      for (let i = 0; i < 3; i++) cylinderLog(ctx, cx + hw * 0.45, cy + hh * 0.2 - i * 7, 16);
      break;
    }
    case 'timberyard': {
      for (let r = 0; r < 3 + Math.min(level, 3); r++)
        for (let i = 0; i < 4; i++) cylinderLog(ctx, cx - hw * 0.45 + i * 13, cy + hh * 0.25 - r * 9 - i * 6, 24);
      box(ctx, cx + hw * 0.55, cy - hh * 0.1, 8, 4, 30, TIMBER);
      break;
    }
    case 'emberwell': {
      cylinder(ctx, cx, cy, hw * 0.7, 14, DARKSTONE);
      glow(ctx, cx, cy - 16, hw * 0.9, 'rgba(255,120,40,0.85)');
      ctx.fillStyle = '#ff9a3c';
      ctx.beginPath();
      ctx.ellipse(cx, cy - 14, hw * 0.5, hh * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a2b1c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.6, cy - 14);
      ctx.lineTo(cx - hw * 0.6, cy - 44);
      ctx.lineTo(cx + hw * 0.6, cy - 44);
      ctx.lineTo(cx + hw * 0.6, cy - 14);
      ctx.stroke();
      break;
    }
    case 'musterhall': {
      box(ctx, cx, cy, hw, hh * 0.8, 26, TIMBER);
      pyramid(ctx, cx, cy, hw, hh * 0.8, 26, 22, '#5a3a2a');
      for (const t of [0.25, 0.5, 0.75]) {
        ctx.fillStyle = banner;
        ctx.beginPath();
        ctx.arc(cx - hw + hw * 2 * t * 0.5, cy - 12 + hh * t * 0.4, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      flag(ctx, cx + hw * 0.6, cy - 30, 20, banner);
      break;
    }
    case 'warcamp': {
      for (const [dx, dy] of [
        [-0.45, -0.1],
        [0.35, -0.3],
        [0.1, 0.35],
      ] as const)
        cone(ctx, cx + hw * dx, cy + hh * dy, 18, 26, shade(banner, 0.15));
      glow(ctx, cx - hw * 0.05, cy + hh * 0.05, 18, 'rgba(255,150,60,0.9)');
      ctx.fillStyle = '#ffcf6b';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy + 4);
      ctx.lineTo(cx, cy - 12);
      ctx.lineTo(cx + 6, cy + 4);
      ctx.fill();
      break;
    }
    case 'bowtower': {
      for (const [dx, dy] of [
        [-0.5, 0],
        [0.5, 0],
        [0, 0.5],
        [0, -0.5],
      ] as const) {
        ctx.strokeStyle = shade(TIMBER, -0.2);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(cx + hw * dx * 0.8, cy + hh * dy * 0.8);
        ctx.lineTo(cx + hw * dx * 0.35, cy + hh * dy * 0.35 - 50 - level * 4);
        ctx.stroke();
      }
      const H = 52 + level * 4;
      box(ctx, cx, cy - H, hw * 0.55, hh * 0.55, 12, TIMBER);
      pyramid(ctx, cx, cy - H, hw * 0.6, hh * 0.6, 12, 18, '#3f5b3a');
      if (trim) flag(ctx, cx, cy - H - 28, 14, trim);
      break;
    }
    case 'stonethrower': {
      box(ctx, cx, cy, hw, hh, 14, DARKSTONE);
      box(ctx, cx, cy - 14, hw * 0.6, hh * 0.6, 10, TIMBER);
      ctx.strokeStyle = shade(TIMBER, -0.3);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.3, cy - 22);
      ctx.lineTo(cx + hw * 0.35, cy - 56 - level * 2);
      ctx.stroke();
      ctx.fillStyle = '#6b6b6b';
      ctx.beginPath();
      ctx.arc(cx + hw * 0.38, cy - 60 - level * 2, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'obelisk': {
      box(ctx, cx, cy, hw * 0.9, hh * 0.9, 8, DARKSTONE);
      const H = 64 + level * 8;
      poly(ctx, [cx - 10, cy - 8, cx, cy - 3, cx, cy - H, cx - 7, cy - H + 8], '#5b3f7a');
      poly(ctx, [cx, cy - 3, cx + 10, cy - 8, cx + 7, cy - H + 8, cx, cy - H], '#3b2752');
      poly(ctx, [cx - 7, cy - H + 8, cx, cy - H - 10, cx + 7, cy - H + 8, cx, cy - H], '#8b6bc0');
      glow(ctx, cx, cy - H * 0.55, 18, 'rgba(180,140,255,0.55)');
      ctx.fillStyle = '#d9c6ff';
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 4, cy - 20 - i * 12, 2, 6);
      break;
    }
    case 'ballista': {
      box(ctx, cx, cy, hw, hh, 16, STONE);
      box(ctx, cx, cy - 16, hw * 0.5, hh * 0.5, 8, TIMBER);
      ctx.strokeStyle = '#3a2b1c';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - hw * 0.5, cy - 28);
      ctx.lineTo(cx + hw * 0.55, cy - 46 - level * 3);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#b07d3c';
      ctx.beginPath();
      ctx.arc(cx + hw * 0.2, cy - 40, 18, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    }
    case 'wall': {
      const H = 18 + level * 3;
      box(ctx, cx, cy, hw * 1.05, hh * 1.05, H, level >= 3 ? '#9a978f' : '#86837b', level >= 5 ? '#d9c38a' : undefined);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(cx - 2, cy - H + 2, 3, H - 4);
      break;
    }
    case 'caltrops': {
      ctx.fillStyle = 'rgba(40,30,20,0.55)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw * 0.8, hh * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b0b0b0';
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 3);
        ctx.lineTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 3 - 6);
        ctx.stroke();
      }
      break;
    }
  }
  return { canvas: c, originX: cx / W, originY: cy / Hc };
}

function cylinderLog(ctx: Ctx, x: number, y: number, len: number) {
  ctx.fillStyle = '#7a4e2b';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + len * 0.7, y - len * 0.35);
  ctx.lineTo(x + len * 0.7, y - len * 0.35 + 7);
  ctx.lineTo(x, y + 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#d9b07a';
  ctx.beginPath();
  ctx.ellipse(x, y + 3.5, 3.5, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function paintRubble(size: number): BuildingArt {
  const hw = (size * TW) / 2;
  const hh = (size * TH) / 2;
  const W = size * TW + 8;
  const H = size * TH + 22;
  const [c, ctx] = canvas(W, H);
  const cx = W / 2;
  const cy = H - hh - 4;
  ctx.fillStyle = 'rgba(40,32,24,0.55)';
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw * 0.85, hh * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  let seed = size * 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6 + size * 5; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.8;
    const x = cx + Math.cos(a) * hw * r;
    const y = cy + Math.sin(a) * hh * r;
    box(ctx, x, y, 4 + rnd() * 5, 2 + rnd() * 3, 3 + rnd() * 7, rnd() > 0.5 ? '#7d7a72' : '#6b4a2e');
  }
  return { canvas: c, originX: cx / W, originY: cy / H };
}

// --------------------------------------------------------------------- troops ---

const TROOP_COLORS: Record<TroopId, { body: string; accent: string }> = {
  shield: { body: '#4f78b0', accent: '#d9d9d9' },
  longbow: { body: '#4f8a3a', accent: '#8b6a3c' },
  sapper: { body: '#6b5134', accent: '#222222' },
  ravager: { body: '#8b949c', accent: '#c1c8cd' },
  drake: { body: '#d0442a', accent: '#ffd25a' },
  general: { body: '#7a5b2a', accent: '#e8c35a' },
  mage: { body: '#7a3aa8', accent: '#ff8a2b' },
};

/** Relative sprite size: chunky Giants, a huge Dragon (spec F4/F6 silhouettes). */
const TROOP_SIZE: Record<TroopId, number> = { shield: 1, longbow: 1, sapper: 1, ravager: 1.55, drake: 2.3, general: 1.25, mage: 1.05 };

export function paintTroop(kind: TroopId, team: 'attacker' | 'defender' = 'attacker'): HTMLCanvasElement {
  const big = TROOP_SIZE[kind];
  const [c, ctx] = canvas(44 * big, 52 * big);
  ctx.scale(big, big);
  const col = TROOP_COLORS[kind];
  const cx = 22;
  const feet = 46;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, feet, 11, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 'drake') {
    // body
    ctx.fillStyle = col.body;
    ctx.beginPath();
    ctx.ellipse(cx, 26, 11, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // wings
    poly(ctx, [cx - 2, 22, cx - 20, 8, cx - 14, 24], shade(col.body, 0.25));
    poly(ctx, [cx + 2, 22, cx + 20, 6, cx + 15, 24], shade(col.body, 0.1));
    // head
    ctx.fillStyle = shade(col.body, 0.15);
    ctx.beginPath();
    ctx.ellipse(cx + 11, 18, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = col.accent;
    ctx.fillRect(cx + 13, 16, 2, 2);
    poly(ctx, [cx - 9, 28, cx - 18, 34, cx - 8, 31], shade(col.body, -0.2));
    return c;
  }
  const team2 = team === 'attacker' ? '#d9573f' : '#3d7fd9';
  // legs
  ctx.fillStyle = '#2b2116';
  ctx.fillRect(cx - 5, 36, 4, 10);
  ctx.fillRect(cx + 1, 36, 4, 10);
  // body
  ctx.fillStyle = col.body;
  ctx.beginPath();
  ctx.moveTo(cx - 9, 37);
  ctx.lineTo(cx - 7, 22);
  ctx.lineTo(cx + 7, 22);
  ctx.lineTo(cx + 9, 37);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = team2;
  ctx.fillRect(cx - 7, 29, 14, 3);
  // head
  ctx.fillStyle = '#e0b48a';
  ctx.beginPath();
  ctx.arc(cx, 16, 6, 0, Math.PI * 2);
  ctx.fill();
  switch (kind) {
    case 'shield':
      // Swordsman: steel cap, round buckler, raised sword.
      ctx.fillStyle = '#8d939a';
      ctx.beginPath();
      ctx.arc(cx, 13, 6.5, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#c94f2e';
      ctx.beginPath();
      ctx.arc(cx - 9, 30, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c35a';
      ctx.fillRect(cx - 10, 29, 2, 2);
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + 8, 30);
      ctx.lineTo(cx + 15, 9);
      ctx.stroke();
      ctx.strokeStyle = '#6b4424';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 5, 28);
      ctx.lineTo(cx + 11, 30);
      ctx.stroke();
      break;
    case 'mage':
      // Ember Mage: tall pointed hat, flame-tipped staff.
      poly(ctx, [cx - 8, 12, cx + 8, 12, cx + 2, -2], shade(col.body, -0.1));
      ctx.fillStyle = col.accent;
      ctx.fillRect(cx - 8, 11, 16, 2);
      ctx.strokeStyle = '#6b4424';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 10, 40);
      ctx.lineTo(cx + 12, 14);
      ctx.stroke();
      glow(ctx, cx + 12, 13, 6, 'rgba(255,140,40,0.95)');
      break;
    case 'longbow':
      ctx.fillStyle = col.body;
      ctx.beginPath();
      ctx.arc(cx, 14, 7, Math.PI * 1.05, Math.PI * 1.95);
      ctx.fill();
      ctx.strokeStyle = col.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 9, 26, 12, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.stroke();
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx + 13, 15);
      ctx.lineTo(cx + 13, 37);
      ctx.stroke();
      break;
    case 'sapper':
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.ellipse(cx + 9, 27, 7, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b07d3c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + 9, 19);
      ctx.lineTo(cx + 12, 12);
      ctx.stroke();
      glow(ctx, cx + 12, 11, 5, 'rgba(255,200,80,0.95)');
      break;
    case 'ravager':
      // Stone Giant: craggy brow and two huge fists.
      ctx.fillStyle = shade(col.body, -0.15);
      ctx.fillRect(cx - 7, 10, 14, 3);
      for (const fx of [cx - 12, cx + 12]) {
        ctx.fillStyle = col.accent;
        ctx.beginPath();
        ctx.arc(fx, 33, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3a4046';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      break;
    case 'general':
      poly(ctx, [cx - 8, 21, cx + 8, 21, cx + 12, 40, cx - 12, 40], shade(col.accent, -0.2));
      ctx.fillStyle = col.accent;
      ctx.beginPath();
      ctx.arc(cx, 12, 6.5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - 6, 8, 2, 3);
      ctx.fillRect(cx + 4, 8, 2, 3);
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + 9, 32);
      ctx.lineTo(cx + 17, 10);
      ctx.stroke();
      break;
  }
  return c;
}

export function paintProjectile(kind: 'arrow' | 'stone' | 'bolt' | 'fire' | 'spark'): HTMLCanvasElement {
  if (kind === 'arrow' || kind === 'bolt') {
    const len = kind === 'bolt' ? 22 : 14;
    const [c, ctx] = canvas(len + 4, 6);
    ctx.strokeStyle = kind === 'bolt' ? '#5a3a1e' : '#c9a24a';
    ctx.lineWidth = kind === 'bolt' ? 3 : 1.6;
    ctx.beginPath();
    ctx.moveTo(1, 3);
    ctx.lineTo(len, 3);
    ctx.stroke();
    poly(ctx, [len, 0, len + 4, 3, len, 6], '#d9d9d9');
    return c;
  }
  const r = kind === 'stone' ? 6 : kind === 'fire' ? 9 : 4;
  const [c, ctx] = canvas(r * 2 + 4, r * 2 + 4);
  if (kind === 'stone') {
    ctx.fillStyle = '#6f6a62';
    ctx.beginPath();
    ctx.arc(r + 2, r + 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8f8a82';
    ctx.beginPath();
    ctx.arc(r, r, r / 2, 0, Math.PI * 2);
    ctx.fill();
  } else glow(ctx, r + 2, r + 2, r + 2, kind === 'fire' ? 'rgba(255,140,40,1)' : 'rgba(255,230,150,1)');
  return c;
}

export function paintPuff(): HTMLCanvasElement {
  const [c, ctx] = canvas(48, 48);
  glow(ctx, 24, 24, 24, 'rgba(200,200,200,0.85)');
  return c;
}

// --------------------------------------------------------------------- island ---

/** The island ground: grass inside, a trodden-earth rim, earthy sides (a raised clearing in the forest). */
export function paintIsland(mode: 'day' | 'night' | 'dawn' = 'day'): { canvas: HTMLCanvasElement; ox: number; oy: number } {
  const cliff = 34;
  const W = GRID * TW + 40;
  const H = GRID * TH + cliff + 40;
  const [c, ctx] = canvas(W, H);
  const ox = W / 2;
  const oy = 20;
  const at = (x: number, y: number) => ({ x: ox + (x - y) * (TW / 2), y: oy + (x + y) * (TH / 2) });
  // The island is a raised clearing in the forest: a soft dark contact shadow, earth sides,
  // and a trodden-earth rim around the buildable ground.
  const L = at(0, GRID);
  const R = at(GRID, 0);
  const T = at(0, 0);
  const B = at(GRID, GRID);
  ctx.save();
  ctx.shadowColor = 'rgba(8,24,10,0.6)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  poly(ctx, [T.x, T.y, R.x, R.y, B.x, B.y + cliff, L.x, L.y], 'rgba(20,40,20,0.5)');
  ctx.restore();
  // cliffs
  poly(ctx, [L.x, L.y, B.x, B.y, B.x, B.y + cliff, L.x, L.y + cliff], '#7a5432');
  poly(ctx, [B.x, B.y, R.x, R.y, R.x, R.y + cliff, B.x, B.y + cliff], '#5a3d22');
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1a1208';
  ctx.beginPath();
  ctx.moveTo(L.x, L.y);
  ctx.lineTo(L.x, L.y + cliff);
  ctx.lineTo(B.x, B.y + cliff);
  ctx.lineTo(R.x, R.y + cliff);
  ctx.lineTo(R.x, R.y);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    ctx.fillRect(L.x + (B.x - L.x) * t, L.y + (B.y - L.y) * t + 8 + (i % 3) * 7, 10, 2);
  }
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      const shore = x < SHORE || y < SHORE || x >= GRID - SHORE || y >= GRID - SHORE;
      const p0 = at(x, y);
      const p1 = at(x + 1, y);
      const p2 = at(x + 1, y + 1);
      const p3 = at(x, y + 1);
      const n = rnd() * 0.08 - 0.04;
      const base = shore ? ((x + y) % 2 === 0 ? '#a8865a' : '#a07f54') : (x + y) % 2 === 0 ? '#62a043' : '#5b973f';
      poly(ctx, [p0.x, p0.y, p1.x, p1.y, p2.x, p2.y, p3.x, p3.y], shade(base, n));
      if (!shore && rnd() < 0.08) {
        const cxp = (p0.x + p2.x) / 2 + (rnd() - 0.5) * 20;
        const cyp = (p0.y + p2.y) / 2 + (rnd() - 0.5) * 8;
        ctx.fillStyle = rnd() < 0.5 ? '#e9e1a8' : '#c96a8a';
        ctx.fillRect(cxp, cyp, 2, 2);
      }
      if (shore && rnd() < 0.05) {
        const cxp = (p0.x + p2.x) / 2;
        const cyp = (p0.y + p2.y) / 2;
        box(ctx, cxp, cyp, 5 + rnd() * 4, 3 + rnd() * 2, 4 + rnd() * 4, '#8d8a83');
      }
    }
  // buildable-area outline
  const a = at(SHORE, SHORE);
  const b = at(GRID - SHORE, SHORE);
  const d = at(GRID - SHORE, GRID - SHORE);
  const e = at(SHORE, GRID - SHORE);
  ctx.strokeStyle = 'rgba(255,255,230,0.18)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(d.x, d.y);
  ctx.lineTo(e.x, e.y);
  ctx.closePath();
  ctx.stroke();
  if (mode !== 'day') {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = mode === 'night' ? 'rgba(20,30,80,0.55)' : 'rgba(255,150,120,0.18)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  return { canvas: c, ox: ox / W, oy: oy / H };
}

/** Vertical sea gradient strip (stretched to fill the camera). */
export function paintSea(mode: 'day' | 'night' | 'dawn'): HTMLCanvasElement {
  const [c, ctx] = canvas(8, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  if (mode === 'night') {
    g.addColorStop(0, '#0a1130');
    g.addColorStop(1, '#050913');
  } else if (mode === 'dawn') {
    g.addColorStop(0, '#5a4660');
    g.addColorStop(0.5, '#25445a');
    g.addColorStop(1, '#0f2a36');
  } else {
    g.addColorStop(0, '#1f6878');
    g.addColorStop(0.6, '#174d5c');
    g.addColorStop(1, '#0f3542');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 512);
  return c;
}

export const FACTION_BANNERS: Record<string, string> = {
  thornmarch: '#3f6b3a',
  hollowdeep: '#e07b28',
  skyrend: '#27527a',
  ashenfen: '#5b3f7a',
  npc: '#8a2f2f',
};
