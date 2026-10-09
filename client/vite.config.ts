import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** This file lives in client/, which is the Vite project root. */
const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Vite configuration for the BookMySeat frontend.
 *
 * In development the API runs separately (npm run dev:api) and /api is proxied
 * to it, so the browser only ever talks to one origin.
 */
export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    // The sandbox/preview host is not localhost, so host checking must be off.
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
