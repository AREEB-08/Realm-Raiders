import { concatBytes, fromHex, keccak, utf8 } from '@realm/battle-engine';
import type { Hex, TxRef } from '@realm/shared';
import type { Chain, ChainEvent, CommitBattleArgs, PlayerSigner, RecordDuelArgs } from './types';

interface MockBattle {
  attacker: Hex;
  defender: Hex;
  defenderBaseHash: Hex;
  secretHash: Hex;
  attackerNonce: Hex;
  commitBlock: number;
  seed: Hex | null;
  replayHash: Hex | null;
  stars: number;
  destructionBp: number;
  renown: number;
  status: number;
}

export interface MockChainState {
  salt: string;
  block: number;
  txCount: number;
  seals: Record<string, { baseHash: Hex; version: number; sealedAt: number }>;
  battles: Record<string, MockBattle>;
  policies: Record<string, Record<string, { policyHash: Hex; expiresAt: number }>>;
  renown: Record<string, number>;
  badges: Record<string, number[]>;
  agents: { next: number; owners: Record<string, Hex>; uris: Record<string, string> };
  feedback: Record<string, number[]>;
  txs: Record<string, { kind: string; block: number; from: Hex; data: Record<string, unknown> }>;
  /** RealmDuels (absent on saves from before Live Duels). */
  duels?: Record<string, { playerA: Hex; playerB: Hex; winner: Hex; starsA: number; starsB: number; pctA: number; pctB: number }>;
}

export const MOCK_RELAYER = '0x00000000000000000000000000000000000ca5e1' as Hex;

function revert(reason: string): never {
  throw new Error(`revert: ${reason}`);
}

/**
 * In-memory stand-in for Monad + our contracts, with the same rules as RealmLedger,
 * RealmBadges, RealmDuels and the ERC-8004 registries (§15). Every transaction is its own
 * block, so commit → reveal always spans two blocks, like on-chain. Universal demo fallback.
 */
export class MockChain implements Chain {
  readonly mode = 'mock' as const;
  readonly explorerUrl = null;
  readonly contracts = {
    RealmLedger: 'mock:RealmLedger',
    RealmBadges: 'mock:RealmBadges',
    RealmDuels: 'mock:RealmDuels',
    IdentityRegistry: 'mock:ERC8004-Identity',
    ReputationRegistry: 'mock:ERC8004-Reputation',
  };
  private state: MockChainState;
  private listeners = new Set<(e: ChainEvent) => void>();

  constructor(
    readonly chainId = 10143,
    private readonly opts: {
      state?: MockChainState;
      save?: (state: MockChainState) => void;
      latencyMs?: number;
      now?: () => number;
    } = {},
  ) {
    this.state = opts.state ?? MockChain.fresh();
  }

  static fresh(): MockChainState {
    const salt = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return {
      salt,
      block: 1,
      txCount: 0,
      seals: {},
      battles: {},
      policies: {},
      renown: {},
      badges: {},
      agents: { next: 1, owners: {}, uris: {} },
      feedback: {},
      txs: {},
    };
  }

  snapshot(): MockChainState {
    return structuredClone(this.state);
  }

  ref(kind: string, hash: Hex, block?: number): TxRef {
    return { kind, hash, mode: 'mock', url: null, block };
  }

