import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = join(here, '..');

/** Minimal .env loader (no dependency): apps/server/.env, then process env wins. */
function loadDotenv() {
  const file = join(SERVER_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}
loadDotenv();

const bool = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');
const opt = z
  .string()
  .optional()
  .transform((v) => (v && v.length ? v : undefined));

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default('0.0.0.0'),
  SESSION_JWT_SECRET: z.string().default('dev-only-secret-change-me-32-bytes-minimum!!'),
  ALLOW_DEMO_AUTH: z.string().default('1').transform((v) => v === '1' || v === 'true'),
  DEMO: z.string().default('1').transform((v) => v === '1' || v === 'true'),
  PRIVY_APP_ID: opt,
  PRIVY_APP_SECRET: opt,
  CHAIN_MODE: z.enum(['live', 'mock']).default('mock'),
  CHAIN_ID: z.coerce.number().default(10143),
  RPC_URL: z.string().default('https://testnet-rpc.monad.xyz'),
  RPC_URL_FALLBACK: opt,
  EXPLORER_URL: z.string().default('https://testnet.monadvision.com'),
  RELAYER_PRIVATE_KEY: opt,
  REALM_LEDGER_ADDRESS: opt,
  REALM_BADGES_ADDRESS: opt,
  REALM_DUELS_ADDRESS: opt,
  /** Play with Friends: the 4-letter room code (set by `pnpm dev:lan`); unset = no LAN room. */
  LAN_ROOM: opt,
  LAN_NAME: opt,
  ERC8004_IDENTITY: z.string().default('0x8004A818BFB912233c491871b3d84c89A494BD9e'),
  ERC8004_REPUTATION: z.string().default('0x8004B663056A597Dffe9eCcC1965A193B7388713'),
  AGENTS_MODE: z.enum(['live', 'offline']).default('offline'),
  LLM_BASE_URL: opt,
  LLM_API_KEY: opt,
  LLM_MODEL: z.string().default('qwen3.8-flash'),
  LLM_FALLBACK_BASE_URL: opt,
  LLM_FALLBACK_API_KEY: opt,
  LLM_FALLBACK_MODEL: z.string().default('qwen/qwen3.8-flash'),
  LLM_LOCAL_BASE_URL: opt,
  LLM_LOCAL_MODEL: z.string().default('qwen3:8b'),
  LLM_TIMEOUT_MS: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:8787'),
  DB_FILE: z.string().default(join(SERVER_ROOT, 'data', 'realm.db')),
  SIM_WORKERS: z.coerce.number().default(4),
  QUIET: bool,
});

export type ServerEnv = z.infer<typeof Env>;

export function readEnv(overrides: Record<string, string | undefined> = {}): ServerEnv {
  return Env.parse({ ...process.env, ...overrides });
}
