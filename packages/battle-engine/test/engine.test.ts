import { describe, expect, it } from 'vitest';
import { BUILDINGS, NPC_ISLANDS, starterLayout } from '@realm/game-data';
import {
  DIR16,
  Sfc32,
  baseErrors,
  baseHash,
  canDeploy,
  codeToBase,
  createBattle,
  decodeBase,
  decodeReplay,
  dirIndex,
  encodeBase,
  encodeReplay,
  fromHex,
  isqrt,
  keccak,
  layoutToCode,
  normalizeBase,
  replayHash,
  resultHash,
  simulate,
  step,
  stepToward,
  utf8,
  verifyReplay,
  concatBytes,
  type BattleInput,
} from '../src';
import { obeliskTick } from '../src/defences/obelisk';
import { input, npcBase, row, seedOf, southPush } from './helpers';

describe('math', () => {
  it('isqrt is floor(sqrt(n)) for small and large values', () => {
    for (let n = 0; n < 5000; n++) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
    for (const n of [2 ** 31 - 1, 2 ** 31, 1_800_000_000, 9_007_199_254_740_000]) {
      const r = isqrt(n);
      expect(r * r <= n).toBe(true);
      expect((r + 1) * (r + 1) > n).toBe(true);
    }
  });

  it('direction table is 16 unit vectors and dirIndex picks the nearest', () => {
    expect(DIR16).toHaveLength(16);
    for (const [x, y] of DIR16) expect(Math.abs(x * x + y * y - 1024 * 1024)).toBeLessThan(2048);
    expect(dirIndex(1, 0)).toBe(0);
    expect(dirIndex(0, 5)).toBe(4);
    expect(dirIndex(-3, 0)).toBe(8);
    expect(dirIndex(5, 5)).toBe(2);
  });

  it('stepToward moves by at most the step and lands exactly on arrival', () => {
    const out = { x: 0, y: 0 };
    expect(stepToward(0, 0, 3000, 4000, 50, out)).toBe(false);
    expect(out).toEqual({ x: 30, y: 40 });
    expect(stepToward(0, 0, 30, 40, 50, out)).toBe(true);
    expect(out).toEqual({ x: 30, y: 40 });
  });
});

describe('sfc32', () => {
  it('matches pinned vectors', () => {
    const r = new Sfc32(fromHex('0x' + '00112233445566778899aabbccddeeff'.repeat(2)));
    expect(Array.from({ length: 6 }, () => r.next())).toEqual([
      4153332168, 4014227648, 1650149015, 722760978, 631003587, 458631834,
    ]);
  });

  it('is reproducible and seed-sensitive', () => {
    const a = new Sfc32(fromHex(seedOf(1)));
    const b = new Sfc32(fromHex(seedOf(1)));
    const c = new Sfc32(fromHex(seedOf(2)));
    const xs = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(xs);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(xs);
  });

  it('variance stays within ±10 %', () => {
    const r = new Sfc32(fromHex(seedOf('v')));
    for (let i = 0; i < 2000; i++) {
      const v = r.variance();
      expect(v).toBeGreaterThanOrEqual(900);
      expect(v).toBeLessThanOrEqual(1100);
    }
  });
});

describe('base encoding', () => {
  it('round-trips and is order-independent', () => {
    const layout = starterLayout();
    const shuffled = { ...layout, buildings: [...layout.buildings].reverse() };
    expect(baseHash(layout)).toBe(baseHash(shuffled));
    const bytes = encodeBase(layout);
    expect(bytes[0]).toBe(1);
    expect(decodeBase(bytes)).toEqual(normalizeBase(layout));
  });

  it('hash changes when one building moves', () => {
    const layout = starterLayout();
    const moved = structuredClone(layout);
    moved.buildings[1]!.x += 1;
    expect(baseHash(moved)).not.toBe(baseHash(layout));
  });

  it('share codes round-trip', () => {
    for (const island of NPC_ISLANDS) {
      const base = normalizeBase(island.layout());
      expect(codeToBase(layoutToCode(base))).toEqual(base);
    }
  });

  it('all NPC bases and the starter base are valid', () => {
    expect(baseErrors(normalizeBase(starterLayout()))).toEqual([]);
    for (const island of NPC_ISLANDS) expect(baseErrors(normalizeBase(island.layout()))).toEqual([]);
  });

  it('flags overlaps, off-island buildings and citadel count', () => {
    const base = normalizeBase(starterLayout());
    base.buildings.push({ type: 'bowtower', level: 1, x: 13, y: 13 });
    base.buildings.push({ type: 'goldworks', level: 1, x: 29, y: 29 });
    base.buildings.push({ type: 'citadel', level: 1, x: 2, y: 2 });
    const errors = baseErrors(base).join('|');
    expect(errors).toMatch(/overlaps/);
    expect(errors).toMatch(/off the island/);
    expect(errors).toMatch(/exactly one Citadel/);
  });
});

