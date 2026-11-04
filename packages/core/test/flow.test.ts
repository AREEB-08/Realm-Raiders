import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase64, createBattle, encodeReplay, step, ENGINE_VERSION, type BattleInput } from '@realm/battle-engine';
import { defaultAppearance, defaultPolicy, type BattleCommitDTO, type HomeDTO, type NightReportDTO, type TargetDTO, type WarRoomDTO } from '@realm/shared';
import {
  FallbackAgents,
  MemoryBus,
  MemoryRepo,
  MockChain,
  createCore,
  executeAutopilot,
  inlineSims,
  type Core,
  type PolicyDoc,
} from '../src';

let core: Core;
let pid: string;
const call = <T>(method: string, path: string, body?: unknown) => core.handle(method, path, body, pid) as Promise<T>;

beforeAll(async () => {
  core = createCore({
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
  const login = (await core.handle('POST', '/auth/demo', {}, null)) as { playerId: string };
  pid = login.playerId;
});

afterAll(() => core.stop());

async function waitWarRoom(id: string): Promise<WarRoomDTO & { status: string }> {
  for (let i = 0; i < 400; i++) {
    const w = await call<WarRoomDTO & { status: string }>('GET', `/warroom/${id}`);
    if (w.status === 'ready') return w;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('war room never finished');
}

function playPlan(commit: BattleCommitDTO): BattleInput {
  const input: BattleInput = {
    engineVersion: ENGINE_VERSION,
    seed: commit.seed,
    base: commit.base,
    army: commit.army,
    actions: commit.plan.actions,
  };
  // Drive it like the client does: incremental steps with actions fed at their ticks.
  const s = createBattle({ ...input, actions: [] });
  const queue = [...commit.plan.actions];
  while (!s.ended) {
    const now = queue.filter((a) => a.t === s.tick);
    queue.splice(0, now.length);
    step(s, now);
  }
  return { ...input, actions: s.applied };
}

describe('the full loop on the mock chain', () => {
  it('home loads with a starter base and resources', async () => {
    const home = await call<HomeDTO>('GET', '/home');
    expect(home.base.layout.buildings.length).toBeGreaterThan(10);
    expect(home.economy.gold).toBe(1500);
    expect(home.officers).toHaveLength(5);
    expect(home.chainMode).toBe('mock');
  });

  it('creates a General and registers its agent card', async () => {
    await call('PUT', '/general', { name: 'Brannoc', personality: 'bold', faction: 'thornmarch', appearance: defaultAppearance('thornmarch') });
    const { url } = await call<{ url: string }>('POST', '/general/portrait', { png: 'iVBORw0KGgo=' });
    expect(url).toContain(pid);
    const greet = await call<{ output: { greeting: string }; fallback: boolean }>('POST', '/agents/general/greeting', {});
    expect(greet.output.greeting).toMatch(/Brannoc/);
    expect(greet.fallback).toBe(true);
    const reg = await call<{ agentId: string }>('POST', '/chain/agent/relay');
    expect(reg.agentId).toBe('1');
  });

  it('seals the base and the hash matches the chain', async () => {
    const prep = await call<{ baseHash: string }>('POST', '/base/seal/prepare');
    const sealed = await call<{ sealed: boolean; baseHash: string }>('POST', '/base/seal/relay', {});
    expect(sealed.baseHash).toBe(prep.baseHash);
    const home = await call<HomeDTO>('GET', '/home');
    expect(home.base.sealedHash).toBe(prep.baseHash);
    expect(home.base.dirty).toBe(false);
  });

  it('lists exactly 3 sealed targets with one recommendation', async () => {
    const { islands } = await call<{ islands: TargetDTO[] }>('GET', '/targets');
    expect(islands).toHaveLength(3);
    expect(islands.every((t) => t.sealed)).toBe(true);
    expect(islands.filter((t) => t.recommended)).toHaveLength(1);
  });

  let room: WarRoomDTO;
  it('runs 3 plans × 50 sims deterministically', async () => {
    const w = await call<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'briarholt' });
    room = await waitWarRoom(w.warRoomId);
    expect(room.plans.every((p) => p.stats?.n === 50)).toBe(true);
    const again = await waitWarRoom((await call<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'briarholt' })).warRoomId);
    expect(again.plans.map((p) => p.stats)).toEqual(room.plans.map((p) => p.stats));
  }, 60_000);

  it('coaching changes the plan and at least one stat', async () => {
    const before = room.plans.find((p) => p.planId === 'shieldwall')!;
    const { plan } = await call<{ plan: WarRoomDTO['plans'][number] }>('POST', `/warroom/${room.warRoomId}/coach`, {
      planId: 'shieldwall',
      note: 'Hit from the east',
    });
    expect(plan.side).toBe('east');
    expect(JSON.stringify(plan.stats)).not.toBe(JSON.stringify(before.stats));
  }, 30_000);

  it('locks the seed, verifies an honest replay and records it', async () => {
    const commit = await call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room.warRoomId, planId: 'shieldwall' });
    expect(commit.seed).toMatch(/^0x[0-9a-f]{64}$/);
    expect(commit.commitTx.mode).toBe('mock');
    const input = playPlan(commit);
    const res = await call<{ verified: boolean; result: { stars: number; renown: number }; resultTx: unknown; badges: unknown[] }>(
      'POST',
      `/battle/${commit.battleId}/submit`,
      { replay: bytesToBase64(encodeReplay(input)) },
    );
    expect(res.verified).toBe(true);
    expect(res.result.stars).toBeGreaterThan(0);
    expect(res.resultTx).toBeTruthy();
    const home = await call<HomeDTO>('GET', '/home');
    expect(home.economy.renown).toBe(res.result.renown);
  }, 30_000);

  it('rejects a tampered replay (no Renown)', async () => {
    const commit = await call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room.warRoomId, planId: 'drake_raid' });
    const input = playPlan(commit);
    const before = (await call<HomeDTO>('GET', '/home')).economy.renown;
    const bad = { ...input, seed: ('0x' + '11'.repeat(32)) as `0x${string}` };
    const res = await call<{ verified: boolean; reasons: string[] }>('POST', `/battle/${commit.battleId}/submit`, {
      replay: bytesToBase64(encodeReplay(bad)),
    });
    expect(res.verified).toBe(false);
    expect(res.reasons).toContain('seed mismatch');
    expect((await call<HomeDTO>('GET', '/home')).economy.renown).toBe(before);
  }, 30_000);

  let report: NightReportDTO;
  it('drafts, seals and runs the night under the committed policy', async () => {
    const draft = await call<{ output: { policy: Record<string, unknown> } }>('POST', '/agents/night_captain/draft', {});
    const pol = await call<{ policyHash: string }>('POST', '/night/policy', { policy: draft.output.policy });
    const sealed = await call<{ sealed: boolean; policyHash: string }>('POST', '/night/policy/confirm', {});
    expect(sealed.sealed).toBe(true);
    expect(sealed.policyHash).toBe(pol.policyHash);
    await expect(call('POST', '/night/policy', {})).rejects.toThrow(/sealed until morning/);
    const { reportId } = await call<{ reportId: string }>('POST', '/night/simulate');
    report = (await call<{ report: NightReportDTO }>('GET', '/night/report')).report;
    expect(report.reportId).toBe(reportId);
    expect(report.attacks.length).toBe(3);
    expect(report.actions.filter((a) => a.allowed).every((a) => a.tx)).toBe(true);
    expect(report.policyHash).toBe(pol.policyHash);
  }, 60_000);

  it('the autopilot refuses actions outside the sealed orders', async () => {
    const policy: PolicyDoc = {
      id: 'x',
      playerId: pid,
      nightId: 20261103,
      policy: { ...defaultPolicy('2026-11-03'), autoRetaliate: false },
      policyHash: '0x00' as `0x${string}`,
      commitTx: null,
      expiresAt: 0,
      sealed: true,
      createdAt: 0,
    };
    const out = await executeAutopilot(core.ctx, { address: '0x1111111111111111111111111111111111111111' }, policy, {
      kind: 'retaliate',
      detail: { targetCitadelDelta: 0 },
    });
    expect(out.allowed).toBe(false);
    expect(out.tx).toBeNull();
    // A wrong policy hash is refused by the chain even when the gate passes.
    const wrongHash = await executeAutopilot(core.ctx, { address: '0x1111111111111111111111111111111111111111' }, policy, {
      kind: 'repair',
      detail: { category: 'walls' },
    });
    expect(wrongHash.allowed).toBe(false);
    expect(wrongHash.reason).toMatch(/PolicyMismatch/);
  });

  it('applies the Architect fix and the base needs a new seal', async () => {
    if (!report.architect.patch) return;
    const before = (await call<HomeDTO>('GET', '/home')).base.currentHash;
    await call('POST', '/base/patch/apply', {});
    const home = await call<HomeDTO>('GET', '/home');
    expect(home.base.currentHash).not.toBe(before);
    expect(home.base.dirty).toBe(true);
  });

  it('profile reads badges and reputation from the chain', async () => {
    const p = await core.handle('GET', `/profile/${pid}`, undefined, null) as { badges: { earned: boolean; name: string }[]; reputation: { count: number }; battles: unknown[] };
    expect(p.badges.find((b) => b.name === 'First Seal')!.earned).toBe(true);
    expect(p.badges.find((b) => b.name === 'First Raid')!.earned).toBe(true);
    expect(p.reputation.count).toBeGreaterThanOrEqual(1);
    expect(p.battles.length).toBeGreaterThan(0);
  });
});
