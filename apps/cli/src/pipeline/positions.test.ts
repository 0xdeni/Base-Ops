import {
  type ChainReader,
  LogRangeLimitError,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_IDS,
} from '@depthwatch/chain'
import { type Address, DEFAULT_MANDATE_KPIS, type PoolMeta, type Position } from '@depthwatch/core'
import { fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain } from '../demo.js'
import { createLogger } from '../log.js'
import { createPipelineContext, syncKeys } from './context.js'
import { discoverStep } from './discover.js'
import { defaultPositionPools, mergePositions, positionKey, positionsStep } from './positions.js'
import { runIteration } from './run.js'

const alice: Address = '0x00000000000000000000000000000000000000a1'
const bob: Address = '0x00000000000000000000000000000000000000b2'

const position = (partial: Partial<Position> & Pick<Position, 'tokenId'>): Position => ({
  owner: alice,
  tickLower: -100,
  tickUpper: 100,
  liquidity: 10n,
  ...partial,
})

describe('positionKey', () => {
  it('keys by token id, or by owner and range without one', () => {
    expect(positionKey(position({ tokenId: 7n }))).toBe('id:7')
    expect(positionKey(position({ tokenId: null, owner: bob, tickLower: 5, tickUpper: 9 }))).toBe(
      `anon:${bob}:5:9`,
    )
  })
})

describe('mergePositions', () => {
  it('lets fresh reads override stored ones, drops closed positions and sorts by range', () => {
    const existing = [
      position({ tokenId: 1n, tickLower: 0, tickUpper: 10 }),
      position({ tokenId: 2n, tickLower: -50, tickUpper: 50, owner: bob }),
      position({ tokenId: null, owner: bob, tickLower: -10, tickUpper: 10, liquidity: 3n }),
    ]
    const fresh = [
      position({ tokenId: 2n, tickLower: -50, tickUpper: 50, owner: alice, liquidity: 99n }),
      position({ tokenId: 1n, tickLower: 0, tickUpper: 10, liquidity: 0n }),
      position({ tokenId: 3n, tickLower: -50, tickUpper: 60 }),
    ]
    expect(mergePositions(existing, fresh)).toEqual([
      position({ tokenId: 2n, tickLower: -50, tickUpper: 50, owner: alice, liquidity: 99n }),
      position({ tokenId: 3n, tickLower: -50, tickUpper: 60 }),
      position({ tokenId: null, owner: bob, tickLower: -10, tickUpper: 10, liquidity: 3n }),
    ])
  })

  it('is a plain copy for a first run', () => {
    const fresh = [position({ tokenId: 5n })]
    expect(mergePositions([], fresh)).toEqual(fresh)
    expect(mergePositions([], [])).toEqual([])
  })
})

describe('positionsStep on a freshly mandated pool', () => {
  const V3 = SYNTHETIC_POOL_IDS.wethUsdcV3
  const fetchSpy = vi.fn(async () => new Response(null, { status: 200 }))
  afterEach(() => {
    vi.unstubAllGlobals()
    fetchSpy.mockClear()
  })

  it('indexes it before its first snapshot, so the first sample is attributed', async () => {
    vi.stubGlobal('fetch', fetchSpy)
    const db = openDatabase(IN_MEMORY)
    try {
      const chain = createDemoChain()
      const latest = await chain.getLatestBlock()
      const lines: string[] = []
      const ctx = createPipelineContext({
        db,
        chain,
        // Nothing ranks into the top: only the mandated pool is ever tracked.
        config: loadConfig({}, { top: '0' }),
        log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
        now: () => latest.timestamp,
      })
      await discoverStep(ctx)
      expect(db.pools.trackedIds()).toEqual([])
      const mandate = fixtureMandate({
        id: 'fresh-v3',
        poolId: V3,
        addresses: [SYNTHETIC_OWNERS[0] as Address],
        kpis: { minDepthUsd: 1, ...DEFAULT_MANDATE_KPIS },
        alertAfterSamples: 1,
        alertWebhookUrl: 'https://hooks.example.invalid/depthwatch',
      })
      db.mandates.upsert(mandate)
      // Untracked, but mandated: indexed by default; a mandate on an unknown pool adds nothing.
      db.mandates.upsert(
        fixtureMandate({
          id: 'orphan',
          poolId: 'uniswap-v3:0x00000000000000000000000000000000000000ff',
        }),
      )
      expect(defaultPositionPools(db).map((p) => p.id)).toEqual([V3])

      // `run --with-positions`, first pass: positions → snapshot.
      const pass = await runIteration(ctx, 1, true)
      expect(pass.failed).toEqual([])
      expect(db.positions.countForPool(V3)).toBeGreaterThan(0)
      expect(db.pools.trackedIds()).toEqual([V3])
      const sample = db.mmSamples.latestFor(mandate.id)
      expect(sample?.attribution).toMatchObject({ method: 'positions', holdings: 2 })
      expect(sample?.withinKpi).toBe(true)
      expect(sample?.breaches).toEqual([])
      expect(db.mmAlerts.countFor(mandate.id)).toBe(0)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(lines.some((l) => l.includes('no tracked or mandated concentrated pools'))).toBe(false)
    } finally {
      db.close()
    }
  }, 20_000)

  it('still names the default pools when there is nothing to index', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const lines: string[] = []
      const ctx = createPipelineContext({
        db,
        chain: createDemoChain(),
        config: loadConfig({}),
        log: createLogger({ write: (line) => lines.push(line), now: () => new Date(0) }),
      })
      const result = await positionsStep(ctx)
      expect(result.pools).toEqual([])
      expect(lines.some((l) => l.includes('no tracked or mandated concentrated pools'))).toBe(true)
    } finally {
      db.close()
    }
  })
})

