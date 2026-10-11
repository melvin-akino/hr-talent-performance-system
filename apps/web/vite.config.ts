import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Serves the public landing page at `/` in the dev server.
 *
 * In production the web server does this (nginx.conf: `location = /`), so the
 * site root is the marketing page and the application starts at /home (see
 * src/routes.ts). Without the same rule here, `pnpm dev` would show the
 * application at `/` while every deployed copy shows the landing page — the sort
 * of difference that is only noticed after it ships.
 *
 * Only the exact root. Every other path, `/home` and `/callback` included, still
 * falls through to the application.
 */
function landingAtRoot(): Plugin {
  return {
    name: 'landing-at-root',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? '';
        if (url === '/' || url.startsWith('/?')) req.url = `/landing.html${url.slice(1)}`;
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), landingAtRoot()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      // Two documents: the application and the public landing page. The landing
      // page is a plain HTML entry with its own stylesheet and no script.
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
      },
    },
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
      // Must match PORT in apps/api/.env.development. Overridable so a machine
      // with a port conflict is a shell variable rather than an edit here:
      //
      //   API_PROXY_TARGET=http://localhost:3200 pnpm dev
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
});
