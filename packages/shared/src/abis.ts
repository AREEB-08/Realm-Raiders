/** Minimal ABIs (viem-compatible, `as const`) for our contracts and the ERC-8004 registries. */

export const realmLedgerAbi = [
  { type: 'function', name: 'sealOf', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: 'baseHash', type: 'bytes32' }, { name: 'version', type: 'uint32' }, { name: 'sealedAt', type: 'uint64' }] },
  { type: 'function', name: 'policyOf', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }, { name: 'nightId', type: 'uint32' }], outputs: [{ name: 'policyHash', type: 'bytes32' }, { name: 'expiresAt', type: 'uint64' }] },
  { type: 'function', name: 'renownOf', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: '', type: 'int64' }] },
  { type: 'function', name: 'nonces', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  {
    type: 'function', name: 'battles', stateMutability: 'view', inputs: [{ name: 'battleId', type: 'bytes32' }],
    outputs: [
      { name: 'attacker', type: 'address' }, { name: 'defender', type: 'address' }, { name: 'defenderBaseHash', type: 'bytes32' },
      { name: 'secretHash', type: 'bytes32' }, { name: 'attackerNonce', type: 'bytes32' }, { name: 'commitBlock', type: 'uint64' },
      { name: 'seed', type: 'bytes32' }, { name: 'replayHash', type: 'bytes32' }, { name: 'stars', type: 'uint8' },
      { name: 'destructionBp', type: 'uint16' }, { name: 'renown', type: 'int32' }, { name: 'status', type: 'uint8' },
    ],
  },
  { type: 'function', name: 'sealBase', stateMutability: 'nonpayable', inputs: [{ name: 'baseHash', type: 'bytes32' }, { name: 'version', type: 'uint32' }], outputs: [] },
  { type: 'function', name: 'sealBaseFor', stateMutability: 'nonpayable', inputs: [{ name: 'player', type: 'address' }, { name: 'baseHash', type: 'bytes32' }, { name: 'version', type: 'uint32' }, { name: 'deadline', type: 'uint256' }, { name: 'sig', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'commitBattle', stateMutability: 'nonpayable', inputs: [{ name: 'battleId', type: 'bytes32' }, { name: 'attacker', type: 'address' }, { name: 'defender', type: 'address' }, { name: 'defenderBaseHash', type: 'bytes32' }, { name: 'secretHash', type: 'bytes32' }, { name: 'attackerNonce', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'revealSeed', stateMutability: 'nonpayable', inputs: [{ name: 'battleId', type: 'bytes32' }, { name: 'secret', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'recordResult', stateMutability: 'nonpayable', inputs: [{ name: 'battleId', type: 'bytes32' }, { name: 'replayHash', type: 'bytes32' }, { name: 'stars', type: 'uint8' }, { name: 'destructionBp', type: 'uint16' }, { name: 'renown', type: 'int32' }], outputs: [] },
  { type: 'function', name: 'recordDefence', stateMutability: 'nonpayable', inputs: [{ name: 'battleId', type: 'bytes32' }, { name: 'replayHash', type: 'bytes32' }, { name: 'stars', type: 'uint8' }, { name: 'destructionBp', type: 'uint16' }, { name: 'defenderRenown', type: 'int32' }], outputs: [] },
  { type: 'function', name: 'commitPolicy', stateMutability: 'nonpayable', inputs: [{ name: 'nightId', type: 'uint32' }, { name: 'policyHash', type: 'bytes32' }, { name: 'expiresAt', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'commitPolicyFor', stateMutability: 'nonpayable', inputs: [{ name: 'player', type: 'address' }, { name: 'nightId', type: 'uint32' }, { name: 'policyHash', type: 'bytes32' }, { name: 'expiresAt', type: 'uint64' }, { name: 'deadline', type: 'uint256' }, { name: 'sig', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'logAutopilot', stateMutability: 'nonpayable', inputs: [{ name: 'player', type: 'address' }, { name: 'nightId', type: 'uint32' }, { name: 'policyHash', type: 'bytes32' }, { name: 'actionKind', type: 'uint8' }, { name: 'actionHash', type: 'bytes32' }], outputs: [] },
  { type: 'event', name: 'BaseSealed', inputs: [{ name: 'player', type: 'address', indexed: true }, { name: 'baseHash', type: 'bytes32', indexed: false }, { name: 'version', type: 'uint32', indexed: false }] },
  { type: 'event', name: 'BattleCommitted', inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }, { name: 'attacker', type: 'address', indexed: true }, { name: 'defender', type: 'address', indexed: true }, { name: 'defenderBaseHash', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'SeedLocked', inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }, { name: 'seed', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'BattleResolved', inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }, { name: 'attacker', type: 'address', indexed: true }, { name: 'defender', type: 'address', indexed: true }, { name: 'replayHash', type: 'bytes32', indexed: false }, { name: 'stars', type: 'uint8', indexed: false }, { name: 'destructionBp', type: 'uint16', indexed: false }, { name: 'renown', type: 'int32', indexed: false }] },
  { type: 'event', name: 'DefenseRecorded', inputs: [{ name: 'battleId', type: 'bytes32', indexed: true }, { name: 'attacker', type: 'address', indexed: true }, { name: 'defender', type: 'address', indexed: true }, { name: 'replayHash', type: 'bytes32', indexed: false }, { name: 'stars', type: 'uint8', indexed: false }, { name: 'destructionBp', type: 'uint16', indexed: false }, { name: 'defenderRenown', type: 'int32', indexed: false }] },
  { type: 'event', name: 'PolicyCommitted', inputs: [{ name: 'player', type: 'address', indexed: true }, { name: 'nightId', type: 'uint32', indexed: true }, { name: 'policyHash', type: 'bytes32', indexed: false }, { name: 'expiresAt', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'AutopilotAction', inputs: [{ name: 'player', type: 'address', indexed: true }, { name: 'nightId', type: 'uint32', indexed: true }, { name: 'policyHash', type: 'bytes32', indexed: false }, { name: 'actionKind', type: 'uint8', indexed: false }, { name: 'actionHash', type: 'bytes32', indexed: false }] },
  { type: 'error', name: 'PolicyMismatch', inputs: [] },
] as const;

export const clanSiegeAbi = [
  { type: 'function', name: 'sieges', stateMutability: 'view', inputs: [{ name: 'siegeId', type: 'uint256' }], outputs: [{ name: 'bossHp', type: 'uint64' }, { name: 'hpLeft', type: 'uint64' }, { name: 'endsAt', type: 'uint64' }, { name: 'totalHits', type: 'uint32' }, { name: 'defeated', type: 'bool' }] },
  { type: 'function', name: 'hitsOf', stateMutability: 'view', inputs: [{ name: 'siegeId', type: 'uint256' }, { name: 'player', type: 'address' }], outputs: [{ name: '', type: 'uint32' }] },
  { type: 'function', name: 'startSiege', stateMutability: 'nonpayable', inputs: [{ name: 'siegeId', type: 'uint256' }, { name: 'bossHp', type: 'uint64' }, { name: 'endsAt', type: 'uint64' }], outputs: [] },
  { type: 'function', name: 'hit', stateMutability: 'nonpayable', inputs: [{ name: 'siegeId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'hitBatch', stateMutability: 'nonpayable', inputs: [{ name: 'siegeId', type: 'uint256' }, { name: 'players', type: 'address[]' }, { name: 'taps', type: 'uint32[]' }, { name: 'dmg', type: 'uint32[]' }, { name: 'tapLogRoot', type: 'bytes32' }], outputs: [] },
  { type: 'event', name: 'Hit', inputs: [{ name: 'siegeId', type: 'uint256', indexed: true }, { name: 'player', type: 'address', indexed: true }, { name: 'dmg', type: 'uint32', indexed: false }, { name: 'hpLeft', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'HitBatch', inputs: [{ name: 'siegeId', type: 'uint256', indexed: true }, { name: 'taps', type: 'uint32', indexed: false }, { name: 'dmg', type: 'uint64', indexed: false }, { name: 'tapLogRoot', type: 'bytes32', indexed: false }, { name: 'hpLeft', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'BossDefeated', inputs: [{ name: 'siegeId', type: 'uint256', indexed: true }, { name: 'finalBlow', type: 'address', indexed: false }] },
] as const;

export const realmBadgesAbi = [
  { type: 'function', name: 'award', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'badgeId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { type: 'function', name: 'balanceOfBatch', stateMutability: 'view', inputs: [{ name: 'accounts', type: 'address[]' }, { name: 'ids', type: 'uint256[]' }], outputs: [{ name: '', type: 'uint256[]' }] },
  { type: 'event', name: 'TransferSingle', inputs: [{ name: 'operator', type: 'address', indexed: true }, { name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'id', type: 'uint256', indexed: false }, { name: 'value', type: 'uint256', indexed: false }] },
] as const;

/** ERC-8004 IdentityRegistry subset (ERC-721 based). Also the shape of our fallback registry. */
/** RealmDuels (spec F9): Live Duel results, recorded once by the relayer. */
export const realmDuelsAbi = [
  {
    type: 'function', name: 'recordDuel', stateMutability: 'nonpayable',
    inputs: [
      { name: 'duelId', type: 'bytes32' }, { name: 'playerA', type: 'address' }, { name: 'playerB', type: 'address' },
      { name: 'starsA', type: 'uint8' }, { name: 'starsB', type: 'uint8' }, { name: 'pctA', type: 'uint16' }, { name: 'pctB', type: 'uint16' },
      { name: 'replayHashA', type: 'bytes32' }, { name: 'replayHashB', type: 'bytes32' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'winsOf', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ name: '', type: 'uint32' }] },
  {
    type: 'event', name: 'DuelRecorded',
    inputs: [
      { name: 'duelId', type: 'bytes32', indexed: true }, { name: 'playerA', type: 'address', indexed: true }, { name: 'playerB', type: 'address', indexed: true },
      { name: 'winner', type: 'address', indexed: false }, { name: 'starsA', type: 'uint8', indexed: false }, { name: 'starsB', type: 'uint8', indexed: false },
      { name: 'pctA', type: 'uint16', indexed: false }, { name: 'pctB', type: 'uint16', indexed: false },
      { name: 'replayHashA', type: 'bytes32', indexed: false }, { name: 'replayHashB', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export const identityRegistryAbi = [
  { type: 'function', name: 'register', stateMutability: 'nonpayable', inputs: [{ name: 'agentURI', type: 'string' }], outputs: [{ name: 'agentId', type: 'uint256' }] },
  { type: 'function', name: 'setAgentURI', stateMutability: 'nonpayable', inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'agentURI', type: 'string' }], outputs: [] },
  { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'transferFrom', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'tokenId', type: 'uint256', indexed: true }] },
] as const;

/** ERC-8004 ReputationRegistry subset (draft spec; return shape of getSummary is UNVERIFIED). */
export const reputationRegistryAbi = [
  {
    type: 'function', name: 'giveFeedback', stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' }, { name: 'value', type: 'int128' }, { name: 'valueDecimals', type: 'uint8' },
      { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }, { name: 'endpoint', type: 'string' },
      { name: 'feedbackURI', type: 'string' }, { name: 'feedbackHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'getSummary', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'clientAddresses', type: 'address[]' }, { name: 'tag1', type: 'string' }, { name: 'tag2', type: 'string' }],
    outputs: [{ name: 'count', type: 'uint64' }, { name: 'summaryValue', type: 'int128' }, { name: 'summaryValueDecimals', type: 'uint8' }],
  },
] as const;

/** EIP-712 typed data for the relayer fallbacks (§15.2). */
export const EIP712_TYPES = {
  SealBase: [
    { name: 'player', type: 'address' },
    { name: 'baseHash', type: 'bytes32' },
    { name: 'version', type: 'uint32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  CommitPolicy: [
    { name: 'player', type: 'address' },
    { name: 'nightId', type: 'uint32' },
    { name: 'policyHash', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

export const ledgerDomain = (chainId: number, verifyingContract: `0x${string}`) => ({
  name: 'RealmLedger',
  version: '1',
  chainId,
  verifyingContract,
});
