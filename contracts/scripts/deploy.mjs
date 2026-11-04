#!/usr/bin/env node
/**
 * Deploy RealmLedger, ClanSiege, RealmBadges and RealmDuels to Monad testnet with viem (same
 * contracts as script/Deploy.s.sol plus RealmDuels, no Foundry needed). Uses the solc-js artifacts
 * (run `pnpm build` first). Refuses any chain other than Monad testnet (10143) or a local anvil (31337).
 *   DEPLOYER_PRIVATE_KEY=0x… RELAYER_ADDRESS=0x… node scripts/deploy.mjs
 * Defaults: the key/address from apps/server/.env and contracts/.env. Writes deployments/<chainId>.json
 * and refreshes packages/shared/src/deployments.json. Monad charges the gas LIMIT, so gas is
 * estimated ×1.15 explicitly (§15.6).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, encodeDeployData, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envOf = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split(/\r?\n/)
          .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*([^#\s]*)/.exec(l))
          .filter(Boolean)
          .map((m) => [m[1], m[2]]),
      )
    : {};
const serverEnv = envOf(join(root, '..', 'apps', 'server', '.env'));
const contractsEnv = envOf(join(root, '.env'));
const key = process.env.DEPLOYER_PRIVATE_KEY || serverEnv.RELAYER_PRIVATE_KEY;
const rpc = process.env.RPC_URL || serverEnv.RPC_URL || 'https://testnet-rpc.monad.xyz';
if (!key) throw new Error('set DEPLOYER_PRIVATE_KEY (or RELAYER_PRIVATE_KEY in apps/server/.env)');
const account = privateKeyToAccount(key);
const relayer = process.env.RELAYER_ADDRESS || contractsEnv.RELAYER_ADDRESS || account.address;
const badgeUri = process.env.BADGE_URI || contractsEnv.BADGE_URI || 'https://realmraiders.pages.dev/badges/{id}.json';

// The public Monad RPC rate-limits bursts (HTTP 429): back off and retry (1, 2, 4 … 32 s) instead of failing mid-deploy.
const transport = () => http(rpc, { retryCount: 6, retryDelay: 1000 });
const pub = createPublicClient({ transport: transport() });
const chainId = await pub.getChainId();
// Testnet-only guard: never deploy to Monad mainnet (143) or any other chain by accident.
const ALLOWED_CHAINS = new Set([10143, 31337]);
if (!ALLOWED_CHAINS.has(chainId)) {
  console.error(`Refusing to deploy: RPC ${rpc} is chain ${chainId}; only Monad testnet (10143) or a local anvil (31337) are allowed.`);
  process.exit(1);
}
const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const wallet = createWalletClient({ account, chain, transport: transport() });
const balance = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address} on chain ${chainId}: ${formatEther(balance)} MON`);
if (balance === 0n) {
  console.error('The deployer has no MON. Fund it at https://faucet.monad.xyz and run again.');
  process.exit(1);
}

const artifact = (name) => JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8'));
async function deploy(name, args) {
  const a = artifact(name);
  const data = encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args });
  const gas = ((await pub.estimateGas({ account: account.address, data })) * 115n) / 100n;
  const gasPrice = await pub.getGasPrice();
  const hash = await wallet.sendTransaction({ data, gas, maxFeePerGas: (gasPrice * 12n) / 10n, maxPriorityFeePerGas: gasPrice / 10n });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`${name} deploy reverted (${hash})`);
  console.log(`${name.padEnd(12)} ${receipt.contractAddress}  tx ${hash}`);
  return receipt.contractAddress;
}

const ledger = await deploy('RealmLedger', [account.address, relayer]);
const siege = await deploy('ClanSiege', [account.address, relayer]);
const badges = await deploy('RealmBadges', [account.address, relayer, badgeUri]);
const duels = await deploy('RealmDuels', [account.address, relayer]);
mkdirSync(join(root, 'deployments'), { recursive: true });
const out = { chainId, RealmLedger: ledger, ClanSiege: siege, RealmBadges: badges, RealmDuels: duels, relayer, deployer: account.address, deployedAt: new Date().toISOString() };
writeFileSync(join(root, 'deployments', `${chainId}.json`), JSON.stringify(out, null, 2) + '\n');
execFileSync(process.execPath, ['--import', 'tsx', join(root, '..', 'packages', 'shared', 'scripts', 'gen-addresses.ts')], { stdio: 'inherit', cwd: join(root, '..', 'packages', 'shared') });
console.log(`\nwrote deployments/${chainId}.json and packages/shared/src/deployments.json`);
console.log(`set CHAIN_MODE=live in apps/server/.env (the addresses are read from deployments.json)`);
