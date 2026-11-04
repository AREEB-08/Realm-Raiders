/**
 * Compile src/*.sol with solc-js 0.8.38 (same compiler + optimizer settings as foundry.toml),
 * resolving @openzeppelin from node_modules. Writes artifacts/<Name>.json {abi, bytecode}.
 * `forge build` is the primary path; this keeps CI and the JS chain tests working without Foundry.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ozRoot = dirname(require.resolve('@openzeppelin/contracts/package.json'));
const sources = {};
for (const f of readdirSync(join(root, 'src'))) if (f.endsWith('.sol')) sources[`src/${f}`] = { content: readFileSync(join(root, 'src', f), 'utf8') };
const input = {
  language: 'Solidity',
  sources,
  settings: {
    optimizer: { enabled: true, runs: 2000 },
    evmVersion: 'prague',
    outputSelection: { '*': { '*': ['abi', 'metadata', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
  },
};
const findImports = (path) => {
  try {
    if (path.startsWith('@openzeppelin/contracts/')) return { contents: readFileSync(join(ozRoot, path.slice('@openzeppelin/contracts/'.length)), 'utf8') };
    return { contents: readFileSync(join(root, path), 'utf8') };
  } catch (e) {
    return { error: `not found: ${path}` };
  }
};
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors ?? []).filter((e) => e.severity === 'error');
// Show errors, and warnings from our own sources only (OpenZeppelin's are not ours to fix).
for (const e of out.errors ?? []) if (e.severity === 'error' || e.sourceLocation?.file?.startsWith('src/')) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
if (process.argv.includes('--check')) {
  console.log(`compiled ${Object.keys(sources).length} sources with solc ${solc.version()} — 0 errors`);
  process.exit(0);
}
mkdirSync(join(root, 'artifacts'), { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts)) {
  if (!file.startsWith('src/')) continue;
  for (const [name, c] of Object.entries(contracts)) {
    const size = c.evm.deployedBytecode.object.length / 2;
    writeFileSync(join(root, 'artifacts', `${name}.json`), JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, metadata: c.metadata }, null, 1));
    console.log(`${name.padEnd(20)} ${size} bytes deployed (limit 128 KB on Monad)`);
  }
}
