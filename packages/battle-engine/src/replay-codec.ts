import { TROOP_IDS, type TroopId } from '@realm/game-data';
import { MAX_ACTIONS, MAX_REPLAY_BYTES, REPLAY_FORMAT, REPLAY_MAGIC } from './constants';
import { fromHex, toHex, type Hex } from './hash';
import { baseHash, decodeBase, encodeBase } from './layout-codec';
import type { Action, ArmyEntry, BattleInput } from './types';

const KIND = { deploy: 0, rally: 1, end: 2 } as const;

/**
 * Replay bytes (§13.5), little-endian, no padding:
 *   "RRPL" | u8 formatVersion=1 | u16 engineVersion | bytes32 seed | bytes32 baseHash
 *   | u8 troopKinds | troopKinds × [u8 troopIdx, u8 level, u16 count]
 *   | u16 actionCount | actionCount × [u16 tick, u8 kind, u8 troopIdx, u16 x10, u16 y10]
 *   | u16 baseLen | base bytes            ← trailer: the sealed base itself, so a replay
 *                                           verifies standalone against the on-chain baseHash
 * Army entries are written in troop-index order; actions in input order.
 */
export function encodeReplay(input: BattleInput): Uint8Array {
  if (input.actions.length > MAX_ACTIONS) throw new Error('too many actions');
  const army = [...input.army.troops]
    .filter((e) => e.count > 0)
    .sort((a, b) => TROOP_IDS.indexOf(a.troop) - TROOP_IDS.indexOf(b.troop));
  const base = encodeBase(input.base);
  const size =
    4 + 1 + 2 + 32 + 32 + 1 + army.length * 4 + 2 + input.actions.length * 8 + 2 + base.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const m of REPLAY_MAGIC) out[o++] = m;
  out[o++] = REPLAY_FORMAT;
  view.setUint16(o, input.engineVersion, true);
  o += 2;
  out.set(fromHex(input.seed), o);
  o += 32;
  out.set(fromHex(baseHash(input.base)), o);
  o += 32;
  out[o++] = army.length;
  for (const e of army) {
    out[o++] = TROOP_IDS.indexOf(e.troop);
    out[o++] = e.level;
    view.setUint16(o, e.count, true);
    o += 2;
  }
  view.setUint16(o, input.actions.length, true);
  o += 2;
  for (const a of input.actions) {
    view.setUint16(o, a.t, true);
    out[o + 2] = KIND[a.kind];
    if (a.kind === 'deploy') {
      out[o + 3] = TROOP_IDS.indexOf(a.troop);
      view.setUint16(o + 4, a.x, true);
      view.setUint16(o + 6, a.y, true);
    }
    o += 8;
  }
  view.setUint16(o, base.length, true);
  o += 2;
  out.set(base, o);
  return out;
}

export interface DecodedReplay extends BattleInput {
  formatVersion: number;
  baseHash: Hex;
  /** True when the embedded base hashes to the header's baseHash. */
  baseMatches: boolean;
}

export function decodeReplay(bytes: Uint8Array): DecodedReplay {
  if (bytes.length > MAX_REPLAY_BYTES) throw new Error('replay too large');
  if (bytes.length < 4 + 1 + 2 + 64 + 1 + 2 + 2) throw new Error('replay too short');
  for (let i = 0; i < 4; i++) if (bytes[i] !== REPLAY_MAGIC[i]) throw new Error('not a replay (magic)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const formatVersion = bytes[o++]!;
  if (formatVersion !== REPLAY_FORMAT) throw new Error(`unknown replay format ${formatVersion}`);
  const engineVersion = view.getUint16(o, true);
  o += 2;
  const seed = toHex(bytes.subarray(o, o + 32));
  o += 32;
  const headerBaseHash = toHex(bytes.subarray(o, o + 32));
  o += 32;
  const kinds = bytes[o++]!;
  const troops: ArmyEntry[] = [];
  for (let i = 0; i < kinds; i++) {
    const troop = TROOP_IDS[bytes[o]!] as TroopId | undefined;
    if (!troop) throw new Error('unknown troop index');
    troops.push({ troop, level: bytes[o + 1]!, count: view.getUint16(o + 2, true) });
    o += 4;
  }
  const count = view.getUint16(o, true);
  o += 2;
  if (count > MAX_ACTIONS) throw new Error('too many actions');
  if (o + count * 8 + 2 > bytes.length) throw new Error('replay truncated');
  const actions: Action[] = [];
  for (let i = 0; i < count; i++) {
    const t = view.getUint16(o, true);
    const kind = bytes[o + 2]!;
    if (kind === KIND.deploy) {
      const troop = TROOP_IDS[bytes[o + 3]!] as TroopId | undefined;
      if (!troop) throw new Error('unknown troop index in action');
      actions.push({
        t,
        kind: 'deploy',
        troop,
        x: view.getUint16(o + 4, true),
        y: view.getUint16(o + 6, true),
      });
    } else if (kind === KIND.rally) actions.push({ t, kind: 'rally' });
    else if (kind === KIND.end) actions.push({ t, kind: 'end' });
    else throw new Error('unknown action kind');
    o += 8;
  }
  const baseLen = view.getUint16(o, true);
  o += 2;
  if (o + baseLen !== bytes.length) throw new Error('replay length mismatch');
  const base = decodeBase(bytes.subarray(o, o + baseLen));
  return {
    formatVersion,
    engineVersion,
    seed,
    baseHash: headerBaseHash,
    baseMatches: baseHash(base) === headerBaseHash,
    base,
    army: { troops },
    actions,
  };
}
