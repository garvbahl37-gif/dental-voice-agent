import { defineConfig } from 'vitest/config'

const src = (p: string) => new URL(`./packages/${p}`, import.meta.url).pathname

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // pglite boots a WASM Postgres per suite, which is slower than a unit test
    // but still seconds, not minutes. The default 5s timeout trips on the first
    // database-backed suite on a cold machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    /**
     * Subpath entries must come before their package root.
     *
     * Vite matches these in order by prefix, so a bare `@vaani/db` listed first
     * would swallow `@vaani/db/testing` and resolve it to the production
     * barrel — which is exactly the entry point that deliberately does not
     * export the test harness.
     */
    alias: {
      '@vaani/db/testing': src('db/src/testing.ts'),
      '@vaani/db/schema': src('db/src/schema.ts'),
      '@vaani/providers/lang-detect': src('providers/src/lang-detect.ts'),
      '@vaani/providers/types': src('providers/src/types.ts'),
      '@vaani/live/config': src('live/src/config.ts'),
      '@vaani/telephony/audio': src('telephony/src/audio.ts'),
      '@vaani/shared': src('shared/src/index.ts'),
      '@vaani/core': src('core/src/index.ts'),
      '@vaani/providers': src('providers/src/index.ts'),
      '@vaani/db': src('db/src/index.ts'),
      '@vaani/agent': src('agent/src/index.ts'),
      '@vaani/live': src('live/src/index.ts'),
      '@vaani/telephony': src('telephony/src/index.ts'),
      '@vaani/outbound': src('outbound/src/index.ts'),
      '@vaani/knowledge': src('knowledge/src/index.ts'),
    },
  },
})
