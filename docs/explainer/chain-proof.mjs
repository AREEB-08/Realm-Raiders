/**
 * Reads the live-run transactions and the deployed contracts straight from the Monad testnet RPC
 * (and Sourcify) and writes docs/explainer/chain.json for the explainer PDF.
 *   node docs/explainer/chain-proof.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const viem = await import(pathToFileURL(join(root, 'apps/server/node_modules/viem/_esm/index.js')).href);
const { createPublicClient, http, defineChain } = viem;

const monad = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
});
const client = createPublicClient({ chain: monad, transport: http() });
const dep = JSON.parse(readFileSync(join(root, 'contracts/deployments/10143.json'), 'utf8'));

const TXS = [
  ['General registered as ERC-8004 agent', '0x5af31284bba9350fd9946de8f10fb4904ee76dadc8cbc6daa81c09d51869af6a'],
  ['BaseSealed (layout hash stored)', '0x82039c59d4ed26ebf42acedbdd3acdec062c25677e9a4f2667877e181c829a17'],
  ['BattleCommitted (secret seed committed)', '0x454e6cb770814b4c5890c58e97ac135735c68792bd5abe6b3a5b9ac04aa1bbe8'],
  ['SeedLocked (seed revealed + mixed)', '0x2f7d1000377f47cfbba8d9116543e938c4f1925bab06e6d9ae7629b4a348871d'],
  ['BattleResolved (result hash stored)', '0x155754285d8e742793efa421eaad3b57cbfec111b7a2db346ba19ca722a62c1b'],
  ['ERC-8004 reputation feedback', '0xda4aa974353de2ef142597176d577625ce1ac5a0ecfe782c35076ad795736b8b'],
  ['Badge minted: First Raid', '0x07ef20d40d926cb4865d76a25308363c94df695d550fa39695d56d6b425cee7f'],
  ['Badge minted: Three-Star', '0x7a9570a2e19b79a03412db210f59329bcd0610533379f26a16e143545c3c9d71'],
  ['PolicyCommitted (night orders sealed)', '0x25ff36bd42e4f3ed7f766b9b6b6fc99984e8d8ad0958bfbf7c11f031da3381e3'],
  ['DefenseRecorded vs Briarholt (0 stars)', '0xd47838a16a0572ae8ddd47e27d6fb7206abb95ff948e998c4c3327949f0afe59'],
  ['DefenseRecorded vs Kragmoor (0 stars)', '0x6eadecbd36cbd3b66de5a255d814d2c50d4ed81ff6c5814d9e8b7adbfde0cab3'],
  ['DefenseRecorded vs Saltspire (0 stars)', '0xa53a47622e6f3b30a4a4b9978acb4d01a001338f44bb80418c5d0bb1ca1a995d'],
  ['AutopilotAction: repaired walls', '0xb1cb4606f1f45ec8a42c3bfcbca517903942754b41cef1e453ced1ed529beaa7'],
  ['AutopilotAction: struck back at the raiders', '0xe0e666a0b34570de3c5cfa9bdbb51514a7128e7864619898db1f41f7eff7f10e'],
  ['AutopilotAction: repaired walls', '0x2844017d2093ad52e3220e04f778a5f8965bbee75a66135b381fcc79494d4997'],
  ['AutopilotAction: repaired walls', '0x2e9c887341575e2b7294c4065b6605288d3aaef242d0e1ff7ab6ae8519755941'],
  ['PolicyCommitted (Auto Orders locked)', '0x9055faea05ef05c23b3540a382f0f0e9deacb5ab8f7bf46211b30760adddd264'],
  ['Auto: collected Gold and Timber', '0xf22b044fcbac693c6c97efc4049aaffe873e093932f7733876f274a3e7512dc4'],
  ['Auto: built a new Goldworks', '0xff0675fd02f40b485bc4e3e778cb35f5d1254122ca51e816a610476922f6b819'],
  ["Auto: moved 2 buildings (Architect's fix)", '0xa5a4eb8928d411827091467c9a0bf06e15dc7f6bfb59b35dd3ac4ac18e111077'],
  ['Auto: base re-sealed', '0x7b68d0a5e9bf08f8a026719c212acc2890510cb3a72a49f8bf245864e0a7bee0'],
  ['Auto: raided Kragmoor Deep, 3 stars, verified', '0xb666ead3db907d4853ce38da9c5203b94cea51a183b3c95293ec565637d38a9d'],
];

const names = Object.fromEntries(['RealmLedger', 'RealmBadges', 'RealmDuels'].filter((k) => dep[k]).map((k) => [dep[k].toLowerCase(), k]));
names['0x8004a818bfb912233c491871b3d84c89a494bd9e'] = 'ERC-8004 Identity';
names['0x8004b663056a597dffe9eccc1965a193b7388713'] = 'ERC-8004 Reputation';

const out = { fetchedAt: new Date().toISOString(), chainId: await client.getChainId(), head: Number(await client.getBlockNumber()), contracts: [], txs: [] };

for (const k of ['RealmLedger', 'RealmBadges', 'RealmDuels'].filter((k) => dep[k])) {
  const address = dep[k];
  const code = await client.getCode({ address });
  let sourcify = 'unknown';
  try {
    // MonadVision's Sourcify instance (the one contracts/scripts/verify.mjs submits to).
    const r = await fetch(`https://sourcify-api-monad.blockvision.org/check-by-addresses?addresses=${address}&chainIds=10143`);
    sourcify = r.ok ? ((await r.json())[0]?.status ?? 'none') : `HTTP ${r.status}`;
  } catch (e) {
    sourcify = `error ${e.message}`;
  }
  out.contracts.push({ name: k, address, bytecodeBytes: code ? (code.length - 2) / 2 : 0, sourcify });
}

for (const [label, hash] of TXS) {
  try {
    const r = await client.getTransactionReceipt({ hash });
    out.txs.push({
      label,
      hash,
      status: r.status,
      block: Number(r.blockNumber),
      to: names[r.to?.toLowerCase()] ?? r.to,
      gasUsed: Number(r.gasUsed),
      logs: r.logs.length,
    });
  } catch (e) {
    out.txs.push({ label, hash, status: `error: ${e.shortMessage ?? e.message}` });
  }
}

writeFileSync(join(here, 'chain.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
