import { SUPPORTED_ENGINE_VERSIONS } from './constants';
import type { Hex } from './hash';
import { decodeReplay, type DecodedReplay } from './replay-codec';
import { replayHash } from './replay';
import { simulate } from './sim';
import type { BattleResult } from './types';

export interface VerifyExpect {
  seed?: Hex;
  baseHash?: Hex;
  stars?: number;
  destructionBp?: number;
  replayHash?: Hex;
}

export interface VerifyReport {
  ok: boolean;
  replayHash: Hex;
  result: BattleResult | null;
  decoded: DecodedReplay | null;
  reasons: string[];
}

/**
 * Re-run a replay and check it against what was committed (seed and base before the battle;
 * stars, destruction and replay hash after). Anyone can run this against chain data.
 */
export function verifyReplay(
  bytes: Uint8Array,
  expect: VerifyExpect = {},
  context: { attackerCitadel?: number; defenderStored?: { gold: number; timber: number } } = {},
): VerifyReport {
  const hash = replayHash(bytes);
  const reasons: string[] = [];
  let decoded: DecodedReplay;
  try {
    decoded = decodeReplay(bytes);
  } catch (e) {
    return {
      ok: false,
      replayHash: hash,
      result: null,
      decoded: null,
      reasons: [`decode: ${(e as Error).message}`],
    };
  }
  if (!SUPPORTED_ENGINE_VERSIONS.includes(decoded.engineVersion))
    reasons.push(`engine version ${decoded.engineVersion} is not supported`);
  if (!decoded.baseMatches) reasons.push('embedded base does not match its header hash');
  if (expect.seed && expect.seed.toLowerCase() !== decoded.seed.toLowerCase()) reasons.push('seed mismatch');
  if (expect.baseHash && expect.baseHash.toLowerCase() !== decoded.baseHash.toLowerCase())
    reasons.push('base hash mismatch');
  if (expect.replayHash && expect.replayHash.toLowerCase() !== hash.toLowerCase())
    reasons.push('replay hash mismatch');
  let result: BattleResult | null = null;
  if (reasons.length === 0) {
    try {
      result = simulate({ ...decoded, ...context });
    } catch (e) {
      reasons.push(`simulate: ${(e as Error).message}`);
    }
  }
  if (result) {
    if (expect.stars !== undefined && expect.stars !== result.stars) reasons.push('stars mismatch');
    if (expect.destructionBp !== undefined && expect.destructionBp !== result.destructionBp)
      reasons.push('destruction mismatch');
  }
  return { ok: reasons.length === 0, replayHash: hash, result, decoded, reasons };
}
