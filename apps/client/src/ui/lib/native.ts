import { Capacitor } from '@capacitor/core';
import { Haptics as CapHaptics, ImpactStyle } from '@capacitor/haptics';
import { Haptics, type Pulse } from './haptics';
import { ScreenAwake } from './screen-awake';

/**
 * Native replacements for the reused web helpers (§17.5): on Android, haptics go through
 * @capacitor/haptics; in a browser, the reused Vibration-API helper is used as-is.
 */
const native = Capacitor.isNativePlatform();
const web = new Haptics();
const STYLE: Record<Pulse, ImpactStyle> = { deploy: ImpactStyle.Light, destroy: ImpactStyle.Medium, victory: ImpactStyle.Heavy };
const last: Partial<Record<Pulse, number>> = {};

export const haptics = {
  pulse(kind: Pulse) {
    if (!native) return web.pulse(kind);
    const now = performance.now();
    if (now - (last[kind] ?? 0) < (kind === 'deploy' ? 90 : 200)) return false;
    last[kind] = now;
    void CapHaptics.impact({ style: STYLE[kind] }).catch(() => {});
    return true;
  },
};

export const screenAwake = new ScreenAwake();
