import { registerPlugin } from '@capacitor/core';

/** The app's own small native plugin (`RealmNativePlugin.java`): no extra libraries in the APK. */
export interface RealmNativePlugin {
  /** Write a base64 PNG to the app cache and open the Android share sheet with it. */
  shareImage(opts: { base64: string; fileName?: string; title?: string; text?: string }): Promise<{ shared: boolean }>;
  /** This phone's IPv4 address on the current Wi-Fi (empty when offline). */
  wifiIp(): Promise<{ ip?: string; prefix?: number }>;
}

export const RealmNative = registerPlugin<RealmNativePlugin>('RealmNative');
