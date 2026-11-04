import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { wallLine } from '../src/game/walls';
import { iso, uniso } from '../src/game/iso';
import { loadWorld, saveWorld, flushWorld } from '../src/persist/save';

describe('iso projection', () => {
  it('uniso inverts iso', () => {
    for (const [x, y] of [
      [0, 0],
      [3.5, 7.25],
      [29, 1],
    ]) {
      const p = iso(x!, y!);
      const t = uniso(p.x, p.y);
      expect(t.x).toBeCloseTo(x!, 6);
      expect(t.y).toBeCloseTo(y!, 6);
    }
  });
});

describe('wall line-drag', () => {
  it('follows the dominant axis, inclusive of both ends', () => {
    expect(wallLine({ x: 5, y: 5 }, { x: 8, y: 6 })).toEqual([
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 7, y: 5 },
      { x: 8, y: 5 },
    ]);
    expect(wallLine({ x: 5, y: 5 }, { x: 5, y: 3 })).toHaveLength(3);
  });
});

describe('save (IndexedDB + localStorage backup)', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  it('round-trips through IndexedDB and keeps a synchronous backup', async () => {
    saveWorld({ hello: 'isles' });
    expect(store.get('realm-raiders-backup')).toContain('isles');
    await flushWorld();
    const r = await loadWorld();
    expect(r.data).toEqual({ hello: 'isles' });
  });

  it('keeps a damaged backup aside instead of overwriting it', async () => {
    store.set('realm-raiders-backup', '{broken');
    await loadWorld();
    expect([...store.keys()].some((k) => k.startsWith('realm-raiders-damaged-'))).toBe(true);
  });
});
