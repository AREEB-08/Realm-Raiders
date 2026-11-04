// Ported from web-coc tests (owner code licence) for the reused helper; import paths adapted.
import { describe, expect, it } from 'vitest';
import { RenderInterpolation, TELEPORT_TILES } from '../src/game/render/render-interpolation';

const project = (x: number, y: number, out: { x: number; y: number }) => {
  out.x = x;
  out.y = y;
  return out;
};
const at = (lerp: RenderInterpolation, x: number, y: number) =>
  lerp.projectInto({ x: 0, y: 0 }, x, y);

describe('render interpolation', () => {
  it('draws between the previous and current tick without touching the simulation', () => {
    const battle = { units: [{ id: 1, x: 0, y: 0 }], defenders: [{ id: 1, x: 5, y: 5 }] };
    const lerp = new RenderInterpolation(project);
    lerp.capture(battle);
    battle.units[0].x = 1;
    battle.defenders[0].y = 6;
    lerp.prepare(battle, 0.25);
    expect(at(lerp, 1, 0)).toEqual({ x: 0.25, y: 0 });
    expect(at(lerp, 5, 6)).toEqual({ x: 5, y: 5.25 });
    // Simulation state is untouched; unrelated points project plainly.
    expect(battle.units[0]).toEqual({ id: 1, x: 1, y: 0 });
    expect(at(lerp, 3, 4)).toEqual({ x: 3, y: 4 });
    lerp.disable();
    expect(at(lerp, 1, 0)).toEqual({ x: 1, y: 0 });
  });

  it('never interpolates teleports, new units or a new battle', () => {
    const battle = { units: [{ id: 1, x: 0, y: 0 }] };
    const lerp = new RenderInterpolation(project);
    lerp.capture(battle);
    battle.units[0].x = TELEPORT_TILES + 0.1;
    battle.units.push({ id: 2, x: 9, y: 9 });
    lerp.prepare(battle, 0.5);
    expect(at(lerp, TELEPORT_TILES + 0.1, 0).x).toBe(TELEPORT_TILES + 0.1);
    expect(at(lerp, 9, 9)).toEqual({ x: 9, y: 9 });
    const next = { units: [{ id: 1, x: 0.5, y: 0 }] };
    lerp.prepare(next, 0.5);
    expect(at(lerp, 0.5, 0)).toEqual({ x: 0.5, y: 0 });
  });

  it('reports whether drawn positions changed since the last frame', () => {
    const battle = { units: [{ id: 1, x: 0, y: 0 }] };
    const lerp = new RenderInterpolation(project);
    lerp.capture(battle);
    battle.units[0].x = 1;
    lerp.prepare(battle, 0.2);
    lerp.prepare(battle, 0.2);
    expect(lerp.moved).toBe(false);
    lerp.prepare(battle, 0.6);
    expect(lerp.moved).toBe(true);
  });
});

