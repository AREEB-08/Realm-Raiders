import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  formatEther,
  http,
  nonceManager,
  parseEventLogs,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { RpcPool } from './rpc-pool';
import { uid, type Chain, type ChainEvent, type CommitBattleArgs, type PlayerSigner, type RecordDuelArgs, type Repo, type TxDoc } from '@realm/core';
import {
  EIP712_TYPES,
  FEEDBACK_TAG1,
  FEEDBACK_TAG2,
  MONAD_TESTNET,
  explorerTx,
  identityRegistryAbi,
  ledgerDomain,
  realmBadgesAbi,
  realmLedgerAbi,
  realmDuelsAbi,
  reputationRegistryAbi,
  type Hex,
  type TxRef,
} from '@realm/shared';

export interface LiveChainConfig {
  chainId: number;
  rpcUrl: string;
  rpcFallback?: string;
  explorerUrl: string;
  relayerKey: Hex;
  ledger: Address;
  badges: Address;
  identity: Address;
  reputation: Address;
  /** RealmDuels (spec F9); Live Duels are decided off-chain until it is deployed. */
  duels?: Address | null;
}

const ZERO32 = `0x${'0'.repeat(64)}`;
const isRevert = (e: unknown) => /revert|execution reverted|PolicyMismatch|BaseNotSealed/i.test(String((e as Error)?.message ?? e));

/**
 * Monad testnet through viem. Player-owned records arrive either as the player's own sponsored
 * tx (verified by its event) or through the relayer with an EIP-712 signature. All relayer txs go
 * through one ordered queue with explicit gas (Monad charges the gas *limit*, §15.6).
 */
export class LiveChain implements Chain {
  readonly mode = 'live' as const;
  readonly chainId: number;
  readonly explorerUrl: string;
  readonly contracts: Record<string, string>;
  readonly pub: PublicClient;
  private wallet: WalletClient;
  private relayer: PrivateKeyAccount;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(e: ChainEvent) => void>();
  private polling: ReturnType<typeof setInterval> | null = null;
  private lastBlock = 0n;

  constructor(
    private readonly cfg: LiveChainConfig,
    private readonly repo: Repo,
    private readonly log: (m: string, x?: unknown) => void = () => {},
  ) {
    this.chainId = cfg.chainId;
    this.explorerUrl = cfg.explorerUrl;
    const chain = defineChain({ ...MONAD_TESTNET, id: cfg.chainId, rpcUrls: { default: { http: [cfg.rpcUrl] } } });
    // Each RPC gets its own connection pool that renews itself after a network change (rpc-pool.ts).
    const rpc = (url: string) => http(url, { fetchFn: new RpcPool(new URL(url).host, log).fetch });
    const transport = cfg.rpcFallback ? fallback([rpc(cfg.rpcUrl), rpc(cfg.rpcFallback)]) : rpc(cfg.rpcUrl);
    this.pub = createPublicClient({ chain, transport }) as PublicClient;
    this.relayer = privateKeyToAccount(cfg.relayerKey, { nonceManager });
    this.wallet = createWalletClient({ chain, transport, account: this.relayer });
    this.contracts = {
      RealmLedger: cfg.ledger,
      RealmBadges: cfg.badges,
      IdentityRegistry: cfg.identity,
      ReputationRegistry: cfg.reputation,
      ...(cfg.duels ? { RealmDuels: cfg.duels } : {}),
      Relayer: this.relayer.address,
    };
  }

  get relayerAddress() {
    return this.relayer.address;
  }

  ref(kind: string, hash: Hex, block?: number): TxRef {
    return { kind, hash, mode: 'live', url: explorerTx(this.explorerUrl, hash), block };
  }

  async blockNumber() {
    return Number(await this.pub.getBlockNumber());
  }

  async relayerBalance() {
    return formatEther(await this.pub.getBalance({ address: this.relayer.address }));
  }

