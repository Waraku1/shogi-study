import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { ViteDevServer, PreviewServer } from 'vite';

const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig(({ mode }) => ({
  define: { __SHOGI_GUEST_ONLY__: JSON.stringify(mode === 'guest') },
  server: { headers, proxy: mode === 'guest' ? undefined : { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  // A guest-only origin has no online API, even if a local Worker is running.
  // Also reject requests in preview so an old account cookie cannot be used.
  plugins: [react(), ...(mode === 'guest' ? [{
    name: 'guest-only-api-boundary',
    configureServer(server: ViteDevServer) { server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/')) { res.statusCode = 404; res.end('Guest-local mode has no API'); }
      else next();
    }); },
    configurePreviewServer(server: PreviewServer) { server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/')) { res.statusCode = 404; res.end('Guest-local mode has no API'); }
      else next();
    }); },
  }] : [])],
  preview: { headers },
  test: { include: ['tests/**/*.test.{ts,mjs}'] },
}));
