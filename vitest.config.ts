import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@vaani/shared': new URL('./packages/shared/src/index.ts', import.meta.url).pathname,
      '@vaani/core': new URL('./packages/core/src/index.ts', import.meta.url).pathname,
      '@vaani/providers': new URL('./packages/providers/src/index.ts', import.meta.url).pathname,
      '@vaani/db': new URL('./packages/db/src/index.ts', import.meta.url).pathname,
      '@vaani/agent': new URL('./packages/agent/src/index.ts', import.meta.url).pathname,
    },
  },
})
