import { describe, expect, it } from 'vitest';
import type { BuildingId } from '@realm/game-data';
import { createBattle, normalizeBase, simulate, step, validateInput, verifyReplay, encodeReplay, type Action, type BattleInput, type BattleState } from '../src';
import { seedOf } from './helpers';

/** A tiny test base: a Citadel plus the given buildings. */
function base(extra: { type: BuildingId; x: number; y: number; level?: number }[]) {
  return normalizeBase({
    v: 1,
    buildings: [{ id: 'c', type: 'citadel', level: 1, x: 13, y: 13 }, ...extra.map((b, i) => ({ id: `b${i}`, level: 1, ...b }))],
  });
}

function battle(b: ReturnType<typeof base>, army: Record<string, number>, actions: Action[], v = 2): BattleState {
  const input: BattleInput = {
    engineVersion: v,
    seed: seedOf('v2-test'),
    base: b,
    army: { troops: Object.entries(army).map(([troop, count]) => ({ troop: troop as never, level: 1, count })) },
    actions,
  };
  return createBattle(input);
}

const deploy = (troop: string, x10: number, y10: number, t = 0): Action => ({ t, kind: 'deploy', troop: troop as never, x: x10, y: y10 });

function runUntil(s: BattleState, done: (s: BattleState) => boolean, max = 1200) {
  for (let i = 0; i < max && !s.ended && !done(s); i++) step(s);
}

const idOf = (s: BattleState, type: BuildingId) => s.buildings.find((b) => b.type === type)!.id;

