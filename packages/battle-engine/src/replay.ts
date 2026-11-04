import { concatBytes, fromHex, keccak, type Hex } from './hash';

/** keccak256 of the replay bytes — identical to Solidity's keccak256. */
export const replayHash = (bytes: Uint8Array): Hex => keccak(bytes);

/**
 * The on-chain result commitment:
 *   keccak256(abi.encodePacked(bytes32 replayHash, uint8 stars, uint16 destructionBp, uint32 renown))
 * (packed big-endian, as Solidity encodes it).
 */
export function resultHash(replay: Hex, stars: number, destructionBp: number, renown: number): Hex {
  const tail = new Uint8Array(7);
  const view = new DataView(tail.buffer);
  view.setUint8(0, stars);
  view.setUint16(1, destructionBp, false);
  view.setUint32(3, renown >>> 0, false);
  return keccak(concatBytes(fromHex(replay), tail));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
