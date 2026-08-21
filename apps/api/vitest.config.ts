import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // Vitest transforms with esbuild, which does not emit `design:paramtypes`.
  // NestJS resolves constructor injection from exactly that metadata, so under
  // esbuild every injected dependency arrives as `undefined` and the container
  // fails at the first property access — with no DI error to point at the cause.
  //
  // This is the same defect that broke `pnpm dev` (fixed there by running real
  // tsc instead of tsx), and it is why the HTTP layer had no tests: booting the
  // application inside vitest was not possible. SWC emits the metadata, so it
  // is.
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.spec.ts'],
    setupFiles: ['test/setup-env.ts'],
    // Testcontainers pulls and boots a real PostgreSQL; the first run on a
    // clean machine is dominated by the image pull.
    testTimeout: 60_000,
    hookTimeout: 300_000,
    // Each suite owns its own container. Running them in parallel means several
    // Postgres instances at once, which is slower than it sounds on a laptop
    // and produces confusing port contention on CI.
    fileParallelism: false,
  },
});
