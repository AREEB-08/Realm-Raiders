import { useEffect, useRef } from 'react';
import { BUILDINGS, GRID, SHORE, type Layout } from '@realm/game-data';
import type { LayoutMove } from '@realm/shared';
import { paintBuilding, shade } from '../game/art';

const cache = new Map<string, ReturnType<typeof paintBuilding>>();
function art(type: Parameters<typeof paintBuilding>[0], level: number, banner: string) {
  const k = `${type}:${level}:${banner}`;
  let a = cache.get(k);
  if (!a) cache.set(k, (a = paintBuilding(type, level, banner)));
  return a;
}

/** A small iso render of a base (War Room, scouting, Architect patch previews) on Canvas 2D. */
export function MiniMap({
  layout,
  height = 200,
  ghostMoves,
  banner = '#8a2f2f',
  night = false,
}: {
  layout: Layout;
  height?: number;
  ghostMoves?: LayoutMove[] | null;
  banner?: string;
  night?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth || 320;
    const H = height;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const tw = Math.min((W - 16) / GRID, ((H - 30) * 2) / GRID);
    const th = tw / 2;
    const ox = W / 2;
    const oy = 14;
    const at = (x: number, y: number) => ({ x: ox + ((x - y) * tw) / 2, y: oy + ((x + y) * th) / 2 });
    for (let y = 0; y < GRID; y++)
      for (let x = 0; x < GRID; x++) {
        const shore = x < SHORE || y < SHORE || x >= GRID - SHORE || y >= GRID - SHORE;
        const p = [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
        ctx.beginPath();
        ctx.moveTo(p[0]!.x, p[0]!.y);
        for (const q of p.slice(1)) ctx.lineTo(q.x, q.y);
        ctx.closePath();
        const base = shore ? '#cdb47e' : (x + y) % 2 ? '#527c3b' : '#58833f';
        ctx.fillStyle = night ? shade(base, -0.45) : base;
        ctx.fill();
      }
    const moved = new Map((ghostMoves ?? []).map((m) => [m.buildingId, m]));
    const items = layout.buildings
      .map((b) => ({ b, s: BUILDINGS[b.type].size }))
      .sort((p, q) => p.b.x + p.b.y + p.s * 2 - (q.b.x + q.b.y + q.s * 2));
    const scale = tw / 64;
    for (const { b, s } of items) {
      const a = art(b.type, b.level, banner);
      const c0 = at(b.x + s / 2, b.y + s / 2);
      const w = a.canvas.width * scale;
      const h = a.canvas.height * scale;
      ctx.globalAlpha = moved.has(b.id) ? 0.35 : 1;
      ctx.drawImage(a.canvas, c0.x - a.originX * w, c0.y - a.originY * h, w, h);
    }
    ctx.globalAlpha = 1;
    for (const m of moved.values()) {
      const b = layout.buildings.find((x) => x.id === m.buildingId);
      if (!b) continue;
      const s = BUILDINGS[b.type].size;
      const a = art(b.type, b.level, banner);
      const from = at(b.x + s / 2, b.y + s / 2);
      const to = at(m.x + s / 2, m.y + s / 2);
      ctx.strokeStyle = '#9fe6ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const w = a.canvas.width * scale;
      const h = a.canvas.height * scale;
      ctx.globalAlpha = 0.85;
      ctx.filter = 'hue-rotate(160deg) brightness(1.2)';
      ctx.drawImage(a.canvas, to.x - a.originX * w, to.y - a.originY * h, w, h);
      ctx.filter = 'none';
      ctx.globalAlpha = 1;
    }
  }, [layout, height, ghostMoves, banner, night]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} />;
}
