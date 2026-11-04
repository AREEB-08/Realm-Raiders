#!/usr/bin/env node
/**
 * Run the Android Gradle wrapper from the repo root on any OS (`pnpm apk`, `pnpm apk:release`).
 * Windows needs `gradlew.bat`; a bare `gradlew` is not found from npm/pnpm scripts there.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'client', 'android');
const win = process.platform === 'win32';
// Gradle's incremental packager rewrites the APK in place and leaves dead space behind (a 6.9 MB
// app grew to 10 MB). Packaging from an empty output folder keeps the file at its real size.
const wipe = (p) => {
  if (!existsSync(p)) return;
  for (const f of readdirSync(p)) {
    try {
      rmSync(join(p, f), { recursive: true, force: true });
    } catch {
      /* a folder held open by a terminal is fine; its files are gone */
    }
  }
};
// Only the variant being built (a debug build must not delete the signed release APK).
const variants = ['debug', 'release'].filter((v) => process.argv.slice(2).some((a) => a.toLowerCase().includes(v)));
for (const v of variants) wipe(join(dir, 'app', 'build', 'outputs', 'apk', v));
wipe(join(dir, 'app', 'build', 'intermediates', 'apk'));
// Absolute path: cmd.exe may be set not to search the current directory (NoDefaultCurrentDirectoryInExePath).
const exe = join(dir, win ? 'gradlew.bat' : 'gradlew');
const r = spawnSync(win ? `"${exe}"` : exe, process.argv.slice(2), { cwd: dir, stdio: 'inherit', shell: win });
process.exit(r.status ?? 1);
