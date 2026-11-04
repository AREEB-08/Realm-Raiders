// Reused from web-coc (src/ui/screen-awake.ts) under the owner's code licence — see LICENSES/README.md.
/** The parts of the page the screen lock needs; tests supply their own. */
export interface WakeLockHost {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
}

/**
 * Keeps a phone's screen on while a raid or replay plays. Without it, a replay watched
 * hands-off, or a raid waiting on its last troops, dims and locks the screen after the
 * device's idle timeout; a locked phone hides the page, which settles the raid early.
 *
 * Browsers drop the lock whenever the page is hidden, so it is requested again when the
 * page returns. A browser without the Screen Wake Lock API, or one that refuses the request
 * (battery saver, a permissions policy), keeps its usual timeout.
 */
export class ScreenAwake {
  private wanted = false;
  private sentinel: WakeLockSentinel | null = null;
  private requesting = false;
  constructor(
    private readonly lock: WakeLock | undefined = typeof navigator === 'undefined'
      ? undefined
      : navigator.wakeLock,
    private readonly host: WakeLockHost | undefined = typeof document === 'undefined'
      ? undefined
      : document,
  ) {
    host?.addEventListener('visibilitychange', () => void this.sync());
  }
  /** Whether the screen should stay on; repeated calls with the same value do nothing. */
  hold(on: boolean) {
    if (on === this.wanted) return;
    this.wanted = on;
    void this.sync();
  }
  /** True while the browser is holding the screen on for the game. */
  get held() {
    return !!this.sentinel && !this.sentinel.released;
  }
  private get shouldHold() {
    return this.wanted && !this.host?.hidden;
  }
  private async sync(): Promise<void> {
    if (!this.lock) return;
    if (!this.shouldHold) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      if (sentinel && !sentinel.released) await sentinel.release().catch(() => {});
      return;
    }
    if (this.held || this.requesting) return;
    this.requesting = true;
    let sentinel: WakeLockSentinel | null = null;
    try {
      sentinel = await this.lock.request('screen');
    } catch {
      // Refused: the page keeps the device's own timeout.
    } finally {
      this.requesting = false;
    }
    if (!sentinel) return;
    this.sentinel = sentinel;
    // The battle may have ended, or the page been hidden, while the request was in flight.
    if (!this.shouldHold) await this.sync();
  }
}
