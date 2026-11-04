export interface ChainStatus {
  ok: boolean;
  block?: number;
  balance: string | null;
  /** When the chain last answered (ms), or 0. */
  at: number;
}

/**
 * /health must answer fast: phones give up on it after about 1.5 s and fall back to the offline
 * realm. So the chain part is cached, refreshed in the background, and waited on for at most
 * `waitMs`. A status older than `staleMs` is reported as not ok.
 */
export function chainStatus(
  read: () => Promise<{ block: number; balance: string | null }>,
  opts: { maxAgeMs?: number; waitMs?: number; staleMs?: number; now?: () => number } = {},
) {
  const now = opts.now ?? Date.now;
  const maxAge = opts.maxAgeMs ?? 5_000;
  const waitMs = opts.waitMs ?? 1_000;
  const staleMs = opts.staleMs ?? 30_000;
  let last: ChainStatus = { ok: false, balance: null, at: 0 };
  let checked = 0;
  let inflight: Promise<void> | null = null;
  const refresh = () =>
    (inflight ??= read()
      .then((r) => {
        last = { ok: true, block: r.block, balance: r.balance, at: now() };
      })
      .catch(() => {
        last = { ...last, ok: false };
      })
      .finally(() => {
        checked = now();
        inflight = null;
      }));
  return async (): Promise<ChainStatus> => {
    // A check already running (a slow or stuck RPC) is not waited on again: answer at once.
    if (!inflight && now() - checked > maxAge) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([refresh(), new Promise<void>((r) => (timer = setTimeout(r, waitMs)))]);
      clearTimeout(timer);
    }
    return { ...last, ok: last.ok && now() - last.at < staleMs };
  };
}
