import deployments from './deployments.json';

/** Monad network facts (§7). */
export const MONAD_TESTNET = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.monad.xyz'] },
    fallback: { http: ['https://rpc.ankr.com/monad_testnet', 'https://rpc-testnet.monadinfra.com'] },
  },
  blockExplorers: { default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' } },
  testnet: true,
} as const;

/** Canonical ERC-8004 registries (checked 2026-11-03). */
export const ERC8004 = {
  10143: {
    identity: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
    reputation: '0x8004B663056A597Dffe9eCcC1965A193B7388713',
  },
  143: {
    identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
    reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
  },
} as const;

export interface Deployment {
  chainId: number;
  RealmLedger: `0x${string}` | null;
  ClanSiege: `0x${string}` | null;
  RealmBadges: `0x${string}` | null;
  RealmAgentRegistry: `0x${string}` | null;
  /** Live Duel results (spec F9); absent until deployed. */
  RealmDuels?: `0x${string}` | null;
  relayer: `0x${string}` | null;
  deployedAt: string | null;
}

/** Written by `pnpm --filter @realm/shared gen:addresses` from contracts/deployments/10143.json. */
export const DEPLOYMENTS = deployments as Record<string, Deployment>;

export function deploymentFor(chainId: number): Deployment {
  return (
    DEPLOYMENTS[String(chainId)] ?? {
      chainId,
      RealmLedger: null,
      ClanSiege: null,
      RealmBadges: null,
      RealmAgentRegistry: null,
      relayer: null,
      deployedAt: null,
    }
  );
}

export const explorerTx = (base: string, hash: string) => `${base.replace(/\/$/, '')}/tx/${hash}`;
export const explorerAddress = (base: string, addr: string) => `${base.replace(/\/$/, '')}/address/${addr}`;

/** The gameplay tags we use for ERC-8004 feedback. */
export const FEEDBACK_TAG1 = 'realm-raiders';
export const FEEDBACK_TAG2 = 'battle';
