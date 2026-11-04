import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWalletClient, createPublicClient, http, keccak256, encodeAbiParameters, type Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MemoryRepo, newBurner } from '@realm/core';
import { LiveChain } from '../src/chain/live';

/**
 * `pnpm --filter @realm/server test:chain` — the relayer + LiveChain against a local anvil
 * (`anvil --chain-id 10143`), with our contracts deployed from contracts/artifacts (run
 * `pnpm --filter @realm/contracts build` first). Skipped when ANVIL_URL is not set.
 */
const ANVIL = process.env.ANVIL_URL;
const KEY = (process.env.ANVIL_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex;
const here = dirname(fileURLToPath(import.meta.url));
const art = (n: string) => JSON.parse(readFileSync(join(here, '..', '..', '..', 'contracts', 'artifacts', `${n}.json`), 'utf8')) as { abi: Abi; bytecode: Hex };

describe.skipIf(!ANVIL)('LiveChain on anvil', () => {
  it('seal → commit → reveal → record, policy + autopilot, badges', async () => {
    const account = privateKeyToAccount(KEY);
    const wallet = createWalletClient({ account, transport: http(ANVIL) });
    const pub = createPublicClient({ transport: http(ANVIL) });
    const chainId = await pub.getChainId();
    const deploy = async (name: string, args: unknown[]) => {
      const a = art(name);
      const hash = await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, chain: null });
      return (await pub.waitForTransactionReceipt({ hash })).contractAddress as Hex;
    };
    const ledger = await deploy('RealmLedger', [account.address, account.address]);
    const badges = await deploy('RealmBadges', [account.address, account.address, 'x']);
    const identity = await deploy('RealmAgentRegistry', []);
    const chain = new LiveChain(
      { chainId, rpcUrl: ANVIL!, explorerUrl: 'http://explorer', relayerKey: KEY, ledger, badges, identity, reputation: identity },
      new MemoryRepo(),
    );
    const player = newBurner();
    const npc = newBurner();
    const base = keccak256(encodeAbiParameters([{ type: 'string' }], ['base']));
    await chain.sealBaseFor({ address: npc.address, privateKey: npc.key }, base, 1);
    expect((await chain.sealOf(npc.address))?.baseHash).toBe(base);
    const battleId = keccak256(encodeAbiParameters([{ type: 'string' }], ['b1']));
    const secret = keccak256(encodeAbiParameters([{ type: 'string' }], ['s']));
    await chain.commitBattle({ battleId, attacker: player.address, defender: npc.address, defenderBaseHash: base, secretHash: keccak256(secret), attackerNonce: base });
    const { seed } = await chain.revealSeed(battleId, secret);
    expect(seed).toMatch(/^0x[0-9a-f]{64}$/);
    await chain.recordResult(battleId, base, 3, 10000, 40);
    expect(await chain.renownOf(player.address)).toBe(40);
    const policyHash = keccak256(encodeAbiParameters([{ type: 'string' }], ['orders']));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await chain.commitPolicyFor({ address: player.address, privateKey: player.key }, 20261103, policyHash, exp);
    await chain.logAutopilot(player.address, 20261103, policyHash, 1, base);
    await expect(chain.logAutopilot(player.address, 20261103, base, 1, base)).rejects.toThrow();
    await chain.awardBadge(player.address, 1);
    expect(await chain.badgesOf(player.address)).toEqual([1]);
    const reg = await chain.registerAgentFor(player.address, 'data:application/json,{}');
    expect(reg.agentId).toBe('1');
  }, 120_000);
});
