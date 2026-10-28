/**
 * Market-maker sampling (docs/design/scorecards.md §5): one `MmSample` per active mandate of a
 * pool, from the very same state, prices and stored positions the snapshot used.
 *
 * - Concentrated pools: the stored positions; on Slipstream, positions owned by the pool's CLGauge
 *   are resolved to their depositor (`resolveStakedOwners`, one read per pool for the addresses of
 *   every active mandate; when that read fails, one read per mandate) → `filterPositionsByOwners`
 *   → `buildMmConcentratedState`. A pool whose positions have never been published
 *   (`positionsPublished`, positions.ts: no `positions` run has reached the head for it) cannot be
 *   attributed at all: its mandates are attribution failures, not samples, so a mandate registered
 *   before its pool is indexed never records a false `noLiquidity` breach. An indexed pool with no
 *   stored positions means attribution method `none` (a breach by rule 1 of `evaluateKpis`). A
 *   mandate whose staked positions cannot be resolved is an attribution failure too: left with the
 *   gauge, they would read as missing liquidity. A hooked Uniswap v4 pool is not modelled
 *   (docs/METRICS.md, `hooked`): its mandates are attribution failures, never samples.
 * - Aerodrome v2: `readLpHoldings` at the sample block → `buildMmReserveState` (method `lp-share`).
 *
 * Then `computeMmAttribution` → `evaluateKpis` → the sample. A failing mandate is logged and
 * skipped; it never fails the snapshot. `mmSampleStep` runs the same hook on demand
 * (`depthwatch mm sample`): latest block, `readState`, stored positions, one sample per active
 * mandate of each mandated pool, no snapshot row.
 */
import {
  type Address,
  type AttributionInput,
  buildMmConcentratedState,
  buildMmReserveState,
  computeMmAttribution,
  type DerivedPrice,
  evaluateKpis,
  filterPositionsByOwners,
  isHookedPool,
  type LpHolding,
  lpShareOfPool,
  type Mandate,
  type MmSample,
  type PoolMeta,
  type PoolState,
  type Position,
  positionsShareOfPool,
} from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import { errorMessage } from '../log.js'
import { type AlertsResult, deliverAlerts } from './alerts.js'
import { type PipelineContext, settleConcurrent, throwIfStopped } from './context.js'
import { positionsPublished } from './positions.js'
import { type PriceMap, usdOf } from './prices.js'

export interface SampleInput {
  pool: PoolMeta
  /** Whole pool at the sample block (the snapshot's state). */
  state: PoolState
  prices: PriceMap
  /** Stored positions of a concentrated pool; null when it has none (see `storedPositions`). */
  positions: Position[] | null
  blockNumber: bigint
  timestamp: number
  /** The pool's active mandates, when the caller already loaded them (else queried here). */
  mandates?: readonly Mandate[]
  /** Called for every mandate whose attribution failed (the failure is also logged). */
  onFailure?: (mandateId: string, error: string) => void
}

/** What the market maker holds in the pool, before measuring it. */
export interface MmHoldings {
  method: MmSample['attribution']['method']
  /** Market-maker-only state; null without holdings. */
  mmState: PoolState | null
  /** Positions or LP holdings counted for the market maker. */
  holdings: number
  shareOfPool: number | null
}

/** Active mandates grouped by pool id, for the given pools only (pools without mandates absent). */
export function activeMandatesByPool(
  db: Database,
  poolIds: readonly string[],
): Map<string, Mandate[]> {
  const out = new Map<string, Mandate[]>()
  for (const [poolId, mandates] of db.mandates.forPools(poolIds)) {
    const active = mandates.filter((m) => m.active)
    if (active.length > 0) out.set(poolId, active)
  }
  return out
}

/** The `prices` table as the PriceMap the sampler expects (edge weights are not stored: 0). */
export function storedPriceMap(db: Database): PriceMap {
  const out: PriceMap = new Map<Address, DerivedPrice>()
  for (const [token, entry] of db.prices.all())
    out.set(token, { usd: entry.usd, via: entry.via, weight: 0 })
  return out
}