describe('replay codec', () => {
  const sample = () => southPush(npcBase('briarholt'), seedOf('codec'));

  it('round-trips the input', () => {
    const inp = sample();
    const decoded = decodeReplay(encodeReplay(inp));
    expect(decoded.seed).toBe(inp.seed);
    expect(decoded.actions).toEqual(inp.actions);
    expect(decoded.base).toEqual(normalizeBase(inp.base));
    expect(decoded.baseHash).toBe(baseHash(inp.base));
    expect(decoded.baseMatches).toBe(true);
  });

  it('rejects bad magic, truncation and trailing bytes', () => {
    const bytes = encodeReplay(sample());
    const bad = bytes.slice();
    bad[0] = 0;
    expect(() => decodeReplay(bad)).toThrow(/magic/);
    expect(() => decodeReplay(bytes.slice(0, 80))).toThrow();
    expect(() => decodeReplay(concatBytes(bytes, new Uint8Array([1])))).toThrow();
  });

  it('simulate(decode(encode(x))) equals simulate(x)', () => {
    for (let i = 0; i < 5; i++) {
      const inp = southPush(npcBase(i % 2 ? 'kragmoor' : 'briarholt'), seedOf(`prop-${i}`));
      const a = simulate(inp);
      const b = simulate(decodeReplay(encodeReplay(inp)));
      expect(b.stateHash).toBe(a.stateHash);
      expect(b.stars).toBe(a.stars);
    }
  });

  it('resultHash is keccak(replayHash ‖ u8 stars ‖ u16 bp ‖ u32 renown), big-endian', () => {
    const rh = keccak(utf8('x'));
    const manual = keccak(concatBytes(fromHex(rh), new Uint8Array([3, 0x27, 0x10, 0, 0, 0, 0x28])));
    expect(resultHash(rh, 3, 10000, 40)).toBe(manual);
  });
});

