/**
 * docs/ARCHITECTURE.md describes this pipeline, and the numbers in its RPC cost model are derived
 * from constants that live here (chunk size defaults, the volume window, the factory list, the
 * pipeline steps). These checks pin that prose to the code, so a default that moves fails a test
 * instead of silently dating the page.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_ADDRESSES,
  DEFAULT_LOG_CHUNK_SIZE,
  DEFAULT_SEED_BATCH,
  DEFAULT_SEED_CONCURRENCY,
  probesFor,
  REFERENCE_TOKENS,
  swapScanOf,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from '@depthwatch/chain'
import { DEXES, NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { DEFAULTS, loadConfig, parseCliArgs } from '../config.js'
import { BLOCKS_PER_HOUR } from './context.js'
import { PIPELINE_STEPS } from './run.js'
import { VOLUME_JITTER_BLOCKS, VOLUME_MARGIN_BLOCKS } from './volume.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const doc = readFileSync(join(HERE, '..', '..', '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8')

/** One heading's body up to the next heading, with line wraps collapsed to single spaces. */
function section(heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found in ARCHITECTURE.md`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,3} /)
  return (end < 0 ? body : body.slice(0, end)).replace(/\s+/g, ' ')
}

/** The capture groups of `re` in `text` as bigints (digit-group commas stripped). */
function numbers(text: string, re: RegExp): bigint[] {
  const match = text.match(re)
  if (!match) throw new Error(`expected ${re} in:\n${text}`)
  return match.slice(1).map((n) => BigInt(n.replaceAll(',', '')))
}

/** `getLogs` requests for a range of `blocks` blocks: one per started chunk (internal/logs.ts). */
const chunksFor = (blocks: bigint, chunk: bigint): bigint => (blocks + chunk - 1n) / chunk

const CLI_CHUNK = BigInt(DEFAULTS.logChunkSize)
const BLOCKS_PER_DAY = 24n * BLOCKS_PER_HOUR
/** Blocks `volumeStep` scans for the default `--hours` (volume.ts). */
const VOLUME_WINDOW = BigInt(DEFAULTS.hours) * BLOCKS_PER_HOUR + VOLUME_MARGIN_BLOCKS
/**
 * Most blocks a later `run` pass reads per DEX (volume.ts `planVolumeScan`): the hour that held the
 * previous head, the blocks of one interval (2 s each) and the jitter margin.
 */
const VOLUME_PASS_MAX =
  BLOCKS_PER_HOUR + BigInt(DEFAULTS.intervalSeconds) / 2n + VOLUME_JITTER_BLOCKS

describe('ARCHITECTURE.md: RPC cost model uses the CLI chunk default', () => {
  const discovery = section('### Discovery: chunked `getLogs`')
  const volume = section('### Volume: chunked `getLogs` on many addresses')
  const cycle = section('### Per cycle')

  it('names the CLI default and 10,000 only as the library default', () => {
    // main.ts always passes config.logChunkSize to createChainReader, so the CLI default rules.
    expect(loadConfig({}).logChunkSize).toBe(DEFAULTS.logChunkSize)
    expect(CLI_CHUNK).not.toBe(DEFAULT_LOG_CHUNK_SIZE)
    const [cli] = numbers(discovery, /The `depthwatch` CLI defaults to ([\d,]+) blocks per chunk/)
    expect(cli).toBe(CLI_CHUNK)
    const [lib] = numbers(discovery, /([\d,]+) is only the library default of `createChainReader`/)
    expect(lib).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(discovery).not.toMatch(/\(default 10,000\)/)
  })

  it('sizes a day of incremental discovery at both chunk sizes', () => {
    const [chunks, at, libChunks, libAt] = numbers(
      discovery,
      /a day \(([\d,]+) blocks\) in about (\d+) chunks per factory at ([\d,]+) blocks, or about (\d+) at ([\d,]+)/,
    ).slice(1)
    expect(at).toBe(CLI_CHUNK)
    expect(chunks).toBe(chunksFor(BLOCKS_PER_DAY, CLI_CHUNK))
    expect(libAt).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(libChunks).toBe(chunksFor(BLOCKS_PER_DAY, DEFAULT_LOG_CHUNK_SIZE))
    expect(numbers(discovery, /a day \(([\d,]+) blocks\)/)[0]).toBe(BLOCKS_PER_DAY)
  })

  it('sizes the default 24 h volume window at both chunk sizes', () => {
    expect(DEFAULTS.hours).toBe(24)
    const [blocks, chunks, at, libChunks, libAt] = numbers(
      volume,
      /a 24 h window is about ([\d,]+) blocks: about (\d+) chunks at the CLI default of ([\d,]+) blocks, or about (\d+) at ([\d,]+)/,
    )
    expect(blocks).toBe(VOLUME_WINDOW)
    expect(at).toBe(CLI_CHUNK)
    expect(chunks).toBe(chunksFor(VOLUME_WINDOW, CLI_CHUNK))
    expect(libAt).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(libChunks).toBe(chunksFor(VOLUME_WINDOW, DEFAULT_LOG_CHUNK_SIZE))
  })

  it('counts per-cycle getLogs from the factory list and the CLI chunk default', () => {
    const factories = [
      BASE_ADDRESSES.uniswapV3.factory,
      BASE_ADDRESSES.uniswapV4.poolManager,
      BASE_ADDRESSES.aerodromeV2.poolFactory,
      ...BASE_ADDRESSES.aerodromeSlipstream.map((d) => d.factory),
    ]
    const [discoveryLogs] = numbers(cycle, /(\d+) `getLogs` for discovery/)
    expect(discoveryLogs).toBe(BigInt(factories.length))
    const [fewest, most] = numbers(
      cycle,
      /(\d+) to (\d+) `getLogs` per event source with tracked pools for volume/,
    )
    expect(fewest).toBe(1n)
    expect(most).toBe(chunksFor(VOLUME_PASS_MAX, CLI_CHUNK))
    expect(numbers(cycle, /at most about ([\d,]+) blocks/)[0]).toBe(VOLUME_PASS_MAX)
    const [first, at] = numbers(cycle, /~(\d+) `getLogs` per source at ([\d,]+) blocks/)
    expect(first).toBe(chunksFor(VOLUME_WINDOW, CLI_CHUNK))
    expect(at).toBe(CLI_CHUNK)
    expect(section('### Volume: chunked `getLogs` on many addresses')).toContain(
      `less a ${VOLUME_JITTER_BLOCKS}-block margin (\`VOLUME_JITTER_BLOCKS\`)`,
    )
  })

  it('sizes volume on a 10-block plan from the window and the day', () => {
    const free = section('### Rate limits, range limits and free plans')
    const [blocks, requests] = numbers(
      free,
      /`volume` for 24 h is ([\d,]+) blocks: ([\d,]+) `eth_getLogs` per event source/,
    )
    expect(blocks).toBe(VOLUME_WINDOW)
    // The scan is inclusive of both ends: ⌈45 301 / 10⌉ requests.
    expect(requests).toBe(chunksFor(VOLUME_WINDOW + 1n, 10n))
    const [daily] = numbers(free, /about ([\d,]+) requests per source a day/)
    expect(daily).toBe(BLOCKS_PER_DAY / 10n)
    // Uniswap v3 and Slipstream share one scan (same Swap event): three sources for four DEXes.
    const sources = BigInt(new Set(DEXES.map(swapScanOf)).size)
    expect(sources).toBe(3n)
    const [all] = numbers(free, /about ([\d,]+) requests with all four DEXes \(three sources\)/)
    expect(all).toBe(((sources * chunksFor(VOLUME_WINDOW + 1n, 10n) + 50n) / 100n) * 100n)
  })
})

