import { describe, expect, it } from 'vitest';
import { normalizeBase } from '@realm/battle-engine';
import { GRID, NPC_ISLANDS, PLAN_TEMPLATES } from '@realm/game-data';
import type { PlanDTO } from '@realm/shared';
import { aggregate, expandPlan, inlineSims, noDeployGrid, practiceInputs } from '../src';
import { warRoomHint } from '../src/services/warroom';

const stats = (winRate: number, avgStars: number) => ({ n: 50, winRate, avgStars, avgDestruction: 0, p10: 0, p90: 0, avgSeconds: 0 });
const plans = (s: ReturnType<typeof stats>[]) => s.map((x, i) => ({ planId: `p${i}`, stats: x }) as unknown as PlanDTO);

describe('War Room (spec F4)', () => {
  it('Sefa suggests a harder target when every plan wins with three stars', () => {
    const h = warRoomHint(plans([stats(100, 3), stats(100, 3), stats(100, 3)]), 'briarholt');
    expect(h).toMatch(/harder target/);
    expect(h).toMatch(/Kragmoor Deep/);
    expect(h).toMatch(/Saltspire Eyrie/);
  });

  it('… says to grow the army when no plan can win, and stays quiet otherwise', () => {
    expect(warRoomHint(plans([stats(0, 0), stats(0, 0), stats(0, 0)]), 'saltspire')).toMatch(/Upgrade the War Camp/);
    expect(warRoomHint(plans([stats(100, 3), stats(100, 2.4), stats(0, 0)]), 'kragmoor')).toBeNull();
  });

  it('practice raid 0 follows the plan; the rest slip a little, never onto forbidden ground, and always the same way', () => {
    const island = NPC_ISLANDS.find((i) => i.key === 'kragmoor')!;
    const base = normalizeBase(island.layout());
    const tpl = PLAN_TEMPLATES[1]!;
    const plan = expandPlan(tpl, {}, base, { capacity: 30, troopLevel: 1, generalLevel: 1 });
    const a = practiceInputs(base, plan.army, plan.actions, tpl.id, 10);
    const b = practiceInputs(base, plan.army, plan.actions, tpl.id, 10);
    expect(a[0]!.actions).toEqual(plan.actions);
    expect(a.map((x) => x.actions)).toEqual(b.map((x) => x.actions));
    expect(a[3]!.actions).not.toEqual(plan.actions);
    const grid = noDeployGrid(base);
    for (const inp of a)
      for (let k = 0; k < inp.actions.length; k++) {
        const act = inp.actions[k]!;
        if (k) expect(act.t).toBeGreaterThanOrEqual(inp.actions[k - 1]!.t);
        if (act.kind !== 'deploy') continue;
        expect(grid[Math.floor(act.y / 10) * GRID + Math.floor(act.x / 10)]).toBe(0);
      }
  });

  it('the three plans are genuinely different against Kragmoor Deep (stars, time, cost)', async () => {
    const island = NPC_ISLANDS.find((i) => i.key === 'kragmoor')!;
    const base = normalizeBase(island.layout());
    const sims = inlineSims();
    const out = [];
    for (const tpl of PLAN_TEMPLATES) {
      const plan = expandPlan(tpl, {}, base, { capacity: 30, troopLevel: 1, generalLevel: 1 });
      out.push(aggregate(await sims.run(practiceInputs(base, plan.army, plan.actions, tpl.id, 20))));
    }
    const stars = out.map((s) => s.avgStars);
    expect(new Set(stars).size).toBeGreaterThan(1);
    // Giants + Sappers beat the plain rush on a walled base; the Dragon is the fastest.
    expect(out[1]!.avgStars).toBeGreaterThan(out[0]!.avgStars);
    expect(out[2]!.avgSeconds).toBeLessThan(out[0]!.avgSeconds);
  }, 60_000);
});

describe('engine version is fixed at commit (spec F4 + proof integrity)', () => {
  it('a replay under another engine version is rejected for this battle', async () => {
    const { createCore, FallbackAgents, MemoryBus, MemoryRepo, MockChain } = await import('../src');
    const { encodeReplay, bytesToBase64, simulate } = await import('@realm/battle-engine');
    const core = createCore({
      repo: new MemoryRepo(),
      chain: new MockChain(10143),
      agents: new FallbackAgents(),
      sims: inlineSims(),
      bus: new MemoryBus(),
      files: { putPortrait: async (id) => `mem://portrait/${id}.png` },
      cfg: { publicBaseUrl: 'http://test', allowDemoAuth: true, demo: true },
      now: () => Date.now(),
      log: () => {},
    });
    await core.start();
    const pid = ((await core.handle('POST', '/auth/demo', {}, null)) as { playerId: string }).playerId;
    const call = <T>(m: string, p: string, b?: unknown) => core.handle(m, p, b, pid) as Promise<T>;
    await call('POST', '/base/seal/relay', {});
    const room = (await call<{ warRoomId: string }>('POST', '/warroom', { targetIslandId: 'briarholt' })) as { warRoomId: string };
    for (let i = 0; i < 400; i++) {
      const w = await call<{ status: string }>('GET', `/warroom/${room.warRoomId}`);
      if (w.status === 'ready') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // The Sword Rush army is valid under both rule sets — exactly the case to guard.
    const commit = await call<{ battleId: string; engineVersion: number; seed: `0x${string}`; base: never; army: never; plan: { actions: never[] } }>(
      'POST',
      '/battle/commit',
      { warRoomId: room.warRoomId, planId: 'shieldwall' },
    );
    expect(commit.engineVersion).toBe(2);
    const v1 = { engineVersion: 1, seed: commit.seed, base: commit.base, army: commit.army, actions: commit.plan.actions };
    simulate(v1); // valid on its own…
    const r = await call<{ verified: boolean; reasons: string[] }>('POST', `/battle/${commit.battleId}/submit`, { replay: bytesToBase64(encodeReplay(v1)) });
    expect(r.verified).toBe(false); // …but not as this battle
    expect(r.reasons.join()).toMatch(/committed for v2/);
    core.stop();
  }, 60_000);
});
