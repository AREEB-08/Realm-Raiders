/**
 * sfc32 (Small Fast Counting, 32-bit): 4 words of state, seeded from the first 16 bytes of the
 * 32-byte battle seed (little-endian words), then advanced 12 times to warm up (§13.2).
 */
export class Sfc32 {
  a: number;
  b: number;
  c: number;
  d: number;

  constructor(seed: Uint8Array) {
    if (seed.length < 16) throw new Error('sfc32 seed needs at least 16 bytes');
    const w = (i: number) =>
      (seed[i]! | (seed[i + 1]! << 8) | (seed[i + 2]! << 16) | (seed[i + 3]! << 24)) >>> 0;
    this.a = w(0);
    this.b = w(4);
    this.c = w(8);
    this.d = w(12);
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Next uint32. */
  next(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform-ish integer in [0, n). */
  below(n: number): number {
    return this.next() % n;
  }

  /** ±10 % damage variance as a per-mille factor: 900..1100. */
  variance(): number {
    return 900 + (this.next() % 201);
  }

  snapshot(): [number, number, number, number] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}
