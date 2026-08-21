import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running development stack.
 *
 * These are deliberately few. They exist to prove the paths that span every
 * layer — browser, OIDC, API, RLS, Postgres — still connect, which no unit test
 * can. Everything cheaper to test elsewhere is tested elsewhere: RLS in the API
 * suites, component behaviour in vitest.
 *
 * They are NOT run in the default `pnpm test`, because they need the dev stack,
 * Keycloak and seeded data. Run them deliberately:
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   pnpm --filter @hr/api hr seed-demo
 *   pnpm dev
 *   pnpm e2e
 */
export default defineConfig({
  testDir: '.',
  // One worker: these share a database and a Keycloak session, and a parallel
  // run would have two tests calibrating the same review cycle.
  workers: 1,
  fullyParallel: false,
  // A cold Vite dev server compiling a route for the first time is slow in a
  // way that has nothing to do with the application.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5273',
    // Keycloak in dev serves plain HTTP with a self-signed-ish setup.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { storageState: '.auth/maria.json' },
      testMatch: /.*\.e2e\.ts/,
    },
  ],
});
