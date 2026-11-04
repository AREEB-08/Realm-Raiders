import { describe, expect, it } from 'vitest';
import { encodePacked, hashTypedData, keccak256, toBytes } from 'viem';
import {
  EIP712_TYPES,
  NightPolicy,
  appearanceHash,
  canonicalJson,
  defaultAppearance,
  defaultPolicy,
  describePolicy,
  isActionAllowed,
  ledgerDomain,
  merkleProof,
  merkleRoot,
  nightIdOf,
  policyHash,
  toolsFor,
  verifyProof,
  Appearance,
} from '../src';
import { resultHash, keccak, utf8 } from '@realm/battle-engine';

describe('canonical hashing', () => {
  it('canonical JSON sorts keys and strips whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, { d: null, c: 'x' }] })).toBe('{"a":[true,{"c":"x","d":null}],"b":1}');
  });

  it('policyHash equals keccak256(utf8(canonicalJson(policy))) as viem computes it', () => {
    const p = defaultPolicy('2026-11-03');
    expect(policyHash(p)).toBe(keccak256(toBytes(canonicalJson(p))));
    expect(nightIdOf(p.night)).toBe(20261103);
    expect(NightPolicy.parse(p)).toEqual(p);
  });

  it('appearance hash is stable under key order', () => {
    const a = defaultAppearance('skyrend');
    const { faction, ...rest } = a;
    const reordered = JSON.parse(JSON.stringify({ faction, ...rest }));
    expect(appearanceHash(Appearance.parse(reordered))).toBe(appearanceHash(a));
  });
});

describe('result commitment', () => {
  it('matches viem encodePacked(bytes32,uint8,uint16,uint32)', () => {
    const rh = keccak(utf8('replay'));
    const viemHash = keccak256(encodePacked(['bytes32', 'uint8', 'uint16', 'uint32'], [rh, 3, 9876, 41]));
    expect(resultHash(rh, 3, 9876, 41)).toBe(viemHash);
  });
});

describe('night policy gate', () => {
  const p = { ...defaultPolicy('2026-11-03'), autoRetaliate: false };
  it('rejects actions outside the sealed orders', () => {
    expect(isActionAllowed(p, { kind: 'retaliate', detail: { targetCitadelDelta: 0 } }).ok).toBe(false);
    expect(isActionAllowed(p, { kind: 'repair', detail: { category: 'resources' } }).ok).toBe(false);
    expect(isActionAllowed(p, { kind: 'shield', detail: { lossPct: 10 } }).ok).toBe(false);
  });
  it('accepts actions inside them', () => {
    expect(isActionAllowed(p, { kind: 'repair', detail: { category: 'walls' } }).ok).toBe(true);
    expect(isActionAllowed(p, { kind: 'shield', detail: { lossPct: 80 } }).ok).toBe(true);
    expect(describePolicy(p)).toHaveLength(4);
  });
});

describe('merkle', () => {
  it('proofs verify for every leaf and fail for a stranger', () => {
    const leaf = (i: number) => keccak256(encodePacked(['uint64'], [BigInt(i)]));
    const leaves = Array.from({ length: 7 }, (_, i) => leaf(i));
    const root = merkleRoot(leaves);
    leaves.forEach((l, i) => expect(verifyProof(l, merkleProof(leaves, i), root)).toBe(true));
    expect(verifyProof(leaf(99), merkleProof(leaves, 0), root)).toBe(false);
  });
});

describe('agent tools + EIP-712', () => {
  it('generates OpenAI tool JSON for each role', () => {
    const tools = toolsFor('strategist');
    expect(tools.map((t) => t.function.name)).toContain('run_simulations');
    expect(JSON.stringify(tools)).toContain('"maximum":50');
  });
  it('typed data hashes with viem', () => {
    const h = hashTypedData({
      domain: ledgerDomain(10143, '0x2222222222222222222222222222222222222222'),
      types: EIP712_TYPES,
      primaryType: 'SealBase',
      message: { player: '0x1111111111111111111111111111111111111111', baseHash: keccak(utf8('b')), version: 1, nonce: 0n, deadline: 1n },
    });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
