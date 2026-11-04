/**
 * Integer helpers for the deterministic engine. No Math.sqrt / sin / cos / atan2 / pow here:
 * every result must be bit-identical on every JavaScript runtime.
 */

/** Integer division truncating toward zero (IEEE division of integers is exact-rounded everywhere). */
export const idiv = (a: number, b: number) => Math.trunc(a / b);

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** floor(sqrt(n)) for 0 <= n < 2^53, by Newton's method on integers. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  if (n < 4) return 1;
  // Start from a power of two above the root (bit length via clz32 below 2^31).
  let x: number;
  if (n < 0x80000000) x = 1 << Math.ceil((32 - Math.clz32(n)) / 2);
  else {
    x = 1;
    while (x * x <= n) x *= 2;
  }
  for (;;) {
    const y = Math.floor((x + Math.floor(n / x)) / 2);
    if (y >= x) break;
    x = y;
  }
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export const dist2 = (ax: number, ay: number, bx: number, by: number) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};

/** Squared distance from a point to an axis-aligned rectangle [x0,x1) × [y0,y1). */
export function dist2ToRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return dx * dx + dy * dy;
}

/**
 * 16 unit directions × 1024 (k × 22.5°), precomputed so the sim never calls sin/cos.
 * Index 0 points along +x, 4 along +y.
 */
export const DIR16: readonly (readonly [number, number])[] = [
  [1024, 0],
  [946, 392],
  [724, 724],
  [392, 946],
  [0, 1024],
  [-392, 946],
  [-724, 724],
  [-946, 392],
  [-1024, 0],
  [-946, -392],
  [-724, -724],
  [-392, -946],
  [0, -1024],
  [392, -946],
  [724, -724],
  [946, -392],
];

/** Nearest of the 16 directions to (dx, dy) by integer dot product; ties go to the lower index. */
export function dirIndex(dx: number, dy: number): number {
  let best = 0;
  let bestDot = -Infinity;
  for (let k = 0; k < 16; k++) {
    const d = DIR16[k]!;
    const dot = dx * d[0] + dy * d[1];
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  return best;
}

/**
 * Step from (x, y) towards (tx, ty) by at most `step` units, with integer normalisation.
 * Writes into `out` and returns whether the target was reached.
 */
export function stepToward(
  x: number,
  y: number,
  tx: number,
  ty: number,
  step: number,
  out: { x: number; y: number },
): boolean {
  const dx = tx - x;
  const dy = ty - y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= step * step) {
    out.x = tx;
    out.y = ty;
    return true;
  }
  const len = isqrt(d2);
  out.x = x + idiv(dx * step, len);
  out.y = y + idiv(dy * step, len);
  return false;
}
