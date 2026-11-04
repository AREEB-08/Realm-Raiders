import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Layout } from '@realm/game-data';
import type { HomeDTO, ProfileDTO } from '@realm/shared';
import {
  FallbackAgents,
  MemoryBus,
  MemoryRepo,
  MockChain,
  createCore,
  inlineSims,
  planWalls,
  type AgentRequest,
  type AgentResult,
  type AgentRunner,
  type Core,
} from '../src';

/** An AI officer that takes 5 s to answer (the local model timed out like this on the phone). */
class SlowAgents implements AgentRunner {
  async run<T>(req: AgentRequest<T>): Promise<AgentResult<T>> {
    await new Promise((r) => setTimeout(r, 5_000));
    return { output: req.fallback(), fallback: false, latencyMs: 5_000 };
  }
}

let clock = 1_700_000_000_000;
let core: Core;
let pid: string;
const call = <T>(method: string, path: string, body?: unknown, who = pid) => core.handle(method, path, body, who) as Promise<T>;

beforeAll(async () => {
  core = createCore({
    repo: new MemoryRepo(),
    chain: new MockChain(10143),
    agents: new SlowAgents(),
    sims: inlineSims(),
    bus: new MemoryBus(),
    files: { putPortrait: async (id) => `mem://portrait/${id}.png` },
    cfg: { publicBaseUrl: 'http://test', allowDemoAuth: true, demo: true },
    now: () => clock,
    log: () => {},
  });
  await core.start();
  pid = ((await core.handle('POST', '/auth/demo', {}, null)) as { playerId: string }).playerId;
});

afterAll(() => core.stop());

/** First run of `n` free tiles on one row of the island (ground only; the wall limit is ignored). */
function freeRow(layout: Layout, n: number) {
  for (let y = 2; y < 28; y++)
    for (let x = 2; x + n <= 28; x++) {
      const line = Array.from({ length: n }, (_, i) => ({ x: x + i, y }));
      if (planWalls(layout, { gold: 1e9 }, line).tiles.every((t) => t.state === 'ok' || t.state === 'limit')) return line;
    }
  throw new Error('no free row');
}

