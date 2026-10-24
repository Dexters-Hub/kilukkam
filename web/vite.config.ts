/// <reference types="vitest/config" />
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Phones load one URL (http://<lan-ip>:5173). The WS lives on the same
// origin at /ws and Vite forwards it to the room server.

const PORT = 5173;

/**
 * The address phones should scan. The conductor often opens the app on
 * localhost, which a phone can't reach, so the join QR uses this instead.
 * KILUKKAM_HOST overrides the guess (e.g. when a VPN adds extra interfaces).
 */
const lanHost = (): string => {
  if (process.env.KILUKKAM_HOST) return process.env.KILUKKAM_HOST;
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('172.') ? 1 : ip.startsWith('10.') ? 2 : 3);
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n!.address)
    .sort((a, b) => rank(a) - rank(b));
  return ips[0] ? `${ips[0]}:${PORT}` : '';
};

export default defineConfig({
  plugins: [react()],
  define: {
    __LAN_HOST__: JSON.stringify(lanHost()),
  },
  server: {
    port: PORT,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: process.env.KILUKKAM_WS ?? 'ws://localhost:8787',
        ws: true,
      },
    },
  },
  preview: {
    port: PORT,
    host: '0.0.0.0',
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        demo: resolve(import.meta.dirname, 'demo.html'),
        camera: resolve(import.meta.dirname, 'camera.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
  },
});
