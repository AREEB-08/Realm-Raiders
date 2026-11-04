/**
 * Re-verify a battle from anywhere (§11 screen 08, §2.2):
 *   pnpm verify-replay packages/battle-engine/fixtures/golden-1.rrpl
 *   pnpm verify-replay <battleId> --api http://localhost:8787
 *   pnpm verify-replay <battleId> --api https://api… --chain --rpc https://testnet-rpc.monad.xyz --ledger 0x…
 * Re-simulates the replay with the deterministic engine; with --chain it also checks the replay
 * hash, stars and destruction recorded in RealmLedger.battles(battleId).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createPublicClient, http, keccak256, toBytes } from 'viem';
import { base64ToBytes, verifyReplay } from '@realm/battle-engine';
import { deploymentFor, realmLedgerAbi } from '@realm/shared';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!target) {
  console.error('usage: verify-replay <file.rrpl | battleId> [--api URL] [--chain --rpc URL --ledger ADDR]');
  process.exit(2);
}

let bytes: Uint8Array;
let expect: { seed?: `0x${string}`; baseHash?: `0x${string}` } = {};
if (existsSync(target)) {
  bytes = new Uint8Array(readFileSync(target));
} else {
  const api = flag('api') ?? 'http://localhost:8787';
  const res = await fetch(`${api.replace(/\/$/, '')}/battle/${target}/replay`);
  if (!res.ok) {
    console.error(`could not fetch replay: HTTP ${res.status}`);
    process.exit(1);
  }
  const r = (await res.json()) as { replay: string; seed: `0x${string}`; baseHash: `0x${string}` };
  bytes = base64ToBytes(r.replay);
  expect = { seed: r.seed, baseHash: r.baseHash };
}

const report = verifyReplay(bytes, expect);
if (!report.ok || !report.result) {
  console.log(`MISMATCH ${report.replayHash}: ${report.reasons.join('; ')}`);
  process.exit(1);
}
const r = report.result;
console.log(`OK ${report.replayHash}  ${r.stars}★ ${r.destructionPct}%  (${r.endReason} at tick ${r.ticks})`);

if (args.includes('--chain') && !existsSync(target)) {
  const rpc = flag('rpc') ?? 'https://testnet-rpc.monad.xyz';
  const ledger = (flag('ledger') ?? deploymentFor(10143).RealmLedger) as `0x${string}` | null;
  if (!ledger) {
    console.error('no RealmLedger address (pass --ledger)');
    process.exit(1);
  }
  const client = createPublicClient({ transport: http(rpc) });
  const b = (await client.readContract({ address: ledger, abi: realmLedgerAbi, functionName: 'battles', args: [keccak256(toBytes(target))] })) as readonly unknown[];
  const [, , baseHash, , , , seed, replayHash, stars, bp] = b as [string, string, string, string, string, bigint, string, string, number, number];
  const checks = [
    ['seed', seed.toLowerCase() === (report.decoded?.seed ?? '').toLowerCase()],
    ['base hash', baseHash.toLowerCase() === (report.decoded?.baseHash ?? '').toLowerCase()],
    ['replay hash', replayHash.toLowerCase() === report.replayHash.toLowerCase()],
    ['stars', Number(stars) === r.stars],
    ['destruction', Number(bp) === r.destructionBp],
  ] as const;
  for (const [name, ok] of checks) console.log(`${ok ? '✓' : '✗'} on-chain ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}
