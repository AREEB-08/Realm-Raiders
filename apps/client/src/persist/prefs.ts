import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** Small durable key/values: Capacitor Preferences on Android (the OS can clear localStorage). */
export const prefs = {
  async get(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) return (await Preferences.get({ key })).value;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string) {
    if (Capacitor.isNativePlatform()) return Preferences.set({ key, value });
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  async remove(key: string) {
    if (Capacitor.isNativePlatform()) return Preferences.remove({ key });
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
