/**
 * Simulation benchmark (adapted from the reused battle-sim benchmark: timing plus a
 * repeated-hash check). Runs on our three NPC bases.  pnpm --filter @realm/battle-engine bench
 */
import { simulate } from '../src';
import { goldenInputs } from '../test/golden-inputs';
import { npcBase, seedOf, southPush } from '../test/helpers';

const runs = Number(process.argv[2] ?? 30);
const inputs = [...goldenInputs(), ...['briarholt', 'kragmoor', 'saltspire'].map((k) => southPush(npcBase(k), seedOf(k)))];
for (const inp of inputs) simulate(inp); // warm up
let total = 0;
let count = 0;
for (const inp of inputs) {
  const first = simulate(inp).stateHash;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const h = simulate(inp).stateHash;
    if (h !== first) throw new Error('non-deterministic: repeated simulation changed its hash');
  }
  const ms = (performance.now() - t0) / runs;
  total += ms;
  count++;
  console.log(`${inp.seed.slice(0, 10)}…  ${ms.toFixed(2)} ms/sim`);
}
console.log(`average ${(total / count).toFixed(2)} ms per 90 s battle (budget 15 ms); hashes stable`);