  onEvent(cb: (e: ChainEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private now() {
    return Math.floor((this.opts.now?.() ?? Date.now()) / 1000);
  }

  private blockhash(n: number): Hex {
    return keccak(utf8(`mock-block:${this.state.salt}:${n}`));
  }

  /** Runs one state change as a transaction in a fresh block, after a block-time delay. */
  private async tx<T>(
    kind: string,
    from: Hex,
    fn: (block: number, emit: (name: string, args: Record<string, unknown>) => void) => T,
  ): Promise<{ ref: TxRef; out: T }> {
    if (this.opts.latencyMs) await new Promise((r) => setTimeout(r, this.opts.latencyMs));
    const block = this.state.block + 1;
    const events: { name: string; args: Record<string, unknown> }[] = [];
    const out = fn(block, (name, args) => events.push({ name, args }));
    this.state.block = block;
    const hash = keccak(utf8(`mock-tx:${this.state.salt}:${++this.state.txCount}:${kind}`));
    this.state.txs[hash] = { kind, block, from: from.toLowerCase() as Hex, data: Object.assign({}, ...events.map((e) => e.args)) };
    this.opts.save?.(this.snapshot());
    for (const e of events) for (const l of this.listeners) l({ ...e, tx: hash, block });
    return { ref: this.ref(kind, hash, block), out };
  }

  async blockNumber() {
    return this.state.block;
  }

  async sealOf(player: Hex) {
    return this.state.seals[player.toLowerCase()] ?? null;
  }

  async policyOf(player: Hex, nightId: number) {
    return this.state.policies[player.toLowerCase()]?.[String(nightId)] ?? null;
  }

  async renownOf(player: Hex) {
    return this.state.renown[player.toLowerCase()] ?? 0;
  }

  async badgesOf(player: Hex) {
    return [...(this.state.badges[player.toLowerCase()] ?? [])];
  }

  async reputationOf(agentId: string) {
    const values = this.state.feedback[agentId] ?? [];
    const average = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    return { count: values.length, average };
  }

  async confirmPlayerTx(kind: 'seal' | 'register' | 'policy', hash: Hex, player: Hex) {
    const t = this.state.txs[hash];
    if (!t) return { ok: false, reason: 'unknown transaction' };
    const want = { seal: 'seal', register: 'register', policy: 'policy' }[kind];
    if (t.kind !== want) return { ok: false, reason: `transaction is a ${t.kind}` };
    if (t.from !== player.toLowerCase()) return { ok: false, reason: 'sent by someone else' };
    return { ok: true, block: t.block, agentId: t.data.agentId as string | undefined };
  }

  async sealBaseFor(signer: PlayerSigner, baseHash: Hex, version: number) {
    const { ref } = await this.tx('seal', signer.address, (_b, emit) => {
      this.state.seals[signer.address.toLowerCase()] = { baseHash, version, sealedAt: this.now() };
      emit('BaseSealed', { player: signer.address, baseHash, version });
    });
    return ref;
  }

  async registerAgentFor(player: Hex, uri: string) {
    const { ref, out } = await this.tx('register', player, (_b, emit) => {
      const id = String(this.state.agents.next++);
      this.state.agents.owners[id] = player.toLowerCase() as Hex;
      this.state.agents.uris[id] = uri;
      emit('Transfer', { from: '0x0000000000000000000000000000000000000000', to: player, tokenId: id, agentId: id });
      return id;
    });
    return { tx: ref, agentId: out };
  }

  async commitPolicyFor(signer: PlayerSigner, nightId: number, policyHash: Hex, expiresAt: number) {
    const { ref } = await this.tx('policy', signer.address, (_b, emit) => {
      const key = signer.address.toLowerCase();
      const existing = this.state.policies[key]?.[String(nightId)];
      if (existing && existing.expiresAt > this.now()) revert('PolicyActive');
      (this.state.policies[key] ??= {})[String(nightId)] = { policyHash, expiresAt };
      emit('PolicyCommitted', { player: signer.address, nightId, policyHash, expiresAt });
    });
    return ref;
  }

  async commitBattle(a: CommitBattleArgs) {
    const { ref } = await this.tx('commitBattle', MOCK_RELAYER, (block, emit) => {
      const seal = this.state.seals[a.defender.toLowerCase()];
      if (!seal || seal.baseHash.toLowerCase() !== a.defenderBaseHash.toLowerCase()) revert('BaseNotSealed');
      if (this.state.battles[a.battleId]) revert('BattleExists');
      this.state.battles[a.battleId] = {
        attacker: a.attacker,
        defender: a.defender,
        defenderBaseHash: a.defenderBaseHash,
        secretHash: a.secretHash,
        attackerNonce: a.attackerNonce,
        commitBlock: block,
        seed: null,
        replayHash: null,
        stars: 0,
        destructionBp: 0,
        renown: 0,
        status: 1,
      };
      emit('BattleCommitted', { battleId: a.battleId, attacker: a.attacker, defender: a.defender, defenderBaseHash: a.defenderBaseHash });
    });
    return ref;
  }

  async revealSeed(battleId: Hex, secret: Hex) {
    const { ref, out } = await this.tx('revealSeed', MOCK_RELAYER, (block, emit) => {
      const b = this.state.battles[battleId];
      if (!b || b.status !== 1) revert('NotCommitted');
      if (block <= b.commitBlock) revert('SameBlock');
      if (keccak(fromHex(secret)).toLowerCase() !== b.secretHash.toLowerCase()) revert('BadSecret');
      // seed = keccak256(abi.encode(secret, attackerNonce, blockhash(commitBlock), prevrandao, battleId))
      const seed = keccak(
        concatBytes(
          fromHex(secret),
          fromHex(b.attackerNonce),
          fromHex(this.blockhash(b.commitBlock)),
          fromHex(keccak(utf8(`mock-randao:${this.state.salt}:${block}`))),
          fromHex(battleId),
        ),
      );
      b.seed = seed;
      b.status = 2;
      emit('SeedLocked', { battleId, seed });
      return seed;
    });
    return { tx: ref, seed: out };
  }

  private resolve(battleId: Hex, replayHash: Hex, stars: number, bp: number, renown: number, defence: boolean) {
    return this.tx(defence ? 'recordDefence' : 'recordResult', MOCK_RELAYER, (_b, emit) => {
      const b = this.state.battles[battleId];
      if (!b || b.status !== 2) revert('NotSeeded');
      if (stars > 3 || bp > 10000) revert('BadResult');
      Object.assign(b, { replayHash, stars, destructionBp: bp, renown, status: 3 });
      const who = (defence ? b.defender : b.attacker).toLowerCase();
      this.state.renown[who] = (this.state.renown[who] ?? 0) + renown;
      emit(defence ? 'DefenseRecorded' : 'BattleResolved', {
        battleId,
        attacker: b.attacker,
        defender: b.defender,
        replayHash,
        stars,
        destructionBp: bp,
        renown,
      });
    });
  }

  async recordResult(battleId: Hex, replayHash: Hex, stars: number, bp: number, renown: number) {
    return (await this.resolve(battleId, replayHash, stars, bp, renown, false)).ref;
  }

  async recordDefence(battleId: Hex, replayHash: Hex, stars: number, bp: number, renown: number) {
    return (await this.resolve(battleId, replayHash, stars, bp, renown, true)).ref;
  }

  async giveFeedback(agentId: string, value: number, _uri: string, feedbackHash: Hex) {
    const { ref } = await this.tx('feedback', MOCK_RELAYER, (_b, emit) => {
      if (!this.state.agents.owners[agentId]) revert('UnknownAgent');
      (this.state.feedback[agentId] ??= []).push(value);
      emit('NewFeedback', { agentId, value, feedbackHash });
    });
    return ref;
  }

  async awardBadge(player: Hex, badgeId: number) {
    const { ref } = await this.tx('badge', MOCK_RELAYER, (_b, emit) => {
      const list = (this.state.badges[player.toLowerCase()] ??= []);
      if (list.includes(badgeId)) revert('AlreadyAwarded');
      list.push(badgeId);
      emit('TransferSingle', { to: player, id: badgeId, value: 1 });
    });
    return ref;
  }

  async logAutopilot(player: Hex, nightId: number, policyHash: Hex, kind: number, actionHash: Hex) {
    const { ref } = await this.tx('autopilot', MOCK_RELAYER, (_b, emit) => {
      const p = this.state.policies[player.toLowerCase()]?.[String(nightId)];
      if (!p || p.policyHash.toLowerCase() !== policyHash.toLowerCase() || this.now() > p.expiresAt)
        revert('PolicyMismatch');
      emit('AutopilotAction', { player, nightId, policyHash, actionKind: kind, actionHash });
    });
    return ref;
  }

  async recordDuel(a: RecordDuelArgs) {
    const { ref } = await this.tx('duel', MOCK_RELAYER, (_b, emit) => {
      const duels = (this.state.duels ??= {});
      if (duels[a.duelId]) revert('DuelExists');
      if (a.playerA.toLowerCase() === a.playerB.toLowerCase()) revert('SamePlayer');
      if (a.starsA > 3 || a.starsB > 3 || a.pctA > 10000 || a.pctB > 10000) revert('BadResult');
      const winner = (a.starsA !== a.starsB ? (a.starsA > a.starsB ? a.playerA : a.playerB) : a.pctA !== a.pctB ? (a.pctA > a.pctB ? a.playerA : a.playerB) : `0x${'0'.repeat(40)}`) as Hex;
      duels[a.duelId] = { playerA: a.playerA, playerB: a.playerB, winner, starsA: a.starsA, starsB: a.starsB, pctA: a.pctA, pctB: a.pctB };
      emit('DuelRecorded', { duelId: a.duelId, playerA: a.playerA, playerB: a.playerB, winner, starsA: a.starsA, starsB: a.starsB });
    });
    return ref;
  }

}
