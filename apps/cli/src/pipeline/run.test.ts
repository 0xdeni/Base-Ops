import {
  createChainReader,
  createFixture,
  createFixtureTransport,
  isLogRangeLimitError,
  isRetryExhaustedError,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_IDS,
  setClock,
} from '@depthwatch/chain'
import { type Address, DEFAULT_MANDATE_KPIS, type PoolMeta } from '@depthwatch/core'
import { fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { custom, TimeoutError, type Transport } from 'viem'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { positionsPublished } from './positions.js'
import { PipelineStalledError, runIteration, runLoop, STALL_PASSES, sleep } from './run.js'
import { volumeStep } from './volume.js'

/** A reader whose every request misses the (empty) fixture, so each step throws. */
function brokenContext(lines: string[]) {
  const db = openDatabase(':memory:')
  const chain = createChainReader({ transport: createFixtureTransport(createFixture()) })
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  return createPipelineContext({ db, chain, config: loadConfig({}), log })
}

describe('sleep', () => {
  it('resolves early when the signal aborts', async () => {
    const controller = new AbortController()
    const started = Date.now()
    const waiting = sleep(10_000, controller.signal)
    controller.abort()
    await waiting
    expect(Date.now() - started).toBeLessThan(1_000)
    await sleep(0)
    await sleep(5, controller.signal)
  })
})

describe('runIteration', () => {
  it('isolates failing steps so every step is attempted', async () => {
    const lines: string[] = []
    const ctx = brokenContext(lines)
    try {
      const result = await runIteration(ctx, 1, true)
      // score is database-only: with nothing tracked it warns instead of failing.
      expect(result.failed.map((f) => f.step)).toEqual([
        'discover',
        'positions',
        'snapshot',
        'volume',
      ])
      expect(lines.filter((line) => line.includes('failed')).length).toBeGreaterThanOrEqual(4)
      expect(lines.some((line) => line.includes('[score] done'))).toBe(true)
      // The first pass prunes (nothing to delete here); every chain step failed: a stalled pass.
      expect(lines.some((line) => line.includes('[prune] done'))).toBe(true)
      expect(result.stalled).toBe(true)
      // Pruned a moment ago: the next pass leaves prune out.
      const next = await runIteration(ctx, 2, true)
      expect(next.failed.map((f) => f.step)).toEqual(result.failed.map((f) => f.step))
      expect(lines.filter((line) => line.includes('[prune] done'))).toHaveLength(1)
    } finally {
      ctx.db.close()
    }
  })
})

describe('runIteration and the positions of mandated pools', () => {
  it('leaves the positions step out without a mandate or --with-positions', async () => {
    const lines: string[] = []
    const ctx = brokenContext(lines)
    try {
      const result = await runIteration(ctx, 1, false)
      expect(result.failed.map((f) => f.step)).toEqual(['discover', 'snapshot', 'volume'])
      expect(lines.some((line) => line.includes('[positions]'))).toBe(false)
    } finally {
      ctx.db.close()
    }
  })

  it('indexes a mandated concentrated pool before the snapshot, and only that pool', async () => {
    const V3 = SYNTHETIC_POOL_IDS.wethUsdcV3
    const db = openDatabase(IN_MEMORY)
    try {
      const chain = createDemoChain()
      const latest = await chain.getLatestBlock()
      const lines: string[] = []
      const ctx = createPipelineContext({
        db,
        chain,
        config: loadConfig({}, { top: '2' }),
        log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
        now: () => latest.timestamp,
      })
      await discoverStep(ctx)
      const mandate = fixtureMandate({
        id: 'mandated-v3',
        poolId: V3,
        addresses: [SYNTHETIC_OWNERS[0] as Address],
        kpis: { minDepthUsd: 1, ...DEFAULT_MANDATE_KPIS },
        alertAfterSamples: 1,
      })
      db.mandates.upsert(mandate)
      const pass = await runIteration(ctx, 1, false)
      expect(pass.failed).toEqual([])
      expect(pass.stalled).toBe(false)
      const done = (step: string) => lines.findIndex((line) => line.includes(`[${step}] done`))
      expect(done('positions')).toBeGreaterThanOrEqual(0)
      expect(done('positions')).toBeLessThan(done('snapshot'))
      expect(lines.some((l) => l.includes('reading positions') && l.includes('pools=1'))).toBe(true)
      expect(positionsPublished(db, V3)).toBe(true)
      expect(db.mmSamples.latestFor(mandate.id)?.attribution).toMatchObject({
        method: 'positions',
        holdings: 2,
      })
      // Every other tracked pool waits for `--with-positions` or `depthwatch positions`.
      const others = db.pools.trackedIds().filter((id) => id !== V3)
      expect(others.length).toBeGreaterThan(0)
      for (const id of others) expect(positionsPublished(db, id)).toBe(false)
    } finally {
      db.close()
    }
  }, 20_000)
})

/** Every eth_getLogs times out client-side; everything else misses the (empty) fixture. */
function timingOutLogs(count: { logs: number }): Transport {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: 100_000n, latestTimestamp: 1_800_000_000 })
  const inner = createFixtureTransport(fixture)
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'eth_getLogs') {
        count.logs++
        throw new TimeoutError({ body: {}, url: 'https://logs.example' })
      }
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'timeout', name: 'Timeout', retryCount: 0 })(config)
  }
}

