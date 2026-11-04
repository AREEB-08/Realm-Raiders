import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Determinism lint (§13.6): the engine source may not use host time, host randomness or
 * transcendental float math. (Kept as a test so it runs everywhere `pnpm test` runs.)
 */
const BANNED: [RegExp, string][] = [
  [/Math\.random/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\b/, 'performance'],
  [/Math\.sqrt/, 'Math.sqrt'],
  [/Math\.(sin|cos|tan|atan2?|asin|acos)\b/, 'Math trig'],
  [/Math\.(pow|exp|log|hypot|cbrt)\b/, 'Math pow/exp/log/hypot'],
  [/\*\*/, 'exponent operator'],
  [/for\s*\(\s*const\s+\[[^\]]+\]\s+of\s+[\w.]+\.(fields|entries)\b/, 'Map iteration'],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('banned APIs in packages/battle-engine/src', () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
  for (const file of files(src)) {
    it(file.slice(src.length + 1), () => {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const [re, label] of BANNED) expect(re.test(code), `${label} in ${file}`).toBe(false);
    });
  }
});
