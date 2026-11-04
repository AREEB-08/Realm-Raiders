import { beforeEach, describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodePacked, keccak256, toBytes, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { EIP712_TYPES, ledgerDomain } from '../../packages/shared/src/abis';
import { Evm, type Contract } from './evm';

/** The §15.9 minimum suite, executed on an in-process EVM (mirrors test/RealmLedger.t.sol). */
const admin = ('0x' + '01'.repeat(32)) as Hex;
const relayer = ('0x' + '02'.repeat(32)) as Hex;
const playerKey = ('0x' + '03'.repeat(32)) as Hex;
const npcKey = ('0x' + '04'.repeat(32)) as Hex;
const BASE = keccak256(toBytes('base'));

let evm: Evm;
let ledger: Contract;
let siege: Contract;
let badges: Contract;
let player: Hex;
let npc: Hex;

beforeEach(async () => {
  evm = await Evm.create();
  const adminAddr = await evm.fund(admin);
  const relayerAddr = await evm.fund(relayer);
  player = await evm.fund(playerKey);
  npc = await evm.fund(npcKey);
  ledger = await evm.deploy(admin, 'RealmLedger', [adminAddr, relayerAddr]);
  siege = await evm.deploy(admin, 'ClanSiege', [adminAddr, relayerAddr]);
  badges = await evm.deploy(admin, 'RealmBadges', [adminAddr, relayerAddr, 'https://api/badges/{id}.json']);
});

const secretHash = (s: Hex) => keccak256(encodeAbiParameters([{ type: 'bytes32' }], [s]));

async function sealSig(nonce: bigint, deadline: bigint, version = 2) {
  return privateKeyToAccount(playerKey).signTypedData({
    domain: ledgerDomain(1, ledger.address),
    types: EIP712_TYPES,
    primaryType: 'SealBase',
    message: { player, baseHash: BASE, version, nonce, deadline },
  });
}

describe('RealmLedger', () => {
  it('sealBase stores and emits', async () => {
    const out = await ledger.write(playerKey, 'sealBase', [BASE, 1]);
    expect(out.ok).toBe(true);
    expect(out.logs[0]!.eventName).toBe('BaseSealed');
    const [h, v] = await ledger.read<[Hex, number, bigint]>('sealOf', [player]);
    expect(h).toBe(BASE);
    expect(v).toBe(1);
  });

  it('sealBaseFor accepts the EIP-712 signature our client/server produce, rejects replay + expiry', async () => {
    const deadline = evm.time + 600n;
    const sig = await sealSig(0n, deadline);
    expect((await ledger.write(relayer, 'sealBaseFor', [npc, BASE, 2, deadline, sig])).error).toBe('BadSignature');
    expect((await ledger.write(relayer, 'sealBaseFor', [player, BASE, 2, deadline, sig])).ok).toBe(true);
    expect((await ledger.write(relayer, 'sealBaseFor', [player, BASE, 2, deadline, sig])).error).toBe('BadSignature');
    const late = await sealSig(1n, evm.time - 1n);
    expect((await ledger.write(relayer, 'sealBaseFor', [player, BASE, 2, evm.time - 1n, late])).error).toBe('Expired');
  });

  it('relayer-only functions refuse others', async () => {
    const out = await ledger.write(playerKey, 'commitBattle', [keccak256(toBytes('b')), player, npc, BASE, BASE, BASE]);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('AccessControlUnauthorizedAccount');
  });

  it('commit requires a sealed, matching base; reveal needs the right secret; record needs a seed', async () => {
    const id = keccak256(toBytes('battle'));
    const secret = keccak256(toBytes('secret'));
    expect((await ledger.write(relayer, 'commitBattle', [id, player, npc, BASE, secretHash(secret), BASE])).error).toBe('BaseNotSealed');
    await ledger.write(npcKey, 'sealBase', [BASE, 1]);
    expect((await ledger.write(relayer, 'commitBattle', [id, player, npc, keccak256(toBytes('x')), secretHash(secret), BASE])).error).toBe('BaseNotSealed');
    expect((await ledger.write(relayer, 'commitBattle', [id, player, npc, BASE, secretHash(secret), BASE])).ok).toBe(true);
    expect((await ledger.write(relayer, 'recordResult', [id, BASE, 3, 10000, 40])).error).toBe('NotSeeded');
    expect((await ledger.write(relayer, 'revealSeed', [id, keccak256(toBytes('wrong'))])).error).toBe('BadSecret');
    const reveal = await ledger.write(relayer, 'revealSeed', [id, secret]);
    expect(reveal.logs[0]!.eventName).toBe('SeedLocked');
    expect((await ledger.write(relayer, 'recordResult', [id, BASE, 4, 10000, 40])).error).toBe('BadResult');
    const rec = await ledger.write(relayer, 'recordResult', [id, BASE, 3, 10000, 40]);
    expect(rec.logs[0]!.eventName).toBe('BattleResolved');
    expect(await ledger.read<bigint>('renownOf', [player])).toBe(40n);
    // On-chain result commitment == off-chain resultHash (engine) == viem encodePacked.
    expect(await ledger.read<Hex>('resultHashOf', [id])).toBe(
      keccak256(encodePacked(['bytes32', 'uint8', 'uint16', 'uint32'], [BASE, 3, 10000, 40])),
    );
  });

  it('night defences credit the defender', async () => {
    const id = keccak256(toBytes('night'));
    const secret = keccak256(toBytes('s'));
    await ledger.write(playerKey, 'sealBase', [BASE, 1]);
    await ledger.write(relayer, 'commitBattle', [id, npc, player, BASE, secretHash(secret), BASE]);
    await ledger.write(relayer, 'revealSeed', [id, secret]);
    const out = await ledger.write(relayer, 'recordDefence', [id, BASE, 1, 4000, 8]);
    expect(out.logs[0]!.eventName).toBe('DefenseRecorded');
    expect(await ledger.read<bigint>('renownOf', [player])).toBe(8n);
  });

  it('policy cannot be overwritten while active; autopilot checks hash and expiry', async () => {
    const ph = keccak256(toBytes('orders'));
    const exp = evm.time + 8n * 3600n;
    expect((await ledger.write(playerKey, 'commitPolicy', [20261103, ph, exp])).ok).toBe(true);
    expect((await ledger.write(playerKey, 'commitPolicy', [20261103, keccak256(toBytes('x')), exp])).error).toBe('PolicyActive');
    expect((await ledger.write(relayer, 'logAutopilot', [player, 20261103, ph, 1, BASE])).logs[0]!.eventName).toBe('AutopilotAction');
    expect((await ledger.write(relayer, 'logAutopilot', [player, 20261103, keccak256(toBytes('forged')), 3, BASE])).error).toBe('PolicyMismatch');
    evm.warp(9n * 3600n);
    expect((await ledger.write(relayer, 'logAutopilot', [player, 20261103, ph, 1, BASE])).error).toBe('PolicyMismatch');
  });
});

describe('ClanSiege', () => {
  it('HP never underflows and BossDefeated fires once', async () => {
    await siege.write(relayer, 'startSiege', [1n, 25n, evm.time + 1800n]);
    await siege.write(playerKey, 'hit', [1n]);
    const a = await siege.write(relayer, 'hitBatch', [1n, [player], [2], [20], BASE]);
    const b = await siege.write(relayer, 'hitBatch', [1n, [player], [2], [20], BASE]);
    const defeats = [...a.logs, ...b.logs].filter((l) => l.eventName === 'BossDefeated');
    expect(defeats).toHaveLength(1);
    const s = await siege.read<[bigint, bigint, bigint, number, boolean]>('sieges', [1n]);
    expect(s[1]).toBe(0n);
    expect(s[4]).toBe(true);
    expect((await siege.write(playerKey, 'hit', [1n])).error).toBe('SiegeOver');
  });
});

describe('RealmBadges', () => {
  it('awards once and is soulbound', async () => {
    expect((await badges.write(relayer, 'award', [player, 1n])).ok).toBe(true);
    expect((await badges.write(relayer, 'award', [player, 1n])).error).toBe('AlreadyAwarded');
    expect(await badges.read<bigint>('balanceOf', [player, 1n])).toBe(1n);
    expect((await badges.write(playerKey, 'safeTransferFrom', [player, npc, 1n, 1n, '0x'])).error).toBe('Soulbound');
  });
});

describe('RealmDuels', () => {
  let duels: Contract;
  beforeEach(async () => {
    duels = await evm.deploy(admin, 'RealmDuels', [privateKeyToAccount(admin).address, privateKeyToAccount(relayer).address]);
  });
  const id = keccak256(toBytes('duel:1'));
  const rA = keccak256(toBytes('replayA'));
  const rB = keccak256(toBytes('replayB'));

  it('records once (relayer only); winner by stars, then destruction; a full tie is a draw', async () => {
    expect((await duels.write(playerKey, 'recordDuel', [id, player, npc, 3, 2, 10000, 7100, rA, rB])).ok).toBe(false);
    const out = await duels.write(relayer, 'recordDuel', [id, player, npc, 3, 2, 10000, 7100, rA, rB]);
    expect(out.ok).toBe(true);
    expect(out.logs[0]!.eventName).toBe('DuelRecorded');
    expect((out.logs[0]!.args as { winner: Hex }).winner.toLowerCase()).toBe(player.toLowerCase());
    expect((await duels.write(relayer, 'recordDuel', [id, player, npc, 3, 2, 10000, 7100, rA, rB])).error).toBe('DuelExists');
    const d = await duels.read<{ starsA: number; pctB: number; replayHashB: Hex; winner: Hex }>('duelOf', [id]);
    expect(d.starsA).toBe(3);
    expect(d.pctB).toBe(7100);
    expect(d.replayHashB).toBe(rB);
    expect(await duels.read<number>('winsOf', [player])).toBe(1);
    const byPct = await duels.write(relayer, 'recordDuel', [keccak256(toBytes('duel:2')), player, npc, 1, 1, 4800, 6400, rA, rB]);
    expect((byPct.logs[0]!.args as { winner: Hex }).winner.toLowerCase()).toBe(npc.toLowerCase());
    const draw = await duels.write(relayer, 'recordDuel', [keccak256(toBytes('duel:3')), player, npc, 2, 2, 5000, 5000, rA, rB]);
    expect((draw.logs[0]!.args as { winner: Hex }).winner).toBe('0x0000000000000000000000000000000000000000');
    expect((await duels.write(relayer, 'recordDuel', [keccak256(toBytes('duel:4')), player, npc, 4, 0, 0, 0, rA, rB])).error).toBe('BadResult');
    expect((await duels.write(relayer, 'recordDuel', [keccak256(toBytes('duel:5')), player, player, 1, 0, 0, 0, rA, rB])).error).toBe('SamePlayer');
  });
});
