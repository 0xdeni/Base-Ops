/**
 * `positions`: LP positions of every tracked concentrated pool, for owner concentration, and of
 * every concentrated pool with an active mandate, for market-maker attribution. Mandated pools are
 * indexed whether or not they are tracked yet: the snapshot tracks them whatever their rank, and
 * its samples read these positions, so a mandate registered since the last snapshot must not be
 * sampled without them (method `none`, a false `noLiquidity` breach).
 *
 * `readPositions` is range based (positions *touched* in the block range, with their current
 * liquidity and owner), so the first run scans from the pool's creation block and later runs
 * continue from the cursor `positions:<pool>:lastBlock`, merging into the stored set. Positions
 * whose liquidity dropped to zero are removed. Aerodrome v2 pools have no positions.
 *
 * A logs endpoint that cannot serve the configured chunk (LogRangeLimitError) fails every pool the
 * same way, so after the first one no further pool is started and the step throws that one error:
 * only the pools already in flight (`concurrency`) send a request.
 */
import { isLogRangeLimitError } from '@depthwatch/chain'
import type { PoolMeta, Position } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { errorMessage } from '../log.js'
import { type PipelineContext, settleConcurrent, syncKeys } from './context.js'

export interface PositionsPoolResult {
  poolId: string
  fromBlock: bigint
  toBlock: bigint
  /** Positions touched in the range. */
  touched: number
  /** Positions stored after the merge. */
  stored: number
  skipped: boolean
}

export interface PositionsResult {
  blockNumber: bigint
  pools: PositionsPoolResult[]
  positions: number
  failed: Array<{ item: string; error: string }>
}

/** Stable identity of a position: the NFT id, or (owner, range) for positions without one. */
export function positionKey(position: Position): string {
  if (position.tokenId !== null) return `id:${position.tokenId}`
  return `anon:${position.owner.toLowerCase()}:${position.tickLower}:${position.tickUpper}`
}

/** `fresh` overrides `existing` by key; closed positions (liquidity 0) are dropped. */
export function mergePositions(
  existing: readonly Position[],
  fresh: readonly Position[],
): Position[] {
  const merged = new Map<string, Position>()
  for (const position of existing) merged.set(positionKey(position), position)
  for (const position of fresh) merged.set(positionKey(position), position)
  return [...merged.entries()]
    .filter(([, position]) => position.liquidity > 0n)
    .sort(([ka, a], [kb, b]) => {
      if (a.tickLower !== b.tickLower) return a.tickLower - b.tickLower
      if (a.tickUpper !== b.tickUpper) return a.tickUpper - b.tickUpper
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    .map(([, position]) => position)
}

export interface PositionsOptions {
  /** Pools to index instead of the default ones (non-concentrated pools are ignored). */
  pools?: readonly PoolMeta[]
}

/**
 * The pools `positions` indexes by default: the tracked ones, then the known pools of active
 * mandates that are not tracked (yet). A mandate on a pool not discovered yet adds nothing; the
 * snapshot logs it.
 */
export function defaultPositionPools(db: Database): PoolMeta[] {
  const pools = db.pools.list({ tracked: true })
  const ids = new Set(pools.map((pool) => pool.id))
  for (const mandate of db.mandates.list({ active: true })) {
    if (ids.has(mandate.poolId)) continue
    const pool = db.pools.get(mandate.poolId)
    if (pool === undefined) continue
    ids.add(pool.id)
    pools.push(pool)
  }
  return pools
}

export async function positionsStep(
  ctx: PipelineContext,
  opts: PositionsOptions = {},
): Promise<PositionsResult> {
  const { db, chain, log, config } = ctx
  const latest = await chain.getLatestBlock()
  const candidates = opts.pools ?? defaultPositionPools(db)
  const pools = candidates.filter((pool) => pool.kind === 'concentrated')
  const result: PositionsResult = {
    blockNumber: latest.number,
    pools: [],
    positions: 0,
    failed: [],
  }
  if (pools.length === 0) {
    log.warn('no tracked or mandated concentrated pools; run snapshot first')
    return result
  }
  log.info('reading positions', { pools: pools.length, block: latest.number })

  let unusable: unknown
  const settled = await settleConcurrent(
    pools,
    config.concurrency,
    (pool) => pool.id,
    async (pool): Promise<PositionsPoolResult> => {
      if (unusable !== undefined) throw unusable
      const key = syncKeys.positions(pool.id)
      const cursor = db.syncState.getBigInt(key)
      const fromBlock = cursor === undefined ? pool.createdAtBlock : cursor + 1n
      const toBlock = latest.number
      if (fromBlock > toBlock) {
        const stored = db.positions.countForPool(pool.id)
        return { poolId: pool.id, fromBlock, toBlock, touched: 0, stored, skipped: true }
      }
      const fresh = await chain.readPositions(pool, { fromBlock, toBlock }).catch((error) => {
        if (isLogRangeLimitError(error)) unusable ??= error
        throw error
      })
      const existing = cursor === undefined ? [] : db.positions.forPool(pool.id)
      const merged = mergePositions(existing, fresh)
      db.transaction(() => {
        db.positions.replaceForPool(pool.id, merged, { updatedBlock: toBlock })
        db.syncState.setBigInt(key, toBlock)
      })
      log.debug('positions merged', { pool: pool.id, touched: fresh.length, stored: merged.length })
      return {
        poolId: pool.id,
        fromBlock,
        toBlock,
        touched: fresh.length,
        stored: merged.length,
        skipped: false,
      }
    },
  )

  // An endpoint that only serves tiny log ranges fails every pool the same way: one error, not N.
  if (unusable !== undefined) throw unusable
  result.pools = settled.ok
  result.positions = settled.ok.reduce((n, entry) => n + entry.stored, 0)
  for (const failure of settled.failed) {
    const error = errorMessage(failure.error)
    result.failed.push({ item: failure.item, error })
    log.warn('readPositions failed', { pool: failure.item, error })
  }
  log.info('stored positions', {
    pools: settled.ok.length,
    positions: result.positions,
    failed: result.failed.length,
  })
  return result
}
