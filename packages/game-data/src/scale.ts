/**
 * Integer level scaling. Every value is derived with integer multiply + floor so the
 * client, the server and the verifier get identical numbers on every runtime (no Math.pow).
 */
export function scaleTable(base: number, pctPerLevel: number, maxLevel: number): number[] {
  const out: number[] = [];
  let v = base;
  for (let level = 1; level <= maxLevel; level++) {
    out.push(v);
    v = Math.floor((v * (100 + pctPerLevel)) / 100);
  }
  return out;
}

/** Value at a 1-based level from a table, clamped to the table range. */
export function atLevel(table: readonly number[], level: number): number {
  const i = Math.max(1, Math.min(table.length, Math.floor(level))) - 1;
  return table[i]!;
}

/** `base × 1.6^(level−1)` rounded to the nearest 10, computed exactly with integers. */
export function upgradeCost(base: number, level: number): number {
  let num = base;
  let den = 1;
  for (let i = 1; i < level; i++) {
    num *= 16;
    den *= 10;
  }
  return Math.round(num / (den * 10)) * 10;
}

/** `10 s × 2^(level−1)` in seconds. */
export function upgradeSeconds(level: number): number {
  return 10 * 2 ** Math.max(0, Math.floor(level) - 1);
}