describe('simulation rules', () => {
  it('is deterministic for the same input', () => {
    const inp = southPush(npcBase('kragmoor'), seedOf('det'));
    expect(simulate(inp).stateHash).toBe(simulate(inp).stateHash);
  });

  it('different seeds can change the outcome hash', () => {
    const base = npcBase('kragmoor');
    const a = simulate(southPush(base, seedOf('a'))).stateHash;
    const b = simulate(southPush(base, seedOf('b'))).stateHash;
    expect(a).not.toBe(b);
  });

  it('ends razed with 3 stars on the easy island', () => {
    const r = simulate(southPush(npcBase('briarholt'), seedOf('easy')));
    expect(r.endReason).toBe('razed');
    expect(r.stars).toBe(3);
    expect(r.destructionBp).toBe(10000);
    expect(r.citadelDestroyed).toBe(true);
  });

  it('ends on time when the army survives but cannot finish', () => {
    const r = simulate(southPush(npcBase('kragmoor'), seedOf('mid')));
    expect(r.endReason).toBe('time');
    expect(r.ticks).toBe(1800);
  });

  it('ends wiped when every troop dies with none left to deploy', () => {
    const r = simulate(southPush(npcBase('saltspire'), seedOf('hard')));
    expect(r.endReason).toBe('wiped');
    expect(r.ticks).toBeLessThan(1800);
  });

  it('ends at once on an end action', () => {
    const inp = southPush(npcBase('kragmoor'), seedOf('end'));
    inp.actions.push({ t: 300, kind: 'end' });
    const r = simulate(inp);
    expect(r.endReason).toBe('ended');
    expect(r.ticks).toBe(301);
  });

  it('awards renown and destruction-scaled loot', () => {
    const inp = southPush(npcBase('briarholt'), seedOf('loot'));
    const r = simulate({ ...inp, attackerCitadel: 1, defenderStored: { gold: 3000, timber: 3000 } });
    expect(r.renown).toBe(3 * 10 + 10);
    expect(r.loot).toEqual({ gold: 600, timber: 600 });
  });

  it('refuses deploys inside the no-deploy zone and beyond the army', () => {
    const base = npcBase('briarholt');
    const state = createBattle(input(base, seedOf('zone'), { shield: 1 }, []));
    const citadel = base.buildings.find((b) => b.type === 'citadel')!;
    expect(canDeploy(state, 'shield', citadel.x * 10 + 5, citadel.y * 10 + 5)).toBe(false);
    expect(canDeploy(state, 'shield', 5, 5)).toBe(true);
    expect(canDeploy(state, 'longbow', 5, 5)).toBe(false);
    step(state, [{ t: 0, kind: 'deploy', troop: 'shield', x: 5, y: 5 }]);
    expect(canDeploy(state, 'shield', 5, 5)).toBe(false);
    expect(state.troops).toHaveLength(1);
  });

  it('ignores invalid deploys identically on replay', () => {
    const inp = input(npcBase('briarholt'), seedOf('inv'), { shield: 1 }, [
      { t: 0, kind: 'deploy', troop: 'shield', x: 140, y: 150 },
      { t: 1, kind: 'deploy', troop: 'shield', x: 5, y: 5 },
    ]);
    const r = simulate(inp);
    expect(r.deployed).toEqual({ shield: 1 });
  });

  it('sappers go for walls and are spent on the blast', () => {
    const base = npcBase('kragmoor');
    const state = createBattle(
      // A level-2 wall has 405 HP and each blast does ~160, so it takes three sappers.
      input(base, seedOf('sap'), { sapper: 4 }, [
        { t: 0, kind: 'deploy', troop: 'sapper', x: 285, y: 175 },
        { t: 0, kind: 'deploy', troop: 'sapper', x: 285, y: 175 },
        { t: 0, kind: 'deploy', troop: 'sapper', x: 285, y: 180 },
        { t: 0, kind: 'deploy', troop: 'sapper', x: 285, y: 180 },
      ]),
    );
    step(state);
    expect(state.troops.every((t) => state.buildings[t.targetId]!.wall)).toBe(true);
    let wallsDown = 0;
    while (!state.ended && state.tick < 400) {
      step(state);
      wallsDown = state.buildings.filter((b) => b.wall && !b.alive).length;
    }
    expect(wallsDown).toBeGreaterThan(0);
    expect(state.troops.every((t) => !t.alive)).toBe(true);
  });

  it('ravagers pick a resource building first', () => {
    const state = createBattle(
      input(npcBase('kragmoor'), seedOf('rav'), { ravager: 1 }, [
        { t: 0, kind: 'deploy', troop: 'ravager', x: 150, y: 285 },
      ]),
    );
    step(state);
    const target = state.buildings[state.troops[0]!.targetId]!;
    expect(target.resource).toBe(true);
  });

  it('drakelings fly over walls without breaking them', () => {
    const walled = normalizeBase({
      v: 1,
      buildings: [
        { id: 'c', type: 'citadel', level: 1, x: 13, y: 13 },
        ...Array.from({ length: 14 }, (_, i) => [
          { id: `n${i}`, type: 'wall' as const, level: 1, x: 8 + i, y: 8 },
          { id: `s${i}`, type: 'wall' as const, level: 1, x: 8 + i, y: 21 },
        ]).flat(),
        ...Array.from({ length: 12 }, (_, i) => [
          { id: `w${i}`, type: 'wall' as const, level: 1, x: 8, y: 9 + i },
          { id: `e${i}`, type: 'wall' as const, level: 1, x: 21, y: 9 + i },
        ]).flat(),
      ],
    });
    expect(baseErrors(walled)).toEqual([]);
    const state = createBattle(
      input(walled, seedOf('fly'), { drake: 1 }, [{ t: 0, kind: 'deploy', troop: 'drake', x: 150, y: 285 }]),
    );
    let crossed = false;
    while (!state.ended && state.tick < 600) {
      step(state);
      const d = state.troops[0]!;
      if (d.alive && d.y < 21000) crossed = true;
    }
    expect(state.troops[0]!.flies).toBe(true);
    expect(crossed).toBe(true);
    expect(state.buildings.filter((b) => b.wall).every((b) => b.alive)).toBe(true);
  });

  it('ground troops break a wall to reach a fully enclosed target', () => {
    const base = npcBase('kragmoor');
    const r = simulate(
      input(base, seedOf('breach'), { shield: 6 }, row(0, 'shield', 6, 285, 140, 0).map((a, i) => ({ ...a, y: 140 + i * 5 }))),
    );
    expect(r.events.some((e) => e.k === 'destroyed' && e.type === 'wall')).toBe(true);
  });

  it('the obelisk ramps 10 → 30 → 60 dps with lock time', () => {
    const state = createBattle(input(npcBase('saltspire'), seedOf('ob'), { shield: 1 }, []));
    const ob = state.buildings.find((b) => b.type === 'obelisk')!;
    const at = (lock: number) => {
      ob.lockTicks = lock;
      return obeliskTick(ob);
    };
    expect(at(0).stage).toBe(0);
    expect(at(39).stage).toBe(0);
    expect(at(40).stage).toBe(1);
    expect(at(100).stage).toBe(2);
    expect(at(100).dmg).toBeGreaterThan(at(40).dmg);
    expect(at(40).dmg).toBeGreaterThan(at(0).dmg);
  });

  it('the ballista never targets ground troops; the stonethrower never targets fliers', () => {
    expect(BUILDINGS.ballista.defence!.hitsGround).toBe(false);
    expect(BUILDINGS.stonethrower.defence!.hitsAir).toBe(false);
    const state = createBattle(
      input(npcBase('saltspire'), seedOf('aa'), { shield: 3, drake: 1 }, [
        ...row(0, 'shield', 3, 150, 285, 10),
        { t: 0, kind: 'deploy', troop: 'drake', x: 150, y: 290 },
      ]),
    );
    while (!state.ended && state.tick < 900) {
      step(state);
      for (const b of state.buildings) {
        if (!b.alive || b.targetId < 0) continue;
        const t = state.troops[b.targetId]!;
        if (b.type === 'ballista') expect(t.flies).toBe(true);
        if (b.type === 'stonethrower') expect(t.flies).toBe(false);
      }
    }
  });

  it('rally is once per battle and needs a living General', () => {
    const inp = input(npcBase('kragmoor'), seedOf('rally'), { shield: 2, general: 1 }, [
      { t: 0, kind: 'rally' },
      { t: 1, kind: 'deploy', troop: 'general', x: 150, y: 285 },
      { t: 2, kind: 'rally' },
      { t: 3, kind: 'rally' },
    ]);
    const r = simulate(inp);
    expect(r.events.filter((e) => e.k === 'rally')).toHaveLength(1);
  });

  it('rally boosts damage', () => {
    const mk = (withRally: boolean): BattleInput =>
      input(npcBase('briarholt'), seedOf('boost'), { shield: 6, general: 1 }, [
        ...row(0, 'shield', 6, 110, 285, 12),
        { t: 0, kind: 'deploy', troop: 'general', x: 150, y: 285 },
        ...(withRally ? [{ t: 1, kind: 'rally' as const }] : []),
      ]);
    const a = createBattle(mk(false));
    const b = createBattle(mk(true));
    for (let i = 0; i < 260; i++) {
      step(a);
      step(b);
    }
    expect(b.damageBy.reduce((x, y) => x + y, 0)).toBeGreaterThan(a.damageBy.reduce((x, y) => x + y, 0));
  });

  it('caltrop pits spring once and are not counted as destruction', () => {
    const r = simulate(southPush(npcBase('briarholt'), seedOf('trap')));
    const traps = r.events.filter((e) => e.k === 'trap');
    expect(new Set(traps.map((e) => (e as { id: number }).id)).size).toBe(traps.length);
    expect(r.destructionBp).toBe(10000);
  });
});

