/**
 * `snapshot`: one overview pass over every known pool → USD prices → TVL ranking → the top N
 * (plus explicitly requested pools) become *tracked* → full state per tracked pool → depth,
 * effective spread and concentration → one `snapshots` row per pool, written in one transaction
 * together with the rebuilt `prices` table.
 *
 * Uniswap v4 pools hold no reserves of their own (singleton PoolManager), so their TVL is unknown
 * (null) and they are ranked by the USD value of their ±2 % depth instead. A Uniswap v4 pool with a
 * hook is not modelled (docs/METRICS.md, `hooked`): it is not ranked (tracked only when requested
 * or mandated), its snapshot holds its price but no depth, spread or concentration, and it is no
 * price edge.
 *
 * Market-maker scorecards (docs/design/scorecards.md §5): pools with an active mandate are
 * always tracked, each gets one `MmSample` per active mandate right after its snapshot (same
 * state, prices and positions, stored in the same transaction), and webhook alerts are delivered
 * once the samples are stored. A mandate whose pool is unknown is logged and skipped; one whose
 * concentrated pool has no published positions yet is an attribution failure (mm.ts), not a
 * sample.
 *
 * Under `depthwatch start` the stop signal ends the state reads (no further pool starts) and
 * nothing is stored: a stop mid-snapshot leaves no partial snapshot in the history.
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  computeConcentration,
  computeConcentrationForReserves,
  computeDepth,
  computeEffectiveSpread,
  depthToUsd,
  isHookedPool,
  type Mandate,
  type MmSample,
  midPrice,
  type PoolMeta,
  type PoolSnapshot,
  type PoolState,
  type Position,
  priceDeviationBps,
  tvlUsd,
} from '@depthwatch/core'
import { errorMessage, type Logger } from '../log.js'
import { type AlertsResult, deliverAlerts } from './alerts.js'
import { type PipelineContext, settleConcurrent, syncKeys, throwIfStopped } from './context.js'
import { activeMandatesByPool, sampleMandates, storedPositions } from './mm.js'
import { storedCustodians } from './positions.js'
import {
  computePrices,
  depthUsdFor,
  type PoolPricing,
  type PriceMap,
  priceEntries,
  pricingFor,
  usdOf,
} from './prices.js'

export interface SnapshotOptions {
  topPools?: number
  /** Pool ids to track regardless of rank. Unknown ids are an error. */
  poolIds?: readonly string[]
  bandPct?: number
  concurrency?: number
}

export interface SnapshotResult {
  blockNumber: bigint
  timestamp: number
  /** Pools in the database (all got an overview). */
  pools: number
  tracked: number
  /** Snapshots stored: a pool already snapshotted at the block keeps that row. */
  snapshots: number
  prices: number
  /**
   * Market-maker samples stored (one per active mandate of a snapshotted pool, unless the mandate
   * was already sampled at the block).
   */
  samples: number
  /** Mandates whose attribution failed (logged; the snapshot itself is unaffected). */
  sampleFailures: number
  /** Webhook alerts attempted after the samples were stored. */
  alerts: number
  failed: Array<{ item: string; error: string }>
}

export interface RankedPool {
  view: PoolOverview
  pricing: PoolPricing
  tvlUsd: number | null
  /**
   * TVL when known, else the USD value of the ±2 % depth (Uniswap v4). Null for a hooked Uniswap
   * v4 pool: its depth is not modelled, so it is never ranked into the tracked set.
   */
  rankUsd: number | null
}

function reservesKnown(view: PoolOverview): boolean {
  return view.pool.dex !== 'uniswap-v4'
}

export function poolTvlUsd(view: PoolOverview, prices: PriceMap): number | null {
  if (!reservesKnown(view)) return null
  const { token0, token1 } = view.pool
  return tvlUsd(
    view.reserve0,
    view.reserve1,
    token0,
    token1,
    usdOf(prices, token0.address),
    usdOf(prices, token1.address),
  )
}