describe('engine v2 rules (spec F4)', () => {
  it('uses the per-hit damage of the spec table (v1 keeps its dps formula)', () => {
    const b = base([]);
    const s2 = battle(b, { shield: 1 }, [deploy('shield', 25, 25)]);
    step(s2);
    expect(s2.troops[0]!.dmgPerHit).toBe(12_000);
    expect(s2.troops[0]!.maxHp).toBe(110_000);
    const s1 = battle(b, { shield: 1 }, [deploy('shield', 25, 25)], 1);
    step(s1);
    expect(s1.troops[0]!.dmgPerHit).toBe(14_000);
    expect(s1.troops[0]!.maxHp).toBe(260_000);
  });

  it('accepts engine v1 and v2, rejects others, and keeps the Mage out of v1', () => {
    const b = base([]);
    const ok = (v: number, army: Record<string, number>) =>
      validateInput({ engineVersion: v, seed: seedOf('x'), base: b, army: { troops: Object.entries(army).map(([troop, count]) => ({ troop: troop as never, level: 1, count })) }, actions: [] });
    expect(ok(2, { mage: 2 })).toEqual([]);
    expect(ok(1, { shield: 2 })).toEqual([]);
    expect(ok(1, { mage: 2 }).join()).toMatch(/unknown troop mage for engine v1/);
    expect(ok(3, { shield: 1 }).join()).toMatch(/not supported/);
  });

  it('Stone Giants go for defences first, even past nearer buildings', () => {
    // A goldworks right by the deploy point, a Bowyer Tower far across the island.
    const s = battle(base([{ type: 'goldworks', x: 3, y: 3 }, { type: 'bowtower', x: 22, y: 22 }]), { ravager: 1 }, [deploy('ravager', 25, 75)]);
    step(s);
    expect(s.troops[0]!.targetId).toBe(idOf(s, 'bowtower'));
  });

  it('Stone Giants smash defences twice as hard', () => {
    const s = battle(base([{ type: 'bowtower', x: 4, y: 4 }]), { ravager: 1 }, [deploy('ravager', 30, 85)]);
    const tower = s.buildings.find((b) => b.type === 'bowtower')!;
    runUntil(s, () => tower.hp < tower.maxHp);
    const dealt = tower.maxHp - tower.hp;
    // 30 HP per hit × 2 (defences), ±10 % variance.
    expect(dealt).toBeGreaterThanOrEqual(54_000);
    expect(dealt).toBeLessThanOrEqual(66_000);
    expect(s.fx.some((f) => f.k === 'slam')).toBe(true);
  });

  it('Ember Mages throw three fireballs in a fan, the outer two mirrored about the target', () => {
    const s = battle(base([]), { mage: 1 }, [deploy('mage', 150, 40)]);
    runUntil(s, (st) => st.projectiles.some((p) => p.from === 'troop'));
    const shots = s.projectiles.filter((p) => p.from === 'troop');
    expect(shots).toHaveLength(3);
    const citadel = s.buildings.find((b) => b.type === 'citadel')!;
    const [centre, a, b] = shots;
    expect(centre!.targetId).toBe(citadel.id);
    expect([a!.targetId, b!.targetId]).toEqual([-1, -1]);
    expect(a!.x + b!.x).toBe(2 * citadel.cx);
    expect(a!.y + b!.y).toBe(2 * citadel.cy);
    expect(shots.every((p) => p.splash === 800)).toBe(true);
    // All three land on a big target: 3 × 22 HP (±10 %).
    const before = citadel.hp;
    runUntil(s, (st) => !st.projectiles.some((p) => p.from === 'troop'));
    expect(before - citadel.hp).toBeGreaterThanOrEqual(3 * 19_800);
  });

  it('Fire Dragons breathe a cone: the target and what is behind it burn, not what is beside the dragon', () => {
    // Dragon comes from the north; the goldworks is its target, a wall sits right behind it,
    // a lumber camp sits off to the side of the dragon's path.
    const s = battle(
      base([
        { type: 'goldworks', x: 13, y: 6 },
        { type: 'wall', x: 14, y: 9 },
        { type: 'lumbercamp', x: 3, y: 3 },
      ]),
      { drake: 1 },
      [deploy('drake', 145, 5)],
    );
    const gw = s.buildings.find((b) => b.type === 'goldworks')!;
    const wall = s.buildings.find((b) => b.type === 'wall')!;
    const side = s.buildings.find((b) => b.type === 'lumbercamp')!;
    runUntil(s, () => gw.hp < gw.maxHp);
    expect(s.fx.some((f) => f.k === 'breath')).toBe(true);
    expect(wall.hp).toBeLessThan(wall.maxHp);
    expect(side.hp).toBe(side.maxHp);
  });

  it('air rules: the v2 Rune Obelisk ignores a Fire Dragon (v1 still shot the Drakeling)', () => {
    const b = base([{ type: 'obelisk', x: 6, y: 6 }]);
    const v2 = battle(b, { drake: 1 }, [deploy('drake', 45, 25)]);
    for (let i = 0; i < 30; i++) step(v2);
    expect(v2.buildings.find((x) => x.type === 'obelisk')!.targetId).toBe(-1);
    expect(v2.troops[0]!.hp).toBe(v2.troops[0]!.maxHp);
    const v1 = battle(b, { drake: 1 }, [deploy('drake', 45, 25)], 1);
    for (let i = 0; i < 30; i++) step(v1);
    expect(v1.buildings.find((x) => x.type === 'obelisk')!.targetId).toBe(0);
  });

  it('the Wyrm Ballista drops a Fire Dragon that burns what it guards (it is built for it)', () => {
    // The Dragon goes for the Citadel; a level-2 Ballista covers it from 11 tiles.
    const s = battle(base([{ type: 'ballista', x: 18, y: 6, level: 2 }]), { drake: 1 }, [deploy('drake', 40, 100)]);
    step(s); // deploy
    expect(s.troops).toHaveLength(1);
    const citadel = s.buildings.find((b) => b.type === 'citadel')!;
    runUntil(s, (st) => !st.troops[0]!.alive || !citadel.alive, 1800);
    expect(s.troops[0]!.alive).toBe(false);
    expect(citadel.alive).toBe(true);
  });

  it('a v2 battle replays bit-identically from its bytes, like v1', () => {
    const b = base([{ type: 'bowtower', x: 6, y: 6 }, { type: 'wall', x: 12, y: 12 }]);
    const input: BattleInput = {
      engineVersion: 2,
      seed: seedOf('v2-replay'),
      base: b,
      army: { troops: [{ troop: 'mage', level: 1, count: 2 }, { troop: 'ravager', level: 1, count: 1 }, { troop: 'drake', level: 1, count: 1 }] },
      actions: [deploy('ravager', 25, 25, 0), deploy('mage', 25, 35, 5), deploy('mage', 35, 25, 6), deploy('drake', 285, 285, 10)],
    };
    const r = simulate(input);
    const bytes = encodeReplay(input);
    const report = verifyReplay(bytes, { seed: input.seed, stars: r.stars, destructionBp: r.destructionBp });
    expect(report.ok).toBe(true);
    expect(report.result!.stateHash).toBe(r.stateHash);
  });
});
