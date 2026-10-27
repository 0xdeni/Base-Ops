/**
 * Windowed positions runs (`depthwatch start`): pools near the head read from their cursors, pools
 * far behind share windows from the oldest cursor, a first scan stays unpublished (staged) until a
 * window reaches the head, a mandated pool without positions reads to the head on its own range
 * at once, and a time budget stops a run between pools and windows.
 */
import type { ChainReader } from '@depthwatch/chain'
import type { Address, PoolMeta, Position } from '@depthwatch/core'
import { type Database, fixtureMandate, IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createPipelineContext, syncKeys } from './context.js'
import { storedPositions } from './mm.js'
import {
  positionsPublished,
  positionsStagingId,
  positionsStep,
  unindexedMandatedPools,
} from './positions.js'

const HEAD = 2_000_000n
const WINDOW = 500_000n
const owner = '0x00000000000000000000000000000000000000a1' as Address

function pool(n: number, createdAtBlock: bigint): PoolMeta {
  const address = `0x${(0x700 + n).toString(16).padStart(40, '0')}` as Address
  return {
    id: `uniswap-v3:${address}`,
    dex: 'uniswap-v3',
    kind: 'concentrated',
    address,
    poolId: null,
    token0: {
      address: `0x${'aa'.padStart(40, '0')}` as Address,
      symbol: 'A',
      name: 'A',
      decimals: 18,
    },
    token1: {
      address: `0x${'dd'.padStart(40, '0')}` as Address,
      symbol: 'D',
      name: 'D',
      decimals: 6,
    },
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks: null,
    createdAtBlock,
  }
}

/** A: up to date, B and C: far behind (new), D: new and recent. */
const A = pool(1, 1_000n)
const B = pool(2, 100_000n)
const C = pool(3, 900_000n)
const D = pool(4, HEAD - 1_000n)

/** The block each position was last touched, and its current liquidity. */
const TOUCHES: Array<{ pool: PoolMeta; block: bigint; tokenId: bigint }> = [
  { pool: A, block: HEAD - 5_000n, tokenId: 1n },
  { pool: B, block: 200_000n, tokenId: 2n },
  { pool: B, block: 1_700_000n, tokenId: 3n },
  { pool: C, block: 950_000n, tokenId: 4n },
  { pool: D, block: HEAD - 500n, tokenId: 5n },
]

interface Read {
  pool: string
  fromBlock: bigint
  toBlock: bigint
}

/** A chain whose readPositions answers from TOUCHES; each read takes a minute on `clock`. */
function fakeChain(reads: Read[], clock: { ms: number }): ChainReader {
  return {
    getLatestBlock: async () => ({ number: HEAD, timestamp: 1_800_000_000 }),
    readPositions: async (p: PoolMeta, range: { fromBlock: bigint; toBlock: bigint }) => {
      reads.push({ pool: p.id, ...range })
      await Promise.resolve()
      clock.ms += 60_000
      return TOUCHES.filter(
        (t) => t.pool.id === p.id && t.block >= range.fromBlock && t.block <= range.toBlock,
      ).map(
        (t): Position => ({
          owner,
          tickLower: -10,
          tickUpper: 10,
          liquidity: 5n,
          tokenId: t.tokenId,
        }),
      )
    },
  } as unknown as ChainReader
}

const dbs: Database[] = []
afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
})

function setup() {
  const db = openDatabase(IN_MEMORY)
  dbs.push(db)
  db.pools.upsertMany([A, B, C, D])
  db.pools.setTracked([A.id, B.id, C.id, D.id], true)
  db.syncState.setBigInt(syncKeys.positions(A.id), HEAD - 10_000n)
  const reads: Read[] = []
  const clock = { ms: 0 }
  const ctx = createPipelineContext({ db, chain: fakeChain(reads, clock), config: loadConfig({}) })
  return { db, reads, clock, ctx }
}

const ids = (positions: readonly Position[]) => positions.map((p) => p.tokenId)
const rangesOf = (reads: readonly Read[], p: PoolMeta) =>
  reads.filter((r) => r.pool === p.id).map((r) => [r.fromBlock, r.toBlock])

