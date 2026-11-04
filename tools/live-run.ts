/**
 * End-to-end run against a live server (CHAIN_MODE=live on Monad testnet):
 *   pnpm tsx tools/live-run.ts [--api http://localhost:8787]
 * Plays every MONAD moment of §8.1 through the real API and prints each transaction:
 * agent ID card (ERC-8004), base seal, seed commit/reveal, verified result + reputation +
 * badges, sealed night orders, night defences + autopilot actions, Auto Mode (sealed orders +
 * officers' moves logged on chain), profile.
 */
import { bytesToBase64, createBattle, encodeReplay, step, ENGINE_VERSION } from '@realm/battle-engine';
import { defaultAppearance, type BattleCommitDTO, type HomeDTO, type TxRef, type WarRoomDTO } from '@realm/shared';

const api = (process.argv.includes('--api') ? process.argv[process.argv.indexOf('--api') + 1]! : 'http://localhost:8787').replace(/\/$/, '');
let session = '';
const txs: { step: string; tx: TxRef }[] = [];
const note = (stepName: string, tx: TxRef | null | undefined) => {
  if (tx) txs.push({ step: stepName, tx });
};

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(api + path, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(session ? { authorization: `Bearer ${session}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${j.error}`);
  return j;
}
const t = async <T>(label: string, f: () => Promise<T>) => {
  const t0 = Date.now();
  const v = await f();
  console.log(`✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return v;
};

const health = await call<{ chain: { mode: string; block: number }; relayerBalance: string; llm: { mode: string } }>('GET', '/health');
console.log(`server: chain ${health.chain.mode} @ block ${health.chain.block}, relayer ${health.relayerBalance} MON, officers ${health.llm.mode}`);
if (health.chain.mode !== 'live') throw new Error('server is not on the live chain');

const login = await call<{ session: string; playerId: string; address: string }>('POST', '/auth/demo');
session = login.session;
console.log(`player ${login.playerId} (${login.address})`);

await call('PUT', '/general', { name: 'Brannoc', personality: 'bold', faction: 'thornmarch', appearance: defaultAppearance('thornmarch') });
const agent = await t('ERC-8004 agent card registered + transferred to the player', () =>
  call<{ agentId: string; agentTx: TxRef }>('POST', '/chain/agent/relay'),
);
note(`agent #${agent.agentId}`, agent.agentTx);

const seal = await t('base sealed (sealBaseFor, EIP-712 signed by the player)', () => call<{ sealTx: TxRef; baseHash: string }>('POST', '/base/seal/relay', {}));
note('BaseSealed', seal.sealTx);

const targets = await call<{ islands: { islandId: string; name: string; sealed: boolean }[] }>('GET', '/targets');
console.log(`targets: ${targets.islands.map((i) => `${i.name}${i.sealed ? ' ✓sealed-on-chain' : ' ✗'}`).join(', ')}`);

const room0 = await call<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'briarholt' });
let room: WarRoomDTO & { status?: string } = room0;
for (let i = 0; i < 120 && room.status !== 'ready'; i++) {
  await new Promise((r) => setTimeout(r, 500));
  room = await call('GET', `/warroom/${room0.warRoomId}`);
}
console.log(`war room: ${room.plans.map((p) => `${p.planId} ${p.stats?.winRate}%`).join(', ')} → ${room.recommended}`);

const commit = await t('seed locked (commitBattle → revealSeed in a later block)', () =>
  call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room.warRoomId, planId: room.recommended }),
);
note('BattleCommitted', commit.commitTx);
note('SeedLocked', commit.revealTx);
const s = createBattle({ engineVersion: ENGINE_VERSION, seed: commit.seed, base: commit.base, army: commit.army, actions: commit.plan.actions });
while (!s.ended) step(s);
const replay = encodeReplay({ engineVersion: ENGINE_VERSION, seed: commit.seed, base: commit.base, army: commit.army, actions: s.applied });
const sub = await t('replay re-simulated by the server and recorded', () =>
  call<{ verified: boolean; result: { stars: number; destructionPct: number; renown: number }; resultTx: TxRef; feedbackTx: TxRef; badges: { name: string; tx: TxRef }[] }>(
    'POST',
    `/battle/${commit.battleId}/submit`,
    { replay: bytesToBase64(replay) },
  ),
);
console.log(`  verified=${sub.verified} ${sub.result?.stars}★ ${sub.result?.destructionPct}% +${sub.result?.renown} Renown`);
note('BattleResolved', sub.resultTx);
note('ERC-8004 feedback', sub.feedbackTx);
for (const b of sub.badges) note(`badge ${b.name}`, b.tx);

