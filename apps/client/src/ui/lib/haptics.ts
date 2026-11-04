// Reused from web-coc (src/ui/haptics.ts) under the owner's code licence — see LICENSES/README.md.
/** The player-facing moments that vibrate. */
export type Pulse = 'deploy' | 'destroy' | 'victory';

/** Milliseconds of vibration (a pattern alternates vibration and pause). */
const PATTERNS: Record<Pulse, number | number[]> = {
  deploy: 8,
  destroy: 25,
  victory: [30, 60, 30, 60, 60],
};
/** A held stream of troops or a chain of collapsing walls must not become one long buzz. */
const THROTTLE_MS: Record<Pulse, number> = { deploy: 90, destroy: 200, victory: 1000 };

/**
 * Short vibrations for the player's own actions on phones whose browser supports them
 * (Android; iOS Safari has no Vibration API, so nothing happens there). Presentation only.
 */
export class Haptics {
  enabled = true;
  private last: Partial<Record<Pulse, number>> = {};
  constructor(
    private readonly vibrate:
      ((pattern: number | number[]) => boolean) | null = typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function'
      ? (pattern) => navigator.vibrate(pattern)
      : null,
    /** Browsers ignore (and warn about) vibration before the page's first tap. */
    private readonly activated: () => boolean = () =>
      typeof navigator === 'undefined' || (navigator.userActivation?.hasBeenActive ?? true),
  ) {}
  get supported() {
    return !!this.vibrate;
  }
  pulse(kind: Pulse, now = performance.now()) {
    if (!this.enabled || !this.vibrate || !this.activated()) return false;
    if (now - (this.last[kind] ?? -Infinity) < THROTTLE_MS[kind]) return false;
    this.last[kind] = now;
    return this.vibrate(PATTERNS[kind]);
  }
}
