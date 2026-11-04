#!/usr/bin/env node
/** `pnpm screens`: landscape screenshots of every screen (16:9, 19.5:9, 20:9) into docs/screens/. */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const client = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'client');
const r = spawnSync('npx playwright test e2e/screens.spec.ts', { cwd: client, stdio: 'inherit', shell: true, env: { ...process.env, SCREENS: '1' } });
process.exit(r.status ?? 1);