/** Pools ordered by rank (desc), unranked (unpriced or hooked) pools last, ties by id. */
export function rankPools(views: readonly PoolOverview[], prices: PriceMap): RankedPool[] {
  const ranked = views.map((view): RankedPool => {
    const pricing = pricingFor(view)
    const tvl = poolTvlUsd(view, prices)
    // A hooked pool's depth would be the swap walk's guess (docs/METRICS.md, `hooked`): no rank.
    const rankUsd = isHookedPool(view.pool) ? null : (tvl ?? depthUsdFor(pricing, prices))
    return { view, pricing, tvlUsd: tvl, rankUsd }
  })
  return ranked.sort((a, b) => {
    const x = a.rankUsd ?? -1
    const y = b.rankUsd ?? -1
    if (x !== y) return y - x
    return a.view.pool.id < b.view.pool.id ? -1 : 1
  })
}

/**
 * Top `topPools` ranked ids (with a positive rank) plus the explicitly requested ones (`--pool`
 * and mandated pools), which are tracked whatever their rank, a hooked pool included.
 */
export function selectTracked(
  ranked: readonly RankedPool[],
  topPools: number,
  explicit: readonly string[],
): string[] {
  const known = new Set(ranked.map((r) => r.view.pool.id))
  for (const id of explicit) {
    if (!known.has(id)) throw new Error(`unknown pool id "${id}" (run discover first)`)
  }
  const selected = new Set<string>(explicit)
  let taken = 0
  for (const entry of ranked) {
    if (taken >= topPools) break
    if (entry.rankUsd === null || entry.rankUsd <= 0) break
    selected.add(entry.view.pool.id)
    taken++
  }
  return [...selected].sort()
}

/**
 * One pool's snapshot. `custodians` (a Slipstream gauge, as `positions` recorded it) hold positions
 * for depositors: their weight counts as uncovered in the owner concentration.
 */
export function buildSnapshot(
  pool: PoolMeta,
  view: PoolOverview,
  state: PoolState,
  prices: PriceMap,
  positions: Position[] | null,
  bandPct: number,
  custodians: readonly string[] = [],
): PoolSnapshot {
  const { token0, token1 } = pool
  const price = midPrice(state, token0.decimals, token1.decimals)
  if (!Number.isFinite(price) || price <= 0) throw new Error('pool has no usable mid price')
  const token0Usd = usdOf(prices, token0.address)
  const token1Usd = usdOf(prices, token1.address)
  const base = {
    poolId: pool.id,
    blockNumber: state.blockNumber,
    timestamp: state.timestamp,
    price,
    token0Usd,
    token1Usd,
    tvlUsd: poolTvlUsd(view, prices),
    activeLiquidity: state.kind === 'concentrated' ? state.liquidity : 0n,
    priceDeviationBps: priceDeviationBps(price, token0Usd, token1Usd),
    feePips: state.feePips,
  }
  // The swap walk does not run a hook's code: no number is guessed for a hooked pool.
  if (isHookedPool(pool))
    return { ...base, depth: [], depthUsd: [], spreads: [], concentration: null }
  const depth = computeDepth(state, token0.decimals, token1.decimals)
  return {
    ...base,
    depth,
    depthUsd: depthToUsd(depth, token0, token1, token0Usd, token1Usd),
    spreads: computeEffectiveSpread(state, token0, token1, token0Usd, token1Usd),
    concentration:
      state.kind === 'concentrated'
        ? computeConcentration(state, positions, bandPct, custodians)
        : computeConcentrationForReserves(state, bandPct),
  }
}

/**
 * Pool ids of the active mandates, restricted to pools the database knows; a mandate on an
 * unknown pool (not discovered yet) is logged and skipped.
 */
export function mandatedPoolIds(
  mandates: readonly Mandate[],
  known: ReadonlySet<string>,
  log: Logger,
): string[] {
  const out: string[] = []
  for (const mandate of mandates) {
    if (!known.has(mandate.poolId)) {
      log.warn('mandate pool not in the database; skipped (run discover)', {
        mandate: mandate.id,
        pool: mandate.poolId,
      })
      continue
    }
    if (!out.includes(mandate.poolId)) out.push(mandate.poolId)
  }
  return out
}