  /** Ordered relayer queue: estimate ×1.15 gas, fee = gasPrice ×1.2, wait for the receipt, retry ×3. */
  private send(kind: string, req: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }) {
    const run = async () => {
      const doc: TxDoc = {
        id: uid('tx_'),
        kind,
        payload: JSON.parse(JSON.stringify({ fn: req.functionName, args: req.args }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
        status: 'pending',
        hash: null,
        attempts: 0,
        error: null,
        createdAt: Date.now(),
      };
      await this.repo.txs.put(doc);
      for (let attempt = 1; attempt <= 3; attempt++) {
        doc.attempts = attempt;
        try {
          const gas = ((await this.pub.estimateContractGas({ ...req, account: this.relayer } as never)) * 115n) / 100n;
          const gasPrice = await this.pub.getGasPrice();
          const maxFeePerGas = (gasPrice * 12n) / 10n;
          const hash = (await this.wallet.writeContract({
            ...req,
            account: this.relayer,
            chain: this.wallet.chain,
            gas,
            maxFeePerGas,
            maxPriorityFeePerGas: maxFeePerGas / 10n,
          } as never)) as Hex;
          doc.status = 'sent';
          doc.hash = hash;
          await this.repo.txs.put(doc);
          const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
          if (receipt.status !== 'success') throw new Error(`reverted on-chain (${kind})`);
          doc.status = 'confirmed';
          await this.repo.txs.put(doc);
          return { hash, receipt };
        } catch (e) {
          doc.error = String((e as Error).message).slice(0, 500);
          await this.repo.txs.put(doc);
          if (isRevert(e) || attempt === 3) {
            doc.status = 'failed';
            await this.repo.txs.put(doc);
            throw e;
          }
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
      throw new Error('unreachable');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  // ------------------------------------------------------------------ events ---

  onEvent(cb: (e: ChainEvent) => void) {
    this.listeners.add(cb);
    if (!this.polling) this.polling = setInterval(() => void this.poll(), 1000);
    return () => {
      this.listeners.delete(cb);
      if (!this.listeners.size && this.polling) {
        clearInterval(this.polling);
        this.polling = null;
      }
    };
  }

  /** Indexer (§16.5): getLogs every second over at most 100 blocks (the provider limit). */
  private async poll() {
    try {
      const latest = await this.pub.getBlockNumber();
      if (!this.lastBlock) this.lastBlock = latest - 1n;
      if (latest <= this.lastBlock) return;
      const from = this.lastBlock + 1n;
      const to = latest - from > 99n ? from + 99n : latest;
      const logs = await this.pub.getLogs({ address: [this.cfg.ledger], fromBlock: from, toBlock: to });
      const parsed = parseEventLogs({ abi: realmLedgerAbi as Abi, logs });
      for (const l of parsed) {
        const e: ChainEvent = { name: (l as { eventName: string }).eventName, args: (l as { args: Record<string, unknown> }).args, tx: l.transactionHash as Hex, block: Number(l.blockNumber) };
        for (const cb of this.listeners) cb(e);
      }
      this.lastBlock = to;
    } catch (e) {
      this.log('indexer poll failed', (e as Error).message);
    }
  }

  // ------------------------------------------------------------------- reads ---

  async sealOf(player: Hex) {
    const [baseHash, version, sealedAt] = (await this.pub.readContract({ address: this.cfg.ledger, abi: realmLedgerAbi, functionName: 'sealOf', args: [player] })) as [Hex, number, bigint];
    return baseHash === ZERO32 ? null : { baseHash, version: Number(version), sealedAt: Number(sealedAt) };
  }

  async policyOf(player: Hex, nightId: number) {
    const [policyHash, expiresAt] = (await this.pub.readContract({ address: this.cfg.ledger, abi: realmLedgerAbi, functionName: 'policyOf', args: [player, nightId] })) as [Hex, bigint];
    return policyHash === ZERO32 ? null : { policyHash, expiresAt: Number(expiresAt) };
  }

  async renownOf(player: Hex) {
    return Number(await this.pub.readContract({ address: this.cfg.ledger, abi: realmLedgerAbi, functionName: 'renownOf', args: [player] }));
  }

  async badgesOf(player: Hex) {
    const ids = [1n, 2n, 3n, 4n, 5n, 6n];
    const bal = (await this.pub.readContract({ address: this.cfg.badges, abi: realmBadgesAbi, functionName: 'balanceOfBatch', args: [ids.map(() => player), ids] })) as bigint[];
    return ids.filter((_, i) => bal[i]! > 0n).map(Number);
  }

  async reputationOf(agentId: string) {
    const [count, value, decimals] = (await this.pub.readContract({
      address: this.cfg.reputation,
      abi: reputationRegistryAbi,
      functionName: 'getSummary',
      args: [BigInt(agentId), [this.relayer.address], FEEDBACK_TAG1, ''],
    })) as [bigint, bigint, number];
    const n = Number(count);
    const v = Number(value) / 10 ** Number(decimals);
    // The draft spec's summaryValue is UNVERIFIED as sum vs mean; treat values above 100 as sums.
    return { count: n, average: n ? Math.round(v > 100 ? v / n : v) : 0 };
  }

  /** Verify a sponsored tx the player's own wallet sent, by the event it emitted (7702-safe). */
  async confirmPlayerTx(kind: 'seal' | 'register' | 'policy', hash: Hex, player: Hex) {
    try {
      const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 20_000 });
      if (receipt.status !== 'success') return { ok: false, reason: 'transaction reverted' };
      const block = Number(receipt.blockNumber);
      const same = (a: unknown) => String(a).toLowerCase() === player.toLowerCase();
      if (kind === 'register') {
        const logs = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.cfg.identity.toLowerCase()), eventName: 'Transfer' });
        const mint = logs.find((l) => same(l.args.to));
        return mint ? { ok: true, agentId: mint.args.tokenId.toString(), block } : { ok: false, reason: 'no agent minted to the player' };
      }
      const logs = parseEventLogs({ abi: realmLedgerAbi, logs: receipt.logs.filter((l) => l.address.toLowerCase() === this.cfg.ledger.toLowerCase()) });
      const name = kind === 'seal' ? 'BaseSealed' : 'PolicyCommitted';
      const ev = logs.find((l) => l.eventName === name && same((l.args as { player: string }).player));
      return ev ? { ok: true, block } : { ok: false, reason: `no ${name} for this player` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message.slice(0, 200) };
    }
  }

  // ------------------------------------------------------------------ writes ---

  private async signature(signer: PlayerSigner, primaryType: 'SealBase' | 'CommitPolicy', message: Record<string, unknown>) {
    const deadline = BigInt(signer.deadline ?? Math.floor(Date.now() / 1000) + 600);
    if (signer.signature) return { sig: signer.signature, deadline };
    if (!signer.privateKey) throw new Error('no signature for a relayed player transaction');
    const nonce = (await this.pub.readContract({ address: this.cfg.ledger, abi: realmLedgerAbi, functionName: 'nonces', args: [signer.address] })) as bigint;
    const account = privateKeyToAccount(signer.privateKey);
    const sig = await account.signTypedData({
      domain: ledgerDomain(this.chainId, this.cfg.ledger),
      types: EIP712_TYPES,
      primaryType,
      message: { ...message, nonce, deadline } as never,
    });
    return { sig, deadline };
  }

  async sealBaseFor(signer: PlayerSigner, baseHash: Hex, version: number) {
    const { sig, deadline } = await this.signature(signer, 'SealBase', { player: signer.address, baseHash, version });
    const { hash, receipt } = await this.send('seal', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'sealBaseFor', args: [signer.address, baseHash, version, deadline, sig] });
    return this.ref('seal', hash, Number(receipt.blockNumber));
  }

  async registerAgentFor(player: Hex, uri: string) {
    const { hash, receipt } = await this.send('register', { address: this.cfg.identity, abi: identityRegistryAbi as Abi, functionName: 'register', args: [uri] });
    const minted = parseEventLogs({ abi: identityRegistryAbi, logs: receipt.logs, eventName: 'Transfer' }).find(
      (l) => l.args.to.toLowerCase() === this.relayer.address.toLowerCase(),
    );
    if (!minted) throw new Error('registry did not mint an agent');
    const agentId = minted.args.tokenId;
    await this.send('transferAgent', { address: this.cfg.identity, abi: identityRegistryAbi as Abi, functionName: 'transferFrom', args: [this.relayer.address, player, agentId] });
    return { tx: this.ref('register', hash, Number(receipt.blockNumber)), agentId: agentId.toString() };
  }

  async commitPolicyFor(signer: PlayerSigner, nightId: number, policyHash: Hex, expiresAt: number) {
    const { sig, deadline } = await this.signature(signer, 'CommitPolicy', { player: signer.address, nightId, policyHash, expiresAt: BigInt(expiresAt) });
    const { hash, receipt } = await this.send('policy', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'commitPolicyFor', args: [signer.address, nightId, policyHash, BigInt(expiresAt), deadline, sig] });
    return this.ref('policy', hash, Number(receipt.blockNumber));
  }

  async commitBattle(a: CommitBattleArgs) {
    const { hash, receipt } = await this.send('commitBattle', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'commitBattle', args: [a.battleId, a.attacker, a.defender, a.defenderBaseHash, a.secretHash, a.attackerNonce] });
    return this.ref('commitBattle', hash, Number(receipt.blockNumber));
  }

  async revealSeed(battleId: Hex, secret: Hex) {
    // The contract refuses a reveal in the commit's own block (SameBlock, 0x6dde4588). Monad's
    // blocks are fast and the RPC may still estimate against the commit block, so wait for the
    // next block and retry that one specific revert a few times.
    let sent: Awaited<ReturnType<typeof this.send>> | null = null;
    for (let attempt = 1; !sent; attempt++) {
      try {
        sent = await this.send('revealSeed', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'revealSeed', args: [battleId, secret] });
      } catch (e) {
        if (attempt >= 6 || !/SameBlock|0x6dde4588/.test(String((e as Error).message))) throw e;
        await new Promise((r) => setTimeout(r, 450 * attempt));
      }
    }
    const { hash, receipt } = sent;
    const ev = parseEventLogs({ abi: realmLedgerAbi, logs: receipt.logs, eventName: 'SeedLocked' })[0];
    if (!ev) throw new Error('no SeedLocked event');
    return { tx: this.ref('revealSeed', hash, Number(receipt.blockNumber)), seed: ev.args.seed as Hex };
  }

  async recordResult(battleId: Hex, replayHash: Hex, stars: number, bp: number, renown: number) {
    const { hash, receipt } = await this.send('recordResult', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'recordResult', args: [battleId, replayHash, stars, bp, renown] });
    return this.ref('recordResult', hash, Number(receipt.blockNumber));
  }

  async recordDefence(battleId: Hex, replayHash: Hex, stars: number, bp: number, renown: number) {
    const { hash, receipt } = await this.send('recordDefence', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'recordDefence', args: [battleId, replayHash, stars, bp, renown] });
    return this.ref('recordDefence', hash, Number(receipt.blockNumber));
  }

  async giveFeedback(agentId: string, value: number, uri: string, feedbackHash: Hex) {
    const { hash, receipt } = await this.send('feedback', {
      address: this.cfg.reputation,
      abi: reputationRegistryAbi as Abi,
      functionName: 'giveFeedback',
      args: [BigInt(agentId), BigInt(value), 0, FEEDBACK_TAG1, FEEDBACK_TAG2, '', uri, feedbackHash],
    });
    return this.ref('feedback', hash, Number(receipt.blockNumber));
  }

  async awardBadge(player: Hex, badgeId: number) {
    const { hash, receipt } = await this.send('badge', { address: this.cfg.badges, abi: realmBadgesAbi as Abi, functionName: 'award', args: [player, BigInt(badgeId)] });
    return this.ref('badge', hash, Number(receipt.blockNumber));
  }

  async recordDuel(a: RecordDuelArgs) {
    if (!this.cfg.duels) throw new Error('RealmDuels is not deployed on this chain yet');
    const { hash, receipt } = await this.send('duel', {
      address: this.cfg.duels,
      abi: realmDuelsAbi as Abi,
      functionName: 'recordDuel',
      args: [a.duelId, a.playerA, a.playerB, a.starsA, a.starsB, a.pctA, a.pctB, a.replayHashA, a.replayHashB],
    });
    return this.ref('duel', hash, Number(receipt.blockNumber));
  }

  async logAutopilot(player: Hex, nightId: number, policyHash: Hex, kind: number, actionHash: Hex) {
    const { hash, receipt } = await this.send('autopilot', { address: this.cfg.ledger, abi: realmLedgerAbi as Abi, functionName: 'logAutopilot', args: [player, nightId, policyHash, kind, actionHash] });
    return this.ref('autopilot', hash, Number(receipt.blockNumber));
  }

}