/**
 * Stored positions of a concentrated pool, null when there are none (as the snapshot uses). Null
 * also while the pool's positions are not published yet; `sampleMandates` tells the two apart.
 */
export function storedPositions(db: Database, pool: PoolMeta): Position[] | null {
  if (pool.kind !== 'concentrated') return null
  const positions = db.positions.forPool(pool.id)
  return positions.length === 0 ? null : positions
}

/**
 * Positions of a Slipstream pool with gauge-staked positions rewritten to their depositor among
 * `candidates` (the addresses of every mandate of the pool). Other DEXes: the positions as given.
 */
export async function resolvePositionOwners(
  ctx: PipelineContext,
  pool: PoolMeta,
  positions: readonly Position[],
  candidates: readonly Address[],
  blockNumber: bigint,
): Promise<Position[]> {
  if (pool.dex !== 'aerodrome-slipstream' || positions.length === 0 || candidates.length === 0)
    return [...positions]
  return ctx.chain.resolveStakedOwners(pool, positions, candidates, blockNumber)
}

/** Concentrated attribution: the mandate's positions only (owners already resolved). */
export function concentratedHoldings(
  state: PoolState,
  positions: readonly Position[] | null,
  mandate: Mandate,
): MmHoldings {
  if (state.kind !== 'concentrated') throw new Error(`${mandate.poolId}: not a concentrated state`)
  if (positions === null) return { method: 'none', mmState: null, holdings: 0, shareOfPool: null }
  const mine = filterPositionsByOwners(positions, mandate.addresses)
  const shareOfPool = positionsShareOfPool(state, mine, mandate.kpis.bandPct)
  if (mine.length === 0) return { method: 'positions', mmState: null, holdings: 0, shareOfPool }
  return {
    method: 'positions',
    mmState: buildMmConcentratedState(state, mine),
    holdings: mine.length,
    shareOfPool,
  }
}

/** Aerodrome v2 attribution: reserves scaled by the mandate's share of the LP supply. */
export function lpShareHoldings(state: PoolState, holdings: readonly LpHolding[]): MmHoldings {
  if (state.kind === 'concentrated') throw new Error('lp-share attribution needs a reserve state')
  const counted = holdings.filter((h) => h.balance + h.staked > 0n).length
  const shareOfPool = lpShareOfPool(holdings)
  if (counted === 0 || shareOfPool === null || shareOfPool <= 0)
    return { method: 'lp-share', mmState: null, holdings: 0, shareOfPool }
  return {
    method: 'lp-share',
    mmState: buildMmReserveState(state, holdings),
    holdings: counted,
    shareOfPool,
  }
}

async function holdingsFor(
  ctx: PipelineContext,
  mandate: Mandate,
  input: SampleInput,
  resolved: readonly Position[] | null,
): Promise<MmHoldings> {
  const { pool, state } = input
  if (pool.kind === 'concentrated') return concentratedHoldings(state, resolved, mandate)
  if (pool.dex === 'aerodrome-v2') {
    const holdings = await ctx.chain.readLpHoldings(pool, mandate.addresses, input.blockNumber)
    return lpShareHoldings(state, holdings)
  }
  return { method: 'none', mmState: null, holdings: 0, shareOfPool: null }
}