describe('positionsStep on a logs endpoint that cannot serve the chunk', () => {
  it('starts no further pool after the first LogRangeLimitError and throws it once', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const pools: PoolMeta[] = Array.from({ length: 20 }, (_, i) => ({
        id: `uniswap-v3:0x${(0x500 + i).toString(16).padStart(40, '0')}`,
        dex: 'uniswap-v3',
        kind: 'concentrated',
        address: `0x${(0x500 + i).toString(16).padStart(40, '0')}` as Address,
        poolId: null,
        token0: { address: alice, symbol: 'A', name: 'A', decimals: 18 },
        token1: { address: bob, symbol: 'B', name: 'B', decimals: 6 },
        feePips: 500,
        tickSpacing: 10,
        stable: false,
        hooks: null,
        createdAtBlock: 1n,
      }))
      const limit = new LogRangeLimitError({
        reason: 'stated',
        maxRange: 10n,
        chunkSize: 2_000n,
        minRange: 100n,
        fromBlock: 1n,
        toBlock: 2_000n,
        providerMessage: 'up to a 10 block range',
      })
      let reads = 0
      const chain = {
        getLatestBlock: async () => ({ number: 1_000_000n, timestamp: 1_800_000_000 }),
        readCustodians: async () => [],
        readPositions: async () => {
          reads++
          await new Promise((resolve) => setTimeout(resolve, 1))
          throw limit
        },
      } as unknown as ChainReader
      const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
      await expect(positionsStep(ctx, { pools })).rejects.toBe(limit)
      expect(reads).toBe(ctx.config.concurrency) // the pools already in flight, not all 20
    } finally {
      db.close()
    }
  })
})

describe('positionsStep storing a published pool', () => {
  it('reads the stored set inside its write transaction and merges what was stored meanwhile', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const address = `0x${'7'.repeat(40)}` as Address
      const pool: PoolMeta = {
        id: `uniswap-v3:${address}`,
        dex: 'uniswap-v3',
        kind: 'concentrated',
        address,
        poolId: null,
        token0: { address: alice, symbol: 'A', name: 'A', decimals: 18 },
        token1: { address: bob, symbol: 'B', name: 'B', decimals: 6 },
        feePips: 500,
        tickSpacing: 10,
        stable: false,
        hooks: null,
        createdAtBlock: 1n,
      }
      db.positions.replaceForPool(pool.id, [position({ tokenId: 1n })], { updatedBlock: 100n })
      db.syncState.setBigInt(syncKeys.positions(pool.id), 100n)
      const chain = {
        getLatestBlock: async () => ({ number: 200n, timestamp: 1_800_000_000 }),
        readCustodians: async () => [],
        readPositions: async () => {
          // Another writer stores the pool's set while this read is in flight.
          db.positions.replaceForPool(
            pool.id,
            [position({ tokenId: 1n }), position({ tokenId: 2n, owner: bob })],
            { updatedBlock: 150n },
          )
          return [position({ tokenId: 3n, tickLower: -200 })]
        },
      } as unknown as ChainReader
      const forPool = db.positions.forPool.bind(db.positions)
      const inTransaction: boolean[] = []
      vi.spyOn(db.positions, 'forPool').mockImplementation((poolId) => {
        inTransaction.push(db.raw.isTransaction)
        return forPool(poolId)
      })

      const ctx = createPipelineContext({ db, chain, config: loadConfig({}) })
      const result = await positionsStep(ctx, { pools: [pool] })

      expect(result.failed).toEqual([])
      expect(inTransaction).toEqual([true])
      expect(forPool(pool.id).map((p) => p.tokenId)).toEqual([3n, 1n, 2n])
      expect(db.syncState.getBigInt(syncKeys.positions(pool.id))).toBe(200n)
    } finally {
      db.close()
    }
  })
})
