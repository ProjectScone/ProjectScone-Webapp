import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { trustedLocalRequest } from './scripts/host.mjs';

const backend = process.env.SCONE_DEV_API || 'http://127.0.0.1:7437';
const url = new URL(backend);
if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
  throw new Error('SCONE_DEV_API must be an unauthenticated loopback HTTP address');
}

export default defineConfig({
  plugins: [react(), {
    name: 'scone-local-session',
    configureServer(server) {
      server.middlewares.use('/__scone/session', (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        const trusted = trustedLocalRequest(request);
        response.statusCode = trusted ? 200 : 403;
        response.end(JSON.stringify({key: trusted ? process.env.SCONE_UI_KEY || '' : ''}));
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { strict: true, allow: [fileURLToPath(new URL('.', import.meta.url))] },
    proxy: {
      '/v1': { target: backend, changeOrigin: false, ws: true },
      '/healthz': { target: backend, changeOrigin: false },
    },
  },
  build: {
    assetsInlineLimit: 1_000_000,
    cssCodeSplit: true,
    modulePreload: false,
    sourcemap: false,
  },
});
