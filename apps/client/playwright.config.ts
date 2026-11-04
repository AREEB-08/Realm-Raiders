import { defineConfig, devices } from '@playwright/test';

/** Web build e2e (Pixel 7 in landscape, 863×360 — spec F1). Uses the installed Chrome; the app runs fully in-app (mock chain). */
export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Pixel 7 landscape'],
    channel: 'chrome',
    baseURL: 'http://localhost:5199',
    trace: 'off',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: [
    {
      command: 'npx vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
      env: { VITE_BACKEND: 'local', VITE_DEMO: '1' },
      timeout: 120_000,
    },
    {
      // A LAN host for the Play with Friends e2e (room TEST, mock chain, in-memory db) — never port 8787.
      command: 'pnpm --dir ../server exec tsx src/index.ts',
      url: 'http://127.0.0.1:8790/health',
      reuseExistingServer: false,
      env: { PORT: '8790', HOST: '127.0.0.1', DB_FILE: ':memory:', CHAIN_MODE: 'mock', AGENTS_MODE: 'offline', LAN_ROOM: 'TEST', LAN_NAME: 'Test laptop', QUIET: '1' },
      timeout: 120_000,
    },
  ],
});