/** One sample for one mandate. Throws on an attribution failure (callers decide what to do). */
export async function sampleMandate(
  ctx: PipelineContext,
  mandate: Mandate,
  input: SampleInput,
  resolved: readonly Position[] | null = input.positions,
): Promise<MmSample> {
  const { pool, state, prices } = input
  const held = await holdingsFor(ctx, mandate, input, resolved)
  const attributionInput: AttributionInput = {
    token0: pool.token0,
    token1: pool.token1,
    token0Usd: usdOf(prices, pool.token0.address),
    token1Usd: usdOf(prices, pool.token1.address),
    state,
    mmState: held.mmState,
    method: held.method,
    holdings: held.holdings,
    shareOfPool: held.shareOfPool,
    kpis: mandate.kpis,
  }
  const attribution = computeMmAttribution(attributionInput)
  const { withinKpi, breaches } = evaluateKpis(attribution, mandate.kpis)
  return {
    mandateId: mandate.id,
    poolId: pool.id,
    blockNumber: input.blockNumber,
    timestamp: input.timestamp,
    attribution,
    withinKpi,
    breaches,
  }
}

/**
 * How each mandate's view of the stored positions is obtained (owners resolved). On Slipstream,
 * gauge-staked positions are resolved once for the addresses of every mandate (first matching
 * depositor wins, so the union of the candidates yields the same owners as one call per mandate).
 * When that read fails, each mandate resolves its own addresses instead, so a failure (a transient
 * RPC error, or a candidate the node cannot answer for) only concerns the mandates it reaches; the
 * returned function then rejects for those, and the caller treats that as their attribution
 * failure rather than sampling them with their staked liquidity missing.
 */
async function positionsResolver(
  ctx: PipelineContext,
  input: SampleInput,
  mandates: readonly Mandate[],
): Promise<(mandate: Mandate) => Promise<Position[] | null>> {
  const { pool, positions, blockNumber } = input
  if (positions === null || pool.dex !== 'aerodrome-slipstream') return async () => positions
  const candidates = [...new Set(mandates.flatMap((m) => m.addresses))]
  try {
    const resolved = await resolvePositionOwners(ctx, pool, positions, candidates, blockNumber)
    return async () => resolved
  } catch (error) {
    ctx.log.warn('resolveStakedOwners failed for the pool; resolving per mandate', {
      pool: pool.id,
      mandates: mandates.length,
      error: errorMessage(error),
    })
    return async (mandate) => {
      try {
        return await resolvePositionOwners(ctx, pool, positions, mandate.addresses, blockNumber)
      } catch (cause) {
        throw new Error('resolveStakedOwners failed', { cause })
      }
    }
  }
}

/** The attribution failure of every mandate of a concentrated pool with no positions published. */
export const POSITIONS_NOT_INDEXED = 'positions not indexed yet'
/** The attribution failure of every mandate of a hooked Uniswap v4 pool (docs/METRICS.md). */
export const HOOKED_NOT_MODELLED = 'hooked pool: not modelled'

/**
 * One sample per active mandate of `input.pool`. A mandate whose attribution fails (its LP
 * holdings or, on Slipstream, its gauge-staked positions cannot be read, its concentrated pool's
 * positions are not published yet, or its pool has a Uniswap v4 hook, whose swap code the depth
 * and spread walk would only guess at) is logged (and reported through `onFailure`) and left out;
 * the others still get their sample.
 */
export async function sampleMandates(
  ctx: PipelineContext,
  input: SampleInput,
): Promise<MmSample[]> {
  const { log } = ctx
  const mandates = input.mandates ?? ctx.db.mandates.list({ active: true, poolId: input.pool.id })
  if (mandates.length === 0) return []
  if (isHookedPool(input.pool)) {
    log.warn('hooked pool is not modelled; mandates not sampled', {
      pool: input.pool.id,
      mandates: mandates.map((m) => m.id),
    })
    for (const mandate of mandates) input.onFailure?.(mandate.id, HOOKED_NOT_MODELLED)
    return []
  }
  if (input.pool.kind === 'concentrated' && !positionsPublished(ctx.db, input.pool.id)) {
    log.warn('positions not indexed yet; mandates not sampled (run positions)', {
      pool: input.pool.id,
      mandates: mandates.map((m) => m.id),
    })
    for (const mandate of mandates) input.onFailure?.(mandate.id, POSITIONS_NOT_INDEXED)
    return []
  }
  const positionsFor = await positionsResolver(ctx, input, mandates)
  const samples: MmSample[] = []
  for (const mandate of mandates) {
    try {
      const sample = await sampleMandate(ctx, mandate, input, await positionsFor(mandate))
      samples.push(sample)
      log.debug('sampled mandate', {
        mandate: mandate.id,
        pool: input.pool.id,
        withinKpi: sample.withinKpi,
        breaches: sample.breaches,
      })
    } catch (error) {
      const message = errorMessage(error)
      log.warn('attribution failed', { mandate: mandate.id, pool: input.pool.id, error: message })
      input.onFailure?.(mandate.id, message)
    }
  }
  return samples
}

