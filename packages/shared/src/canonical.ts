import { keccak_256 } from '@noble/hashes/sha3.js';

export type Hex = `0x${string}`;

/** Canonical JSON: object keys sorted, no whitespace, no undefined values (§14.3). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function hexOf(bytes: Uint8Array): Hex {
  let s = '0x';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s as Hex;
}

export function bytesOf(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const keccakHex = (bytes: Uint8Array): Hex => hexOf(keccak_256(bytes));
export const keccakUtf8 = (text: string): Hex => keccakHex(new TextEncoder().encode(text));

/** keccak256(utf8(canonicalJson(value))) — used for policy and appearance hashes. */
export const canonicalHash = (value: unknown): Hex => keccakUtf8(canonicalJson(value));

export const shortHash = (h: string | null | undefined, head = 6, tail = 4) =>
  !h ? '' : h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;

export function randomHex32(): Hex {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return hexOf(bytes);
}