const pol = await call<{ policyHash: string }>('POST', '/night/policy', {});
const sealedPol = await t('night orders sealed (commitPolicyFor)', () => call<{ commitTx: TxRef }>('POST', '/night/policy/confirm', {}));
note('PolicyCommitted', sealedPol.commitTx);
await t('night simulated (3 seeded NPC raids + autopilot under the orders)', () => call('POST', '/night/simulate'));
const rep = (await call<{ report: { attacks: { attacker: string; stars: number; resultTx: TxRef | null }[]; actions: { text: string; allowed: boolean; tx: TxRef | null }[] } }>('GET', '/night/report')).report;
for (const a of rep.attacks) note(`DefenseRecorded vs ${a.attacker} (${a.stars}★)`, a.resultTx);
for (const a of rep.actions) if (a.tx) note(`AutopilotAction: ${a.text}`, a.tx);
console.log(`  policy ${pol.policyHash.slice(0, 12)}…, ${rep.actions.filter((a) => a.allowed).length} actions within orders, ${rep.actions.filter((a) => !a.allowed).length} refused`);

// Auto Mode: the officers' orders are sealed on chain under their own id, then every move is
// checked against them and logged with logAutopilot before it happens.
type AutoLog = { kind: string; text: string; allowed: boolean; tx: TxRef | null };
const prep = await call<{ nightId: number; policyHash: string }>('POST', '/auto/prepare', {
  minutes: 30,
  orders: { raidsPerHour: 1, minWinPct: 70, reserveGoldPct: 30, upgradeFirst: 'defences', strikeBack: true, shieldAtPct: 60 },
});
const auto = await t('Auto Orders sealed (commitPolicyFor, own session id)', () => call<{ commitTx: TxRef | null }>('POST', '/auto/confirm', {}));
note('PolicyCommitted (Auto Orders)', auto.commitTx);
let autoLog: AutoLog[] = [];
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  autoLog = (await call<{ session: { log: AutoLog[] } }>('GET', '/auto')).session.log;
  if (autoLog.some((e) => e.kind === 'raid')) break;
}
for (const e of autoLog) if (e.kind !== 'note' && e.tx) note(`AutopilotAction (auto): ${e.text}`, e.tx);
await call('POST', '/auto/stop', {});
const moves = autoLog.filter((e) => e.kind !== 'note' && e.allowed);
console.log(`✓ Auto Mode: orders ${prep.policyHash.slice(0, 12)}… (session ${prep.nightId}), ${moves.length} moves logged on chain, then TAKE CONTROL`);
for (const e of autoLog.filter((x) => x.kind !== 'note')) console.log(`  ${e.allowed ? '✓' : '✗'} ${e.text}`);

const home = await call<HomeDTO>('GET', '/home');
const prof = await call<{ badges: { name: string; earned: boolean }[]; reputation: { count: number; average: number; source: string }; renown: number }>('GET', `/profile/${home.player.id}`);
console.log(`profile: renown ${prof.renown}; badges ${prof.badges.filter((b) => b.earned).map((b) => b.name).join(', ')}; reputation ${prof.reputation.count} feedback, avg ${prof.reputation.average} (${prof.reputation.source})`);

console.log(`\n${txs.length} transactions:`);
for (const x of txs) console.log(`  ${x.step.padEnd(44)} ${x.tx.url ?? x.tx.hash}`);