export interface MmSampleResult {
  blockNumber: bigint
  timestamp: number
  /** Active mandates in the database. */
  mandates: number
  /** Pools sampled (every active mandate's pool that the database knows). */
  pools: number
  /** Samples stored: a mandate already sampled at the block keeps that sample. */
  samples: number
  /** Mandates (and pools) whose state read or attribution failed. */
  failed: Array<{ item: string; error: string }>
  alerts: AlertsResult
}

/**
 * `depthwatch mm sample`: every active mandate of every known pool, against the latest block,
 * with the pool state read now, the stored positions and the stored prices. Samples are inserted
 * and alerts delivered exactly as the snapshot hook does, without writing a snapshot row.
 */
export async function mmSampleStep(ctx: PipelineContext): Promise<MmSampleResult> {
  const { db, chain, log, config } = ctx
  const latest = await chain.getLatestBlock()
  const active = db.mandates.list({ active: true })
  const byPool = activeMandatesByPool(db, [...new Set(active.map((m) => m.poolId))])
  const result: MmSampleResult = {
    blockNumber: latest.number,
    timestamp: latest.timestamp,
    mandates: active.length,
    pools: 0,
    samples: 0,
    failed: [],
    alerts: { mandates: 0, attempts: 0, delivered: 0, alerts: [] },
  }
  if (active.length === 0) {
    log.warn('no active mandates; run mm register first')
    return result
  }
  const pools: PoolMeta[] = []
  for (const poolId of byPool.keys()) {
    const pool = db.pools.get(poolId)
    if (pool === undefined) {
      const ids = (byPool.get(poolId) ?? []).map((m) => m.id)
      log.warn('mandate pool not in the database; run discover first', {
        pool: poolId,
        mandates: ids,
      })
      for (const id of ids) result.failed.push({ item: id, error: `unknown pool "${poolId}"` })
      continue
    }
    pools.push(pool)
  }
  result.pools = pools.length
  const prices = storedPriceMap(db)
  log.info('sampling mandates', {
    pools: pools.length,
    mandates: active.length,
    block: latest.number,
    prices: prices.size,
  })
  const settled = await settleConcurrent(
    pools,
    config.concurrency,
    (pool) => pool.id,
    async (pool) => {
      const state = await chain.readState(pool, {
        bandPct: config.bandPct,
        blockNumber: latest.number,
      })
      return sampleMandates(ctx, {
        pool,
        state,
        prices,
        positions: storedPositions(db, pool),
        blockNumber: state.blockNumber,
        timestamp: state.timestamp,
        mandates: byPool.get(pool.id) ?? [],
        onFailure: (mandateId, error) => result.failed.push({ item: mandateId, error }),
      })
    },
    ctx.signal,
  )
  for (const failure of settled.failed) {
    const error = errorMessage(failure.error)
    result.failed.push({ item: failure.item, error })
    log.warn('readState failed', { pool: failure.item, error })
  }
  const samples = settled.ok.flat()
  throwIfStopped(ctx)
  result.samples = db.mmSamples.insertMany(samples)
  log.info('stored samples', { samples: result.samples, failed: result.failed.length })
  const sampled = new Set(samples.map((s) => s.mandateId))
  result.alerts = await deliverAlerts(
    ctx,
    active.filter((m) => sampled.has(m.id)),
  )
  return result
}
