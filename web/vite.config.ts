/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// Phones load one URL (http://<lan-ip>:5173). The WS lives on the same
// origin at /ws and Vite forwards it to the room server.
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    host: '0.0.0.0',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