describe('verification', () => {
  it('accepts an honest replay', () => {
    const inp = southPush(npcBase('briarholt'), seedOf('ok'));
    const bytes = encodeReplay(inp);
    const honest = simulate(inp);
    const report = verifyReplay(bytes, {
      seed: inp.seed,
      baseHash: baseHash(inp.base),
      stars: honest.stars,
      destructionBp: honest.destructionBp,
      replayHash: replayHash(bytes),
    });
    expect(report.ok).toBe(true);
  });

  it('rejects a replay with one tampered action byte', () => {
    const inp = southPush(npcBase('kragmoor'), seedOf('tamper'));
    const bytes = encodeReplay(inp);
    const honest = simulate(inp);
    const tampered = bytes.slice();
    // Move the first deploy's x by a tile (offset: header 71 + army 4×3 + count 2 + 4).
    const firstActionX = 4 + 1 + 2 + 32 + 32 + 1 + inp.army.troops.length * 4 + 2 + 4;
    tampered[firstActionX] = tampered[firstActionX]! + 10;
    const report = verifyReplay(tampered, {
      replayHash: replayHash(bytes),
      stars: honest.stars,
      destructionBp: honest.destructionBp,
    });
    expect(report.ok).toBe(false);
    expect(report.reasons).toContain('replay hash mismatch');
  });

  it('rejects a replay for a different seed or base', () => {
    const inp = southPush(npcBase('briarholt'), seedOf('x'));
    const bytes = encodeReplay(inp);
    expect(verifyReplay(bytes, { seed: seedOf('y') }).reasons).toContain('seed mismatch');
    expect(verifyReplay(bytes, { baseHash: baseHash(npcBase('kragmoor')) }).reasons).toContain('base hash mismatch');
  });

  it('rejects a replay whose embedded base was swapped', () => {
    const a = encodeReplay(southPush(npcBase('briarholt'), seedOf('s')));
    const b = encodeReplay(southPush(npcBase('kragmoor'), seedOf('s')));
    // Header (with briarholt's hash) + kragmoor's actions/base trailer.
    const spliced = concatBytes(a.subarray(0, 71), b.subarray(71));
    const report = verifyReplay(spliced);
    expect(report.ok).toBe(false);
  });
});
