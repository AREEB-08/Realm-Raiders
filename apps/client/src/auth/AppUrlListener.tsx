import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect } from 'react';

/**
 * Google returns to https://<LANDING_HOST>/redirect?privy_oauth_code=…; the verified App Link
 * opens the app, and this copies the privy_oauth_* params into the WebView URL so Privy can
 * finish the login (Privy's Capacitor OAuth recipe, §17.4). Mounted above PrivyProvider.
 */
export function AppUrlListener() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url);
        const params = new URLSearchParams();
        u.searchParams.forEach((v, k) => {
          if (k.startsWith('privy_')) params.set(k, v);
        });
        if ([...params.keys()].length) {
          const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
          window.history.replaceState({}, '', next);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      } catch {
        /* not a URL we handle */
      }
    });
    return () => void sub.then((s) => s.remove());
  }, []);
  return null;
}
