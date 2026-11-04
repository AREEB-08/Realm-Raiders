import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createBattle, keccak, replayHash, resultOf, simulate, stabilityDigest, stateHash, step, utf8, decodeReplay } from '../src';
import { npcBase, seedOf, southPush } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const witness = JSON.parse(readFileSync(join(fixtures, 'witness.json'), 'utf8')) as Record<
  string,
  {
    replayHash: string;
    stars: number;
    destructionBp: number;
    ticks: number;
    endReason: string;
    finalStateHash: string;
    every100: string[];
  }
>;

/**
 * Golden replays with witness hashes every 100 ticks (the historical-replay harness pattern
 * ported from the reused test suite): any rule or arithmetic drift shows up as the first
 * diverging 100-tick window.
 */
describe('golden replays', () => {
  // v1 = the frozen launch goldens (unchanged since launch), v2 = the troop update (spec F4).
  for (const name of ['golden-1', 'golden-2', 'golden-3', 'golden-v2-1', 'golden-v2-2', 'golden-v2-3']) {
    it(`${name} reproduces its result and witness hashes`, () => {
      const bytes = new Uint8Array(readFileSync(join(fixtures, `${name}.rrpl`)));
      const w = witness[name]!;
      expect(replayHash(bytes)).toBe(w.replayHash);
      const state = createBattle(decodeReplay(bytes));
      const hashes: string[] = [];
      while (!state.ended) {
        step(state);
        if (state.tick % 100 === 0) hashes.push(stateHash(state));
      }
      for (let i = 0; i < w.every100.length; i++) {
        expect(hashes[i], `${name} diverged in ticks ${i * 100}..${i * 100 + 100}`).toBe(w.every100[i]);
      }
      const r = resultOf(state);
      expect(r.stars).toBe(w.stars);
      expect(r.destructionBp).toBe(w.destructionBp);
      expect(r.endReason).toBe(w.endReason);
      expect(r.stateHash).toBe(w.finalStateHash);
    });
  }
});

describe('seed stability', () => {
  it('200 seeds give the same result hash twice in a row (and a pinned digest)', () => {
    const base = npcBase('briarholt');
    const hashes: string[] = [];
    for (let i = 0; i < 200; i++) {
      const inp = southPush(base, seedOf(`stability-${i}`));
      inp.actions = inp.actions.filter((a) => a.t < 200);
      inp.actions.push({ t: 200, kind: 'end' });
      const a = simulate(inp).stateHash;
      hashes.push(a);
      if (i % 40 === 0) expect(simulate(inp).stateHash).toBe(a);
    }
    const digest = keccak(utf8(hashes.join(',')));
    // The digest is what the Node-vs-WebView check compares (apps/client /dev/sim prints it).
    expect(digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Set(hashes).size).toBeGreaterThan(100);
  });
});

describe('cross-runtime digest', () => {
  it('the v1 (frozen launch rules) stabilityDigest is still pinned to its launch value', () => {
    const { digest } = stabilityDigest(200, 1);
    expect(digest).toBe(stabilityDigest(200, 1).digest);
    expect(digest).toBe(PINNED_DIGEST_V1);
  });

  it('the v2 (troop update) stabilityDigest is pinned too (regenerated on purpose, Phase 4)', () => {
    expect(stabilityDigest(200, 2).digest).toBe(PINNED_DIGEST_V2);
    expect(stabilityDigest(200).digest).toBe(PINNED_DIGEST_V2); // the current engine is v2
  });
});

/** Pinned when the v2 roster landed. */
const PINNED_DIGEST_V2 = '0xebb7fe9813a6223fb8e9ba560863721d376528f8d66c396e682fbe65330d5dc6';

/** Pinned at launch (engine v1). It must never change: old replays on Monad depend on it. */
const PINNED_DIGEST_V1 = '0xc0afd3965bc7fff416f2285bea70284ee39fd4dd6a88ed8a996e8f2be1037ebe';
