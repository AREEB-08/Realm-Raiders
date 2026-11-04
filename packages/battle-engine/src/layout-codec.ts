import { BUILDING_IDS, BUILDINGS, GRID, type BuildingId, type Layout } from '@realm/game-data';
import { keccak, type Hex } from './hash';
import type { SealedBase } from './types';

/**
 * Canonical base bytes (§13.5), little-endian, no padding:
 *   u8 version=1 | u8 gridW | u8 gridH | u16 count | count × [u8 typeIdx, u8 level, u8 x, u8 y]
 * Entries are sorted by (y, x, typeIdx). This is what gets sealed in the Ledger.
 */
export function normalizeBase(input: Layout | SealedBase): SealedBase {
  const buildings = input.buildings.map((b) => ({
    type: b.type,
    level: b.level,
    x: b.x,
    y: b.y,
  }));
  buildings.sort(
    (a, b) =>
      a.y - b.y || a.x - b.x || BUILDING_IDS.indexOf(a.type) - BUILDING_IDS.indexOf(b.type),
  );
  const grid = 'gridW' in input ? { w: input.gridW, h: input.gridH } : { w: GRID, h: GRID };
  return { v: 1, gridW: grid.w, gridH: grid.h, buildings };
}

export function encodeBase(input: Layout | SealedBase): Uint8Array {
  const base = normalizeBase(input);
  const out = new Uint8Array(5 + base.buildings.length * 4);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = base.gridW;
  out[2] = base.gridH;
  view.setUint16(3, base.buildings.length, true);
  let o = 5;
  for (const b of base.buildings) {
    const idx = BUILDING_IDS.indexOf(b.type);
    if (idx < 0) throw new Error(`unknown building ${b.type}`);
    out[o++] = idx;
    out[o++] = b.level;
    out[o++] = b.x;
    out[o++] = b.y;
  }
  return out;
}

export function decodeBase(bytes: Uint8Array): SealedBase {
  if (bytes.length < 5 || bytes[0] !== 1) throw new Error('bad base bytes');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(3, true);
  if (bytes.length !== 5 + count * 4) throw new Error('bad base length');
  const buildings: SealedBase['buildings'] = [];
  let o = 5;
  for (let i = 0; i < count; i++) {
    const type = BUILDING_IDS[bytes[o++]!] as BuildingId | undefined;
    if (!type) throw new Error('unknown building index');
    const level = bytes[o++]!;
    const x = bytes[o++]!;
    const y = bytes[o++]!;
    buildings.push({ type, level, x, y });
  }
  return { v: 1, gridW: bytes[1]!, gridH: bytes[2]!, buildings };
}

export function baseHash(input: Layout | SealedBase): Hex {
  return keccak(encodeBase(input));
}

/** Base-64 share code for a layout (the reused layout-share idea, on our u8 ids). */
export function layoutToCode(input: Layout | SealedBase): string {
  const bytes = encodeBase(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function codeToBase(code: string): SealedBase {
  const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodeBase(bytes);
}

/** Basic structural checks every consumer can run before simulating. */
export function baseErrors(base: SealedBase): string[] {
  const errors: string[] = [];
  const occ = new Int16Array(base.gridW * base.gridH).fill(-1);
  let citadels = 0;
  base.buildings.forEach((b, i) => {
    const def = BUILDINGS[b.type];
    if (!def) {
      errors.push(`unknown building ${b.type}`);
      return;
    }
    if (b.type === 'citadel') citadels++;
    if (b.level < 1 || b.level > def.maxLevel) errors.push(`${b.type} level ${b.level} out of range`);
    if (b.x < 0 || b.y < 0 || b.x + def.size > base.gridW || b.y + def.size > base.gridH) {
      errors.push(`${b.type} at ${b.x},${b.y} is off the island`);
      return;
    }
    for (let y = b.y; y < b.y + def.size; y++)
      for (let x = b.x; x < b.x + def.size; x++) {
        const t = y * base.gridW + x;
        if (occ[t]! >= 0) errors.push(`${b.type} at ${b.x},${b.y} overlaps another building`);
        occ[t] = i;
      }
  });
  if (citadels !== 1) errors.push('a base needs exactly one Citadel');
  return errors;
}
