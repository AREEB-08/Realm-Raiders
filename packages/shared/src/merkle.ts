import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesOf, hexOf, type Hex } from './canonical';


function hashPair(a: Hex, b: Hex): Hex {
  const [lo, hi] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  const buf = new Uint8Array(64);
  buf.set(bytesOf(lo), 0);
  buf.set(bytesOf(hi), 32);
  return hexOf(keccak_256(buf));
}

/** Merkle root with sorted pairs (OpenZeppelin MerkleProof compatible); odd nodes carry up. */
export function merkleRoot(leaves: Hex[]): Hex {
  if (leaves.length === 0) return `0x${'0'.repeat(64)}`;
  let level = [...leaves];
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i]!, level[i + 1]!) : level[i]!);
    level = next;
  }
  return level[0]!;
}

export function merkleProof(leaves: Hex[], index: number): Hex[] {
  const proof: Hex[] = [];
  let level = [...leaves];
  let i = index;
  while (level.length > 1) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push(level[sibling]!);
    const next: Hex[] = [];
    for (let k = 0; k < level.length; k += 2) next.push(k + 1 < level.length ? hashPair(level[k]!, level[k + 1]!) : level[k]!);
    level = next;
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h.toLowerCase() === root.toLowerCase();
}
