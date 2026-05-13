import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev: proxy /api, /webhook, /webhooks, /healthz to the Express server on :3000
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/webhook': 'http://localhost:3000',
      '/webhooks': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
