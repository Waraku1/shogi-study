import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [react()],
  server: { headers },
  preview: { headers },
  test: { include: ['tests/**/*.test.{ts,mjs}'] },
});
