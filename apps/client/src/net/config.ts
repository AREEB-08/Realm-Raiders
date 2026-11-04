/** Public build-time config (every VITE_* value ships in the APK). */
export const config = {
  backend: (import.meta.env.VITE_BACKEND ?? 'auto') as 'auto' | 'remote' | 'local',
  /** One or more server URLs (comma-separated), tried in order: emulator host, LAN IP, … */
  apiUrls: ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  wsUrl: (import.meta.env.VITE_WS_URL as string | undefined) ?? '',
  privyAppId: (import.meta.env.VITE_PRIVY_APP_ID as string | undefined) || '',
  chainId: Number(import.meta.env.VITE_CHAIN_ID ?? 10143),
  rpcUrl: (import.meta.env.VITE_RPC_URL as string | undefined) ?? 'https://testnet-rpc.monad.xyz',
  explorerUrl: (import.meta.env.VITE_EXPLORER_URL as string | undefined) ?? 'https://testnet.monadvision.com',
  demo: (import.meta.env.VITE_DEMO ?? '1') === '1',
  landingHost: (import.meta.env.VITE_LANDING_HOST as string | undefined) ?? 'realm-raiders-001.vercel.app',
};

export const wsUrlFor = (api: string) => config.wsUrl || api.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
