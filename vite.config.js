import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The live cert_service code path calls http://127.0.0.1:8765 directly and that
// origin already enables flask-cors, so it works without a proxy. The proxy
// below is kept so relative `/api/*` calls also work if the client is ever
// switched to same-origin requests.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
});