describe('positionsStep with a window', () => {
  it('reads near pools to the head and far pools in shared windows from the oldest cursor', async () => {
    const { db, reads, ctx } = setup()
    const result = await positionsStep(ctx, { windowBlocks: WINDOW })
    expect(rangesOf(reads, A)).toEqual([[HEAD - 10_000n + 1n, HEAD]])
    expect(rangesOf(reads, D)).toEqual([[D.createdAtBlock, HEAD]])
    expect(rangesOf(reads, B)).toEqual([
      [100_000n, 599_999n],
      [600_000n, 1_099_999n],
      [1_100_000n, 1_599_999n],
      // Less than a window behind now: read to the head from its own cursor.
      [1_600_000n, HEAD],
    ])
    // C joins B's windows once they reach its creation block: same ranges, one log scan.
    expect(rangesOf(reads, C)).toEqual([
      [600_000n, 1_099_999n],
      [1_100_000n, 1_599_999n],
      [1_600_000n, HEAD],
    ])
    expect(result).toMatchObject({ deferred: 0, rounds: 5, positions: 5, failed: [] })
    expect(ids(db.positions.forPool(B.id))).toEqual([2n, 3n])
    expect(db.syncState.getBigInt(syncKeys.positions(B.id))).toBe(HEAD)
    expect(db.syncState.get(syncKeys.positionsCatchUp(B.id))).toBeUndefined()
    expect(db.positions.countForPool(positionsStagingId(B.id))).toBe(0)
  })

  it('keeps a first scan unpublished until it reaches the head, across budgeted runs', async () => {
    const { db, reads, clock, ctx } = setup()
    // Round 1 (A and D, in parallel) takes two minutes of the 2.5; round 2 (B alone) is the last.
    const first = await positionsStep(ctx, {
      windowBlocks: WINDOW,
      budgetMs: 150_000,
      clockMs: () => clock.ms,
    })
    expect(reads.map((r) => r.pool)).toEqual([A.id, D.id, B.id])
    expect(first).toMatchObject({ deferred: 2, rounds: 2, positions: 2 })
    // B's history so far is staged: the snapshot sees no positions for it yet.
    expect(db.syncState.getBigInt(syncKeys.positionsCatchUp(B.id))).toBe(599_999n)
    expect(db.syncState.get(syncKeys.positions(B.id))).toBeUndefined()
    expect(ids(db.positions.forPool(positionsStagingId(B.id)))).toEqual([2n])
    expect(storedPositions(db, B)).toBeNull()
    expect(ids(storedPositions(db, A) ?? [])).toEqual([1n])

    // `depthwatch positions` (no window) finishes it from the staged cursor and publishes.
    reads.length = 0
    const rest = await positionsStep(ctx)
    expect(rangesOf(reads, B)).toEqual([[600_000n, HEAD]])
    expect(rangesOf(reads, C)).toEqual([[C.createdAtBlock, HEAD]])
    expect(rest).toMatchObject({ deferred: 0, rounds: 1 })
    expect(ids(storedPositions(db, B) ?? [])).toEqual([2n, 3n])
    expect(db.positions.countForPool(positionsStagingId(B.id))).toBe(0)
    expect(db.syncState.get(syncKeys.positionsCatchUp(B.id))).toBeUndefined()
  })

  it('reads a mandated pool without positions to the head on its own range, however far', async () => {
    const { db, reads, clock, ctx } = setup()
    db.mandates.upsertMany([fixtureMandate({ id: 'mandate-c', poolId: C.id })])
    expect(unindexedMandatedPools(db).map((pool) => pool.id)).toEqual([C.id])
    // Round 1: A and D (near) with C (mandated, far): three minutes of the 2.5, so B waits.
    const result = await positionsStep(ctx, {
      windowBlocks: WINDOW,
      budgetMs: 150_000,
      clockMs: () => clock.ms,
    })
    expect(reads.map((r) => r.pool)).toEqual([A.id, C.id, D.id])
    expect(rangesOf(reads, C)).toEqual([[C.createdAtBlock, HEAD]])
    expect(result).toMatchObject({ deferred: 1, rounds: 1, positions: 3, failed: [] })
    // Published in one run: the next snapshot samples the mandate from these positions.
    expect(positionsPublished(db, C.id)).toBe(true)
    expect(ids(storedPositions(db, C) ?? [])).toEqual([4n])
    expect(db.positions.countForPool(positionsStagingId(C.id))).toBe(0)
    expect(unindexedMandatedPools(db)).toEqual([])
    expect(positionsPublished(db, B.id)).toBe(false)
  })

  it('starts the first pool whatever the budget, and no other once it is spent', async () => {
    const { reads, clock, ctx } = setup()
    const result = await positionsStep(ctx, {
      windowBlocks: WINDOW,
      budgetMs: 0,
      clockMs: () => clock.ms,
    })
    // The first pool starts; with no time left, nothing starts after it.
    expect(reads.map((r) => r.pool)).toEqual([A.id])
    expect(result).toMatchObject({ deferred: 3, rounds: 1, failed: [] })
  })
})
