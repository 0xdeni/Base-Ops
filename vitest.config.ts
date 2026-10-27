import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/**/*.test.ts', 'apps/api/**/*.test.ts', 'apps/cli/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
        },
      },
    ],
  },
})
