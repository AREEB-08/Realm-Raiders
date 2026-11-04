#!/usr/bin/env node
/**
 * Deploy RealmDuels (spec F9, Live Duel results) next to the existing contracts, without touching
 * RealmLedger / ClanSiege / RealmBadges. Same key and relayer as scripts/deploy.mjs (read from
 * apps/server/.env or contracts/.env — never printed). Adds RealmDuels to deployments/<chainId>.json
 * and refreshes packages/shared/src/deployments.json; then run `node scripts/verify.mjs`.
 *   node scripts/compile.mjs && node scripts/deploy-duels.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

const pub = createPublicClient({ transport: http(rpc) });
const chainId = await pub.getChainId();
const depFile = join(root, 'deployments', `${chainId}.json`);
const dep = existsSync(depFile) ? JSON.parse(readFileSync(depFile, 'utf8')) : { chainId };
if (dep.RealmDuels) {
  console.log(`RealmDuels already deployed at ${dep.RealmDuels} on chain ${chainId}`);
  process.exit(0);
}
const relayer = process.env.RELAYER_ADDRESS || contractsEnv.RELAYER_ADDRESS || dep.relayer || account.address;
const chain = defineChain({ id: chainId, name: `chain-${chainId}`, nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const before = await pub.getBalance({ address: account.address });
console.log(`deployer ${account.address} on chain ${chainId}: ${formatEther(before)} MON · relayer ${relayer}`);
if (before === 0n) {
  console.error('The deployer has no MON. Fund it at https://faucet.monad.xyz and run again.');
  process.exit(1);
}

const art = JSON.parse(readFileSync(join(root, 'artifacts', 'RealmDuels.json'), 'utf8'));
const data = encodeDeployData({ abi: art.abi, bytecode: art.bytecode, args: [account.address, relayer] });
// Monad charges the gas LIMIT: estimate, then +15 %.
const gas = ((await pub.estimateGas({ account: account.address, data })) * 115n) / 100n;
const gasPrice = await pub.getGasPrice();
const hash = await wallet.sendTransaction({ data, gas, maxFeePerGas: (gasPrice * 12n) / 10n, maxPriorityFeePerGas: gasPrice / 10n });
const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`RealmDuels deploy reverted (${hash})`);
const after = await pub.getBalance({ address: account.address });
console.log(`RealmDuels  ${receipt.contractAddress}  tx ${hash}  (cost ${formatEther(before - after)} MON)`);

writeFileSync(depFile, JSON.stringify({ ...dep, RealmDuels: receipt.contractAddress, duelsDeployedAt: new Date().toISOString() }, null, 2) + '\n');
execFileSync(process.execPath, ['--import', 'tsx', join(root, '..', 'packages', 'shared', 'scripts', 'gen-addresses.ts')], { stdio: 'inherit', cwd: join(root, '..', 'packages', 'shared') });
console.log(`wrote deployments/${chainId}.json and packages/shared/src/deployments.json`);
