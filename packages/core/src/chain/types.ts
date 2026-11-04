import type { ChainMode, Hex, TxRef } from '@realm/shared';

/** Who authorises a player-owned record when the relayer submits it (§15.6 fallbacks). */
export interface PlayerSigner {
  address: Hex;
  /** Demo burner key held by the server (guest players only). */
  privateKey?: Hex | null;
  /** An EIP-712 signature the player's own wallet produced. */
  signature?: Hex;
  deadline?: number;
}

export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  tx: Hex;
  block: number;
}

export interface RecordDuelArgs {
  duelId: Hex;
  playerA: Hex;
  playerB: Hex;
  starsA: number;
  starsB: number;
  /** Destruction in basis points. */
  pctA: number;
  pctB: number;
  replayHashA: Hex;
  replayHashB: Hex;
}

export interface CommitBattleArgs {
  battleId: Hex;
  attacker: Hex;
  defender: Hex;
  defenderBaseHash: Hex;
  secretHash: Hex;
  attackerNonce: Hex;
}

/**
 * Everything the game needs from Monad. `MockChain` implements it in memory with the same
 * rules as the contracts; the server's `LiveChain` implements it with viem + the relayer.
 */
export interface Chain {
  readonly mode: ChainMode;
  readonly chainId: number;
  readonly explorerUrl: string | null;
  readonly contracts: Record<string, string>;
  ref(kind: string, hash: Hex, block?: number): TxRef;
  onEvent(cb: (e: ChainEvent) => void): () => void;
  blockNumber(): Promise<number>;

  sealOf(player: Hex): Promise<{ baseHash: Hex; version: number; sealedAt: number } | null>;
  policyOf(player: Hex, nightId: number): Promise<{ policyHash: Hex; expiresAt: number } | null>;
  renownOf(player: Hex): Promise<number>;
  badgesOf(player: Hex): Promise<number[]>;
  reputationOf(agentId: string): Promise<{ count: number; average: number }>;

  /** Check a transaction the player's own wallet sent (sponsored), and parse what it did. */
  confirmPlayerTx(
    kind: 'seal' | 'register' | 'policy',
    hash: Hex,
    player: Hex,
  ): Promise<{ ok: boolean; agentId?: string; block?: number; reason?: string }>;

  sealBaseFor(signer: PlayerSigner, baseHash: Hex, version: number): Promise<TxRef>;
  registerAgentFor(player: Hex, uri: string): Promise<{ tx: TxRef; agentId: string }>;
  commitPolicyFor(signer: PlayerSigner, nightId: number, policyHash: Hex, expiresAt: number): Promise<TxRef>;
  commitBattle(args: CommitBattleArgs): Promise<TxRef>;
  revealSeed(battleId: Hex, secret: Hex): Promise<{ tx: TxRef; seed: Hex }>;
  recordResult(battleId: Hex, replayHash: Hex, stars: number, destructionBp: number, renown: number): Promise<TxRef>;
  recordDefence(battleId: Hex, replayHash: Hex, stars: number, destructionBp: number, defenderRenown: number): Promise<TxRef>;
  giveFeedback(agentId: string, value: number, feedbackUri: string, feedbackHash: Hex): Promise<TxRef>;
  awardBadge(player: Hex, badgeId: number): Promise<TxRef>;
  logAutopilot(player: Hex, nightId: number, policyHash: Hex, kind: number, actionHash: Hex): Promise<TxRef>;
  /** RealmDuels.recordDuel (relayer, once per duel). */
  recordDuel(args: RecordDuelArgs): Promise<TxRef>;
}
