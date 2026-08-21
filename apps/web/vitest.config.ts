import { defineConfig } from 'vitest/config';

/**
 * Two environments in one project. The help-content and navigation specs are
 * plain data and run in node; component specs opt into jsdom per file with a
 * `@vitest-environment jsdom` docblock.
 *
 * Node is the default deliberately — most of these tests never touch a
 * document, and making them all pay for one costs seconds on every run.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environment: 'node',
  },
});
