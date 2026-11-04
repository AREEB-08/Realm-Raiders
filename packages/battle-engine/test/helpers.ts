import { NPC_ISLANDS, type TroopId } from '@realm/game-data';
import { keccak, normalizeBase, utf8, type Action, type BattleInput, type SealedBase } from '../src';

export const seedOf = (label: string | number) => keccak(utf8(`seed:${label}`));

export function npcBase(key: string): SealedBase {
  const island = NPC_ISLANDS.find((i) => i.key === key)!;
  return normalizeBase(island.layout());
}

/** Deploy `count` troops in a row along y = y10 starting at x10, spaced by `gap` (tiles × 10). */
export function row(t: number, troop: TroopId, count: number, x10: number, y10: number, gap = 10): Action[] {
  return Array.from({ length: count }, (_, i) => ({ t: t + i, kind: 'deploy' as const, troop, x: x10 + i * gap, y: y10 }));
}

/**
 * A battle input. The launch-era tests pin engine v1 (frozen rules: they keep proving v1 still
 * re-simulates exactly); v2 tests pass `v = 2`.
 */
export function input(base: SealedBase, seed: string, army: Record<string, number>, actions: Action[], v = 1): BattleInput {
  return {
    engineVersion: v,
    seed: seed as `0x${string}`,
    base,
    army: { troops: Object.entries(army).map(([troop, count]) => ({ troop: troop as TroopId, level: 1, count })) },
    actions: [...actions].sort((a, b) => a.t - b.t),
  };
}

/** A standard south-side push used across tests. */
export function southPush(base: SealedBase, seed: string, v = 1) {
  return input(
    base,
    seed,
    { shield: 6, longbow: 8, general: 1 },
    [
      ...row(0, 'shield', 6, 110, 285, 12),
      { t: 10, kind: 'deploy', troop: 'general', x: 150, y: 285 },
      ...row(60, 'longbow', 8, 100, 290, 12),
      { t: 260, kind: 'rally' },
    ],
    v,
  );
}
