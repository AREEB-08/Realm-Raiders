import { describe, expect, it } from 'vitest';
import { RpcPool } from '../src/chain/rpc-pool';
import { chainStatus } from '../src/chain/status';

describe('RpcPool: a dead connection pool is replaced (Wi-Fi changed under the server)', () => {
  it('renews the pool after 3 failures in a row and closes the old one', async () => {
    const pools: { id: number; closed: boolean; close(): Promise<void> }[] = [];
    const make = () => {
      const p = { id: pools.length, closed: false, close: async () => void (p.closed = true) };
      pools.push(p);
      return p;
    };
    let down = true;
    const used: number[] = [];
    const doFetch = async (_: unknown, init: { dispatcher: unknown }) => {
      used.push((init.dispatcher as { id: number }).id);
      if (down) throw new TypeError('fetch failed');
      return new Response('{"jsonrpc":"2.0","id":1,"result":"0x1"}');
    };
    const logs: string[] = [];
    const rpc = new RpcPool('rpc.test', (m) => logs.push(m), { make, doFetch: doFetch as never });
    for (let i = 0; i < 3; i++) await expect(rpc.fetch('https://rpc.test')).rejects.toThrow('fetch failed');
    expect(rpc.resets).toBe(1);
    expect(pools[0]!.closed).toBe(true);
    expect(logs).toEqual(['rpc connections reset']);
    down = false;
    const res = await rpc.fetch('https://rpc.test');
    expect(res.ok).toBe(true);
    expect(used).toEqual([0, 0, 0, 1]);
  });

  it('a success clears the failure count, so scattered errors never reset the pool', async () => {
    let n = 0;
    const doFetch = async () => {
      if (n++ % 2 === 0) throw new TypeError('fetch failed');
      return new Response('ok');
    };
    const rpc = new RpcPool('rpc.test', () => {}, { make: () => ({ close: async () => {} }), doFetch: doFetch as never });
    for (let i = 0; i < 10; i++) await rpc.fetch('https://rpc.test').catch(() => {});
    expect(rpc.resets).toBe(0);
  });
});

describe('/health chain status: never waits long on a slow RPC', () => {
  it('answers within the wait budget while the RPC hangs, and reports not ok', async () => {
    const status = chainStatus(() => new Promise(() => {}), { waitMs: 50 });
    const t0 = Date.now();
    const s = await status();
    expect(Date.now() - t0).toBeLessThan(500);
    expect(s.ok).toBe(false);
    // A second probe while the first check still hangs answers at once.
    const t1 = Date.now();
    await status();
    expect(Date.now() - t1).toBeLessThan(30);
  });

  it('caches a good answer, refreshes after maxAge, and marks stale data not ok', async () => {
    let t = 1_000_000;
    let calls = 0;
    let fail = false;
    const status = chainStatus(
      async () => {
        calls++;
        if (fail) throw new Error('rpc down');
        return { block: 100 + calls, balance: '42.0' };
      },
      { now: () => t, maxAgeMs: 5_000, staleMs: 30_000 },
    );
    expect(await status()).toMatchObject({ ok: true, block: 101, balance: '42.0' });
    t += 1_000;
    expect(await status()).toMatchObject({ ok: true, block: 101 });
    expect(calls).toBe(1);
    t += 5_000;
    expect(await status()).toMatchObject({ ok: true, block: 102 });
    fail = true;
    t += 6_000;
    expect((await status()).ok).toBe(false);
    expect(calls).toBe(3);
  });
});
