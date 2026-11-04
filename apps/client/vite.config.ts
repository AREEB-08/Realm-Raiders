import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Chunking adapted from the reused web-coc vite config (manualChunks), minus its native-page
// plugins: Phaser, Three and the auth SDK each load in their own chunk so first paint stays light.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@privy-io') || id.includes('node_modules/@walletconnect')) return 'auth';
        },
      },
    },
  },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
