import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'xyz.realmraiders.app',
  appName: 'Realm Raiders',
  webDir: 'dist',
  // The https://localhost origin calls a friend's LAN host over http (Play with Friends, spec F9),
  // so mixed content stays allowed in the hackathon release too; WebView debugging is debug-only.
  android: { allowMixedContent: true, webContentsDebuggingEnabled: process.env.RELEASE !== '1' },
  server: { androidScheme: 'https' }, // origin https://localhost (add to Privy allowed origins)
  // App Links for the OAuth return are declared in AndroidManifest.xml (§17.2).
};
export default config;