export async function snapshotStep(
  ctx: PipelineContext,
  opts: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const { db, chain, log, config } = ctx
  const topPools = opts.topPools ?? config.topPools
  const explicit = opts.poolIds ?? config.poolIds
  const bandPct = opts.bandPct ?? config.bandPct
  const concurrency = opts.concurrency ?? config.concurrency

  const latest = await chain.getLatestBlock()
  const pools = db.pools.list()
  const result: SnapshotResult = {
    blockNumber: latest.number,
    timestamp: latest.timestamp,
    pools: pools.length,
    tracked: 0,
    snapshots: 0,
    prices: 0,
    samples: 0,
    sampleFailures: 0,
    alerts: 0,
    failed: [],
  }
  if (pools.length === 0) {
    log.warn('no pools in the database; run discover first')
    return result
  }
  const activeMandates = db.mandates.list({ active: true })
  const mandated = mandatedPoolIds(activeMandates, new Set(pools.map((p) => p.id)), log)

  log.info('reading overviews', { pools: pools.length, block: latest.number })
  const views = await chain.readOverview(pools, latest.number)
  const anchors = chain.addresses.stablecoinAnchors
  const wrappedNative: Address = chain.addresses.wrappedNative
  const firstPass = computePrices(views, anchors, { wrappedNative })
  log.info('derived prices from overviews', { tokens: firstPass.size })

  const ranked = rankPools(views, firstPass)
  const trackedIds = selectTracked(ranked, topPools, [...explicit, ...mandated])
  const trackedSet = new Set(trackedIds)
  db.transaction(() => {
    db.pools.setTracked(
      pools.map((p) => p.id),
      false,
    )
    db.pools.setTracked(trackedIds, true)
  })
  result.tracked = trackedIds.length
  log.info('selected tracked pools', {
    tracked: trackedIds.length,
    top: topPools,
    explicit: explicit.length,
    mandated: mandated.length,
  })

  const viewById = new Map(views.map((view) => [view.pool.id, view]))
  const trackedPools = pools.filter((p) => trackedSet.has(p.id))
  const states = await settleConcurrent(
    trackedPools,
    concurrency,
    (pool) => pool.id,
    async (pool) => ({
      pool,
      state: await chain.readState(pool, { bandPct, blockNumber: latest.number }),
    }),
    ctx.signal,
  )
  for (const failure of states.failed) {
    const error = errorMessage(failure.error)
    result.failed.push({ item: failure.item, error })
    log.warn('readState failed', { pool: failure.item, error })
  }
  const stateMap = new Map(states.ok.map((entry) => [entry.pool.id, entry.state]))
  const prices = computePrices(views, anchors, { states: stateMap, wrappedNative })

  const mandatesByPool = activeMandatesByPool(db, mandated)
  const snapshots: PoolSnapshot[] = []
  const samples: MmSample[] = []
  for (const { pool, state } of states.ok) {
    const view = viewById.get(pool.id)
    if (view === undefined) continue
    const positions = storedPositions(db, pool)
    const custodians = storedCustodians(db, pool.id)
    try {
      snapshots.push(buildSnapshot(pool, view, state, prices, positions, bandPct, custodians))
    } catch (error) {
      const message = errorMessage(error)
      result.failed.push({ item: pool.id, error: message })
      log.warn('metrics failed', { pool: pool.id, error: message })
      continue
    }
    const mandates = mandatesByPool.get(pool.id)
    if (mandates === undefined) continue
    samples.push(
      ...(await sampleMandates(ctx, {
        pool,
        state,
        prices,
        positions,
        blockNumber: state.blockNumber,
        timestamp: state.timestamp,
        mandates,
        onFailure: () => {
          result.sampleFailures++
        },
      })),
    )
  }

  throwIfStopped(ctx)
  const entries = priceEntries(prices)
  db.transaction(() => {
    result.snapshots = db.snapshots.insertMany(snapshots)
    result.samples = db.mmSamples.insertMany(samples)
    db.prices.replaceAll(entries, latest.timestamp)
    db.syncState.setBigInt(syncKeys.snapshot(), latest.number)
  })
  result.prices = entries.length
  log.info('stored snapshots', {
    snapshots: result.snapshots,
    samples: result.samples,
    sampleFailures: result.sampleFailures,
    prices: entries.length,
    failed: result.failed.length,
    block: latest.number,
  })
  if (samples.length > 0) {
    const sampled = new Set(samples.map((s) => s.mandateId))
    const alerts: AlertsResult = await deliverAlerts(
      ctx,
      activeMandates.filter((m) => sampled.has(m.id)),
    )
    result.alerts = alerts.attempts
  }
  return result
}
