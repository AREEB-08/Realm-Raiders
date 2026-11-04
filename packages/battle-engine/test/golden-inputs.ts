import type { BattleInput } from '../src';
import { input, npcBase, row, seedOf, southPush } from './helpers';

/** The three golden battles: one per NPC island, one per end condition family. */
export function goldenInputs(): BattleInput[] {
  return [
    southPush(npcBase('briarholt'), seedOf('golden-1')),
    input(npcBase('kragmoor'), seedOf('golden-2'), { shield: 4, sapper: 4, longbow: 8, general: 1 }, [
      ...row(0, 'shield', 4, 285, 120, 0).map((a, i) => ({ ...a, y: 120 + i * 15 })),
      ...row(30, 'sapper', 4, 285, 140, 0).map((a, i) => ({ ...a, y: 140 + i * 5 })),
      { t: 40, kind: 'deploy', troop: 'general', x: 285, y: 150 },
      ...row(90, 'longbow', 8, 290, 110, 0).map((a, i) => ({ ...a, y: 110 + i * 10 })),
      { t: 220, kind: 'rally' },
    ]),
    input(npcBase('saltspire'), seedOf('golden-3'), { drake: 3, longbow: 5, general: 1 }, [
      ...row(0, 'drake', 3, 10, 100, 0).map((a, i) => ({ ...a, y: 100 + i * 50 })),
      { t: 30, kind: 'deploy', troop: 'general', x: 10, y: 150 },
      ...row(70, 'longbow', 5, 10, 120, 0).map((a, i) => ({ ...a, y: 120 + i * 15 })),
      { t: 200, kind: 'rally' },
    ]),
  ];
}

/**
 * The three engine-v2 golden battles (spec F4 roster): one per rival island, each using the new
 * attacks — sword rush + archers, Stone Giants + Sappers + Ember Mages, a Fire Dragon raid.
 */
export function goldenInputsV2(): BattleInput[] {
  return [
    input(
      npcBase('briarholt'),
      seedOf('golden-v2-1'),
      { shield: 12, longbow: 10, general: 1 },
      [
        ...row(0, 'shield', 12, 100, 285, 8),
        { t: 10, kind: 'deploy', troop: 'general', x: 150, y: 285 },
        ...row(50, 'longbow', 10, 100, 290, 10),
        { t: 220, kind: 'rally' },
      ],
      2,
    ),
    input(
      npcBase('kragmoor'),
      seedOf('golden-v2-2'),
      { ravager: 2, shield: 8, sapper: 4, mage: 2, general: 1 },
      [
        ...row(0, 'ravager', 2, 285, 140, 0).map((a, i) => ({ ...a, y: 140 + i * 20 })),
        { t: 50, kind: 'deploy', troop: 'general', x: 285, y: 150 },
        ...row(60, 'shield', 8, 285, 120, 0).map((a, i) => ({ ...a, y: 120 + i * 8 })),
        ...row(150, 'sapper', 4, 285, 140, 0).map((a, i) => ({ ...a, y: 140 + i * 6 })),
        ...row(170, 'mage', 2, 285, 130, 0).map((a, i) => ({ ...a, y: 130 + i * 30 })),
        { t: 300, kind: 'rally' },
      ],
      2,
    ),
    input(
      npcBase('saltspire'),
      seedOf('golden-v2-3'),
      { drake: 1, longbow: 6, mage: 1, general: 1 },
      [
        { t: 0, kind: 'deploy', troop: 'drake', x: 10, y: 150 },
        { t: 20, kind: 'deploy', troop: 'general', x: 10, y: 140 },
        ...row(50, 'longbow', 6, 10, 110, 0).map((a, i) => ({ ...a, y: 110 + i * 15 })),
        { t: 80, kind: 'deploy', troop: 'mage', x: 10, y: 160 },
        { t: 200, kind: 'rally' },
      ],
      2,
    ),
  ];
}
