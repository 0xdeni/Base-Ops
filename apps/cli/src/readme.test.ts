/**
 * The README's first steps and measured figures match what the CLI does. Its Quick start opens
 * with the seed, which reads factory views, rather than a factory-log scan of about 97,000
 * requests; its status points at a dated record of what has run on Base; and its free-RPC volume
 * cost quotes the same first-pass figure as docs/ARCHITECTURE.md, three event sources for four
 * DEXes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const architecture = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')

/** The body of `heading` up to the next heading of any level. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,6} /)
  return end < 0 ? body : body.slice(0, end)
}

/** The same text with line wraps collapsed to single spaces. */
const flat = (text: string) => text.replace(/\s+/g, ' ')

const MEASURED = '### Measured on Base, 2026-10-25'

describe('README: Quick start', () => {
  const quickStart = section(readme, '## Quick start')

  it('runs the seed first, not a factory-log scan', () => {
    const commands = [...quickStart.matchAll(/^pnpm depthwatch (\S+(?: --\S+)*)/gm)].map(
      (m) => m[1],
    )
    expect(commands[0]).toBe('discover --seed')
    expect(commands.slice(1, 5)).toEqual(['snapshot', 'volume', 'score', 'serve'])
  })

  it('says what a plain discover costs', () => {
    expect(flat(quickStart)).toMatch(/about 97,000 `eth_getLogs` at the default 2,000-block/)
  })
})

describe('README: what has run on Base', () => {
  it('has the dated record, and the status paragraph links to it', () => {
    expect(readme).toContain(`\n${MEASURED}\n`)
    const status = flat(readme.slice(readme.indexOf('**Status:'), readme.indexOf('\n## ')))
    expect(status).toContain('(#measured-on-base-2026-10-25)')
    expect(status).toMatch(/not yet validated against Base mainnet at scale/)
  })

  it('records the seed and volume counters and what was not covered', () => {
    const measured = flat(section(readme, MEASURED))
    for (const figure of ['580 pools', '13,399', '1,968', '492 pools', '267,572', '18,131'])
      expect(measured).toContain(figure)
    expect(measured).toMatch(/no 7-day run and no swap cross-check/)
  })
})

describe('README and docs/ARCHITECTURE.md: volume cost on a 10-block plan', () => {
  const freeRpc = flat(section(readme, '### Running on a free RPC'))

  it('counts per event source, three for four DEXes, not per DEX', () => {
    expect(freeRpc).toMatch(/per 10 blocks per event source \(three: Uniswap v3 and Slipstream/)
    expect(freeRpc).not.toMatch(/per DEX/)
  })

  it('quotes the same first-pass request figure as the architecture notes', () => {
    const figure = 'about 13,600 requests'
    expect(freeRpc).toContain(figure)
    expect(flat(architecture)).toContain(figure)
  })
})
