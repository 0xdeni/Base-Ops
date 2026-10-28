import { defineConfig } from 'vitest/config'

/**
 * Per-test and per-hook limit. Vitest's default is 5 s; the slowest jsdom tests take one to two
 * seconds here, so a runner a few times slower would fail them on time alone.
 */
const LIMIT_MS = 15_000

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts', 'apps/cli/**/*.test.ts'],
          environment: 'node',
          testTimeout: LIMIT_MS,
          hookTimeout: LIMIT_MS,
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          testTimeout: LIMIT_MS,
          hookTimeout: LIMIT_MS,
        },
      },
    ],
  },
})
