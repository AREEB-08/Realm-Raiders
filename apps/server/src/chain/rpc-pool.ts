import { Agent, fetch as undiciFetch } from 'undici';

interface Pool {
  close(): Promise<void>;
}
type DoFetch = (input: string | URL | Request, init: Omit<RequestInit, 'dispatcher'> & { dispatcher: Pool }) => Promise<Response>;

/**
 * One HTTP connection pool per RPC endpoint, replaced after a few failures in a row.
 *
 * Why: when the laptop changes Wi-Fi (or drops to a hotspot) while the server runs, its pooled
 * sockets can go dead and every RPC call fails from then on ("fetch failed" / timeouts), even
 * though a fresh process reaches the same RPC at once. A new pool is exactly that fresh start.
 */
export class RpcPool {
  private pool: Pool;
  private fails = 0;
  resets = 0;

  constructor(
    private readonly name: string,
    private readonly log: (m: string, x?: unknown) => void = () => {},
    private readonly opts: { failuresBeforeReset?: number; make?: () => Pool; doFetch?: DoFetch } = {},
  ) {
    this.pool = this.make();
  }

  private make(): Pool {
    return this.opts.make?.() ?? new Agent({ connect: { timeout: 8_000 }, keepAliveTimeout: 10_000 });
  }

  /** A `fetch` for viem's http transport (`fetchFn`). */
  readonly fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const doFetch = this.opts.doFetch ?? (undiciFetch as unknown as DoFetch);
    try {
      const res = await doFetch(input, { ...init, dispatcher: this.pool });
      this.fails = 0;
      return res;
    } catch (e) {
      if (++this.fails >= (this.opts.failuresBeforeReset ?? 3)) this.reset();
      throw e;
    }
  }) as typeof fetch;

  private reset() {
    const old = this.pool;
    this.pool = this.make();
    this.fails = 0;
    this.resets++;
    this.log('rpc connections reset', { rpc: this.name, resets: this.resets });
    void old.close().catch(() => {});
  }
}