describe('ARCHITECTURE.md: positions can run inside `run`', () => {
  it('documents --with-positions as the per-pass opt-in instead of excluding the step', () => {
    expect(PIPELINE_STEPS).toContain('positions')
    expect(parseCliArgs(['run', '--with-positions']).flags.withPositions).toBe(true)
    const positions = section('### Positions')
    expect(positions).toContain('`run --with-positions`')
    expect(positions).toContain('`depthwatch positions`')
    expect(positions).not.toMatch(/rather than inside `run`/)
  })
})

describe('ARCHITECTURE.md: seeded discovery counts', () => {
  const seed = section('### Seeded discovery: factory views and archive state')
  const pairs = (n: number) => BigInt((n * (n - 1)) / 2)

  it('derives the candidate counts from the reference tokens and the seeded tiers', () => {
    const erc20 = REFERENCE_TOKENS.filter((t) => t.address !== NATIVE_ETH).length
    const [tokens, erc20s, erc20Pairs, currencyPairs, v3, v2, v4] = numbers(
      seed,
      /With the (\d+) reference tokens \((\d+) ERC-20s and native ETH\) that is (\d+) ERC-20 pairs and (\d+) currency pairs: ([\d,]+) v3, ([\d,]+) Aerodrome v2, ([\d,]+) v4/,
    )
    expect(tokens).toBe(BigInt(REFERENCE_TOKENS.length))
    expect(erc20s).toBe(BigInt(erc20))
    expect(erc20Pairs).toBe(pairs(erc20))
    expect(currencyPairs).toBe(pairs(REFERENCE_TOKENS.length))
    expect(v3).toBe(pairs(erc20) * BigInt(UNISWAP_V3_CANDIDATE_FEES.length))
    expect(v2).toBe(pairs(erc20) * 2n)
    expect(v4).toBe(pairs(REFERENCE_TOKENS.length) * BigInt(UNISWAP_V4_STANDARD_KEYS.length))
    const tiers = numbers(
      seed,
      /enabled on Base: (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\)/,
    )
    expect(tiers).toEqual(UNISWAP_V3_CANDIDATE_FEES.map(BigInt))
  })

  it('sizes the creation-block search from the v3 start block and the concurrency', () => {
    const [probes] = numbers(seed, /(\d+) for a Uniswap v3 pool at a head near 53 M/)
    expect(probes).toBe(BigInt(probesFor(BASE_ADDRESSES.uniswapV3.startBlock, 53_000_000n)))
    expect(seed).toContain(`\`DEFAULT_SEED_CONCURRENCY\` (${DEFAULT_SEED_CONCURRENCY})`)
    expect(seed).toContain(`\`DEFAULT_SEED_BATCH\` (${DEFAULT_SEED_BATCH})`)
  })
})