describe('runIteration on a logs endpoint that keeps timing out', () => {
  it('records failed steps after one retry budget per range and carries on', async () => {
    const count = { logs: 0 }
    const db = openDatabase(':memory:')
    const pool: PoolMeta = {
      id: `uniswap-v3:${'0x'.padEnd(42, '4')}`,
      dex: 'uniswap-v3',
      kind: 'concentrated',
      address: '0x'.padEnd(42, '4') as Address,
      poolId: null,
      token0: { address: '0x'.padEnd(42, 'a') as Address, symbol: 'A', name: 'A', decimals: 18 },
      token1: { address: '0x'.padEnd(42, 'd') as Address, symbol: 'D', name: 'D', decimals: 6 },
      feePips: 500,
      tickSpacing: 10,
      stable: false,
      hooks: null,
      createdAtBlock: 1n,
    }
    db.pools.upsertMany([pool])
    db.pools.setTracked([pool.id], true)
    const chain = createChainReader({
      transport: timingOutLogs(count),
      logRetry: { retries: 2, sleep: async () => {} },
    })
    const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
    try {
      const result = await runIteration(ctx, 1, false)
      const volume = result.failed.find((f) => f.step === 'volume')
      expect(volume?.error).toMatch(/^eth_getLogs blocks \d+-\d+: still failing after 2 retries/)
      // One range, two retries: no halving into ranges that each spend the budget again.
      expect(count.logs).toBe(3)
      const error = await volumeStep(ctx).catch((e: unknown) => e)
      expect(isRetryExhaustedError(error)).toBe(true)
      expect(isLogRangeLimitError(error)).toBe(false)
    } finally {
      db.close()
    }
  })
})

describe('runLoop', () => {
  it('runs once with --once, returning the failed steps, and stops on abort between iterations', async () => {
    const lines: string[] = []
    const ctx = brokenContext(lines)
    try {
      const once = await runLoop(ctx, { once: true, intervalSeconds: 1 })
      expect(once.iterations).toBe(1)
      expect(once.lastFailed.map((f) => f.step)).toEqual(['discover', 'snapshot', 'volume'])
      for (const failure of once.lastFailed) expect(failure.error).toMatch(/fixture/i)
      const controller = new AbortController()
      let sleeps = 0
      const loop = await runLoop(ctx, {
        intervalSeconds: 1,
        signal: controller.signal,
        sleep: async () => {
          sleeps++
          if (sleeps === 2) controller.abort()
        },
      })
      expect(loop.iterations).toBe(2)
      expect(loop.lastFailed.map((f) => f.step)).toEqual(['discover', 'snapshot', 'volume'])
      expect(sleeps).toBe(2)
    } finally {
      ctx.db.close()
    }
  })

  it('stops with PipelineStalledError once every chain step failed in three passes in a row', async () => {
    const lines: string[] = []
    const ctx = brokenContext(lines)
    try {
      let sleeps = 0
      const error = await runLoop(ctx, {
        intervalSeconds: 1,
        sleep: async () => {
          sleeps++
        },
      }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(PipelineStalledError)
      expect((error as Error).message).toMatch(
        /^run: every step that reads the chain failed in 3 passes in a row; last errors: discover: /,
      )
      expect(STALL_PASSES).toBe(3)
      expect(sleeps).toBe(2)
      expect(lines.filter((line) => line.includes('iteration done'))).toHaveLength(3)
      expect(lines.some((line) => line.includes('stalledPasses=3'))).toBe(true)
    } finally {
      ctx.db.close()
    }
  })
})
