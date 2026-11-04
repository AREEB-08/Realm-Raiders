import { NPC_ISLANDS, type TroopId } from '@realm/game-data';
import { ENGINE_VERSION } from './constants';
import { keccak, utf8 } from './hash';
import { normalizeBase } from './layout-codec';
import { simulate } from './sim';
import type { Action, BattleInput } from './types';

/**
 * Cross-runtime determinism probe (§13.6): N seeded 10-second battles on Briarholt, hashed
 * together, under one engine version (v1 = the frozen launch rules, v2 = current). Node (vitest /
 * `pnpm --filter @realm/battle-engine digest`) and the Android WebView (/dev/sim) must print the
 * same digest for each version.
 */
export function stabilityDigest(n = 200, engineVersion = ENGINE_VERSION): { digest: `0x${string}` } {
  const island = NPC_ISLANDS.find((i) => i.key === 'briarholt')!;
  const base = normalizeBase(island.layout());
  const hashes: string[] = [];
  for (let i = 0; i < n; i++) {
    const row = (t: number, troop: TroopId, count: number, x: number, y: number, gap: number): Action[] =>
      Array.from({ length: count }, (_, k) => ({ t: t + k, kind: 'deploy' as const, troop, x: x + k * gap, y }));
    const input: BattleInput = {
      engineVersion,
      seed: keccak(utf8(`seed:stability-${i}`)),
      base,
      army: {
        troops: [
          { troop: 'shield', level: 1, count: 6 },
          { troop: 'longbow', level: 1, count: 8 },
          { troop: 'general', level: 1, count: 1 },
        ],
      },
      actions: ([
        ...row(0, 'shield', 6, 110, 285, 12),
        { t: 10, kind: 'deploy', troop: 'general', x: 150, y: 285 },
        ...row(60, 'longbow', 8, 100, 290, 12),
        { t: 200, kind: 'end' },
      ] as Action[]).sort((a, b) => a.t - b.t),
    };
    hashes.push(simulate(input).stateHash);
  }
  return { digest: keccak(utf8(hashes.join(','))) };
}
