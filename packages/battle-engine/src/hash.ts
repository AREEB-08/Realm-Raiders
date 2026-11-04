import { keccak_256 } from '@noble/hashes/sha3.js';

export type Hex = `0x${string}`;

export function toHex(bytes: Uint8Array): Hex {
  let s = '0x';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s as Hex;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error('invalid hex');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const keccak = (bytes: Uint8Array): Hex => toHex(keccak_256(bytes));
export const keccakBytes = (bytes: Uint8Array): Uint8Array => keccak_256(bytes);

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
