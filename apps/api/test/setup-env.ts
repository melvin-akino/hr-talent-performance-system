/**
 * Config is validated at module load and exits the process when invalid --
 * intentional fail-fast behaviour (config.ts). Tests import modules that pull
 * in that config transitively, so the environment must exist before any test
 * module is loaded. Runs via `setupFiles` in vitest.config.ts.
 *
 * These values are placeholders. Suites that need a real database create their
 * own Testcontainers instance and connect explicitly.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.OIDC_ISSUER_URL ??= 'https://oidc.invalid/realms/test';
process.env.OIDC_AUDIENCE ??= 'hr-system-test';
process.env.LOG_LEVEL ??= 'silent';
