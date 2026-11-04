import { createPublicClient, encodeFunctionData, http } from 'viem';
import {
  EIP712_TYPES,
  deploymentFor,
  identityRegistryAbi,
  ledgerDomain,
  realmLedgerAbi,
  ERC8004,
  type Hex,
  type TxRef,
} from '@realm/shared';
import type { WalletBridge } from '../auth/bridge';
import { api } from '../net/api';
import { config } from '../net/config';

/**
 * Player-owned records (§15.7): with a live chain and a Privy wallet, the player's own sponsored
 * tx is sent and then confirmed by the server; otherwise (guest, mock chain, sponsorship down)
 * the relayer submits it with an EIP-712 signature (`*For`) — the universal fallback.
 */
function contracts() {
  const d = deploymentFor(config.chainId);
  const erc = ERC8004[config.chainId as 10143] ?? ERC8004[10143];
  return { ledger: d.RealmLedger, identity: (d.RealmAgentRegistry ?? erc.identity) as Hex };
}

async function ledgerNonce(ledger: Hex, player: Hex): Promise<bigint> {
  const client = createPublicClient({ transport: http(config.rpcUrl) });
  return (await client.readContract({ address: ledger, abi: realmLedgerAbi, functionName: 'nonces', args: [player] })) as bigint;
}

const canSendOwn = (w: WalletBridge | null, chainMode: string) =>
  !!w?.authenticated && !!w.address && chainMode === 'live' && api.mode === 'remote';

export async function sealBase(w: WalletBridge | null, chainMode: string, baseHash: Hex, version: number) {
  const { ledger } = contracts();
  if (canSendOwn(w, chainMode) && ledger) {
    try {
      const hash = await w!.sendTx({ to: ledger, data: encodeFunctionData({ abi: realmLedgerAbi, functionName: 'sealBase', args: [baseHash, version] }) });
      return api.post<{ sealTx: TxRef; baseHash: Hex }>('/base/seal/confirm', { txHash: hash });
    } catch (e) {
      console.warn('sponsored seal failed, falling back to the relayer', e);
      const deadline = Math.floor(Date.now() / 1000) + 600;
      const nonce = await ledgerNonce(ledger, w!.address!).catch(() => 0n);
      const signature = await w!
        .signTypedData({
          domain: ledgerDomain(config.chainId, ledger),
          types: EIP712_TYPES,
          primaryType: 'SealBase',
          message: { player: w!.address, baseHash, version, nonce, deadline: BigInt(deadline) },
        })
        .catch(() => undefined);
      return api.post<{ sealTx: TxRef; baseHash: Hex }>('/base/seal/relay', { signature, deadline });
    }
  }
  return api.post<{ sealTx: TxRef; baseHash: Hex }>('/base/seal/relay', {});
}

export async function registerAgent(w: WalletBridge | null, chainMode: string) {
  const { identity } = contracts();
  if (canSendOwn(w, chainMode)) {
    try {
      const { agentURI } = await api.post<{ agentURI: string }>('/chain/agent/card');
      const hash = await w!.sendTx({ to: identity, data: encodeFunctionData({ abi: identityRegistryAbi, functionName: 'register', args: [agentURI] }) });
      return api.post<{ agentId: string; agentTx: TxRef }>('/chain/agent/confirm', { txHash: hash });
    } catch (e) {
      console.warn('sponsored register failed, relaying', e);
    }
  }
  await api.post('/chain/agent/card');
  return api.post<{ agentId: string; agentTx: TxRef }>('/chain/agent/relay');
}

/**
 * Seal orders with `commitPolicy`: the player's own sponsored tx when possible, else the relayer.
 * Night orders confirm at /night/policy/confirm; Auto Orders (their own id range) at /auto/confirm.
 */
export async function commitPolicy<T = unknown>(
  w: WalletBridge | null,
  chainMode: string,
  p: { nightId: number; policyHash: Hex; expiresAt: number },
  confirmPath = '/night/policy/confirm',
): Promise<T> {
  const { ledger } = contracts();
  if (canSendOwn(w, chainMode) && ledger) {
    try {
      const hash = await w!.sendTx({
        to: ledger,
        data: encodeFunctionData({ abi: realmLedgerAbi, functionName: 'commitPolicy', args: [p.nightId, p.policyHash, BigInt(p.expiresAt)] }),
      });
      return api.post<T>(confirmPath, { txHash: hash });
    } catch (e) {
      console.warn('sponsored policy failed, relaying', e);
    }
  }
  return api.post<T>(confirmPath, {});
}

export const explorerUrl = (ref: TxRef | null | undefined) => ref?.url ?? null;