describe('walls (F5 · B1)', () => {
  it('cost 50 Gold each and a line is priced as a whole', async () => {
    const home = await call<HomeDTO>('GET', '/home');
    const line = freeRow(home.base.layout, 6);
    const plan = planWalls(home.base.layout, { gold: 1000 }, line);
    expect(plan.placeable).toHaveLength(6);
    expect(plan.cost).toBe(300);
    expect(plan.resource).toBe('gold');
    expect(plan.problem).toBeNull();
  });

  it('marks each bad tile with the exact reason', async () => {
    const { base } = await call<HomeDTO>('GET', '/home');
    const citadel = base.layout.buildings.find((b) => b.type === 'citadel')!;
    const outside = planWalls(base.layout, { gold: 1000 }, [{ x: 0, y: 0 }]);
    expect(outside.tiles[0]!.state).toBe('outside');
    expect(outside.problem).toBe('Walls must be inside your island');
    const taken = planWalls(base.layout, { gold: 1000 }, [{ x: citadel.x, y: citadel.y }]);
    expect(taken.problem).toBe('Something is already here');
    const line = freeRow(base.layout, 3);
    const poor = planWalls(base.layout, { gold: 120 }, line);
    expect(poor.placeable).toHaveLength(2);
    expect(poor.tiles[2]!.state).toBe('short');
    expect(poor.problem).toBe('Not enough Gold');
  });

  it('stops at the Citadel wall limit', async () => {
    const { base } = await call<HomeDTO>('GET', '/home');
    const have = base.layout.buildings.filter((b) => b.type === 'wall').length;
    const room = 50 - have;
    const layout: Layout = structuredClone(base.layout);
    // Fill the limit up to one free slot, then ask for two.
    let added = 0;
    for (let y = 2; y < 28 && added < room - 1; y++)
      for (let x = 2; x < 28 && added < room - 1; x++)
        if (planWalls(layout, { gold: 1e9 }, [{ x, y }]).placeable.length) {
          layout.buildings.push({ id: `w${added}`, type: 'wall', level: 1, x, y });
          added++;
        }
    const plan = planWalls(layout, { gold: 1e9 }, freeRow(layout, 2));
    expect(plan.placeable).toHaveLength(1);
    expect(plan.tiles[1]!.state).toBe('limit');
  });

  it('places the confirmed line, charges Gold and unseals the base', async () => {
    await call('POST', '/base/seal/relay', {});
    const before = await call<HomeDTO>('GET', '/home');
    expect(before.base.dirty).toBe(false);
    const line = freeRow(before.base.layout, 6);
    const r = await call<{ placed: number; cost: number }>('POST', '/base/walls', { tiles: line });
    expect(r).toMatchObject({ placed: 6, cost: 300 });
    const after = await call<HomeDTO>('GET', '/home');
    expect(after.economy.gold).toBe(before.economy.gold - 300);
    expect(after.base.layout.buildings.filter((b) => b.type === 'wall').length).toBe(before.base.layout.buildings.filter((b) => b.type === 'wall').length + 6);
    expect(after.base.dirty).toBe(true);
  });

  it('places nothing when any tile is bad, with the reason', async () => {
    const home = await call<HomeDTO>('GET', '/home');
    const citadel = home.base.layout.buildings.find((b) => b.type === 'citadel')!;
    const line = [...freeRow(home.base.layout, 2), { x: citadel.x, y: citadel.y }];
    await expect(call('POST', '/base/walls', { tiles: line })).rejects.toMatchObject({ status: 409, message: 'Something is already here' });
    const again = await call<HomeDTO>('GET', '/home');
    expect(again.economy.gold).toBe(home.economy.gold);
  });

  it('settles finished work before checking (a Citadel that just reached level 2 allows 75 walls)', async () => {
    const base = (await core.ctx.repo.bases.get(pid))!;
    const res = (await core.ctx.repo.resources.get(pid))!;
    const citadel = base.layout.buildings.find((b) => b.type === 'citadel')!;
    // Fill the Citadel-1 limit (50) through the store, and finish a Citadel upgrade "just now".
    let n = base.layout.buildings.filter((b) => b.type === 'wall').length;
    for (let y = 2; y < 28 && n < 50; y++)
      for (let x = 2; x < 28 && n < 50; x++)
        if (planWalls(base.layout, { gold: 1e9 }, [{ x, y }]).placeable.length) {
          base.layout.buildings.push({ id: `fill-${n}`, type: 'wall', level: 1, x, y });
          n++;
        }
    base.timers[citadel.id] = { toLevel: 2, readyAt: clock - 1 };
    res.gold = 1_000;
    await core.ctx.repo.bases.put(base);
    await core.ctx.repo.resources.put(res);
    const r = await call<{ placed: number }>('POST', '/base/walls', { tiles: freeRow(base.layout, 1) });
    expect(r.placed).toBe(1);
  });
});

describe('profile (F5 · B3)', () => {
  it('answers without waiting for the AI officer, and the line comes separately', async () => {
    await call('PUT', '/general', {
      name: 'Brannoc',
      personality: 'bold',
      faction: 'thornmarch',
      appearance: (await import('@realm/shared')).defaultAppearance('thornmarch'),
    });
    const t0 = Date.now();
    const p = await core.handle('GET', `/profile/${pid}`, undefined, null) as ProfileDTO;
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(p.line.length).toBeGreaterThan(5);
    expect(p.badges.length).toBeGreaterThan(0);
    const line = await call<{ output: { greeting: string }; fallback: boolean }>('POST', '/agents/general/profile', {});
    expect(line.fallback).toBe(false);
    expect(line.output.greeting).toMatch(/Brannoc/);
  }, 10_000);
});

// Keep the fallback agents export in use for parity with flow.test (and tree-shaking checks).
void FallbackAgents;
