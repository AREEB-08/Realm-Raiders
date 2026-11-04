#!/usr/bin/env node
/**
 * `pnpm apk:release` — the signed release APK (spec Phase 8).
 * RELEASE=1 turns WebView debugging off (capacitor.config.ts). Signing comes from
 * apps/client/android/keystore.properties (gitignored), which points at a keystore kept outside
 * git; nothing secret is printed. Ends by checking the signature with apksigner.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const env = { ...process.env, RELEASE: '1' };
const run = (cmd) => execSync(cmd, { cwd: root, env, stdio: 'inherit' });

if (!existsSync(join(root, 'apps/client/android/keystore.properties'))) {
  console.error('apps/client/android/keystore.properties is missing — the release APK would be unsigned.');
  process.exit(1);
}
run('pnpm --filter @realm/client build');
run('pnpm --filter @realm/client exec cap sync android');
run('node scripts/gradle.mjs assembleRelease');

const out = join(root, 'apps/client/android/app/build/outputs/apk/release');
const apk = readdirSync(out).find((f) => f.endsWith('.apk'));
if (!apk) throw new Error('no release APK was produced');
const path = join(out, apk);
console.log(`\n${apk}: ${(statSync(path).size / 1e6).toFixed(2)} MB`);

// apksigner from the newest build-tools.
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
const tools = join(sdk, 'build-tools');
const ver = existsSync(tools) ? readdirSync(tools).sort().pop() : null;
const signer = ver ? join(tools, ver, process.platform === 'win32' ? 'apksigner.bat' : 'apksigner') : null;
if (signer && existsSync(signer)) {
  const res = execSync(`"${signer}" verify --print-certs "${path}"`, { encoding: 'utf8' });
  const digest = /SHA-256 digest: ([0-9a-f]+)/.exec(res)?.[1];
  console.log(`signature verified ✓  certificate SHA-256 ${digest ?? '(see apksigner)'}`);
} else console.log('apksigner not found — skipped the signature check');
