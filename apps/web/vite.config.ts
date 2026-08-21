import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    // Deliberately NOT Vite's default 5173. That port is shared by every Vite
    // project on a developer's machine, and a PWA that once ran there leaves a
    // service worker registered for the whole origin — which then serves its
    // own cached shell here, no matter what is actually listening. The symptom
    // is opening this app and seeing a different product entirely, which is
    // impossible to diagnose from inside this repo.
    //
    // strictPort so a collision fails loudly instead of silently sliding to
    // 5274 and breaking the OIDC redirect URIs registered for this origin.
    port: 5273,
    strictPort: true,
    // Bind both stacks. Vite has resolved `localhost` to IPv6-only here, which
    // makes http://127.0.0.1 refuse connections while http://localhost works —
    // a confusing difference when following instructions that use either.
    host: '0.0.0.0',
    // Local dev only. In production Caddy serves both from one origin, so no
    // proxy and no CORS are involved.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
