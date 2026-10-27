// @vitest-environment node
/**
 * A production dashboard never ships the in-repo mock data (docs/design/web-v2.md §4): without
 * `VITE_MOCK=1` the mock client and its JSON are removed at build time, so no code path can show
 * made-up pools when the API is down. Builds the app in memory twice: once as `pnpm build` does
 * (nothing from the mock may be in any chunk) and once with `VITE_MOCK=1` (the control: the same
 * strings must then be there, or the first check proves nothing).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Strings that exist only in the mock: a mandate id, a mock pool address, the mock tokens. */
const DATA_STRINGS = [
  'demo-slipstream-weth-usdc',
  'Demo Markets',
  '0x82321f3beb69f503380d6b233857d5c43562e2d0',
]
const MOCK_ONLY = [...DATA_STRINGS, 'createMockClient']

/** The code of every chunk of an in-memory production build of the live dashboard. */
async function buildChunks(env: Record<string, string>): Promise<string[]> {
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    const result = await build({
      root: WEB_ROOT,
      configFile: join(WEB_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      mode: 'production',
      build: { write: false, sourcemap: false, reportCompressedSize: false },
    })
    const outputs = Array.isArray(result) ? result : [result]
    return outputs.flatMap((bundle) =>
      'output' in bundle
        ? bundle.output.flatMap((file) => (file.type === 'chunk' ? [file.code] : []))
        : [],
    )
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('production bundle', () => {
  it('contains none of the mock data without VITE_MOCK=1, and the control build does', async () => {
    const production = (await buildChunks({ NODE_ENV: 'production', VITE_MOCK: '' })).join('\n')
    expect(production.length).toBeGreaterThan(100_000)
    expect(MOCK_ONLY.filter((text) => production.includes(text))).toEqual([])
    // The page for an API that does not answer is in the bundle instead.
    expect(production).toContain('The data service is not answering.')

    const control = (await buildChunks({ NODE_ENV: 'production', VITE_MOCK: '1' })).join('\n')
    // `createMockClient` is minified away; the data strings are what matters.
    expect(DATA_STRINGS.filter((text) => !control.includes(text))).toEqual([])
  }, 120_000)
})
