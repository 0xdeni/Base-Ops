/**
 * The handful of per-snapshot numbers the dashboard sorts and lists by. The sortable ones are
 * derived from the JSON metric columns at insert time and stored denormalised on `snapshots`; the
 * two sides of the ±2 % level and the $10,000 spread are read from the stored `depth_usd_json`
 * ladder and `spreads_json` when listed, so a spread stored before the price impact cap reads
 * under today's rule.
 */
import { feasibleSpreadBps, type PoolSnapshot, type SpreadPoint } from '@depthwatch/core'

export interface SnapshotSummaryFields {
  /** `depthUsd[pct = 2].totalUsd` */
  depth2Usd: number | null
  /**
   * `spreads[notionalUsd = 10 000].spreadBps`; null when infeasible, including a spread stored
   * before the price impact cap whose legs are above it (docs/METRICS.md, "Effective spread").
   */
  spread10kBps: number | null
  /** `concentration.owners.top1Share` */
  ownerTop1Share: number | null
}

/**
 * The sides of the ±2 % level, exactly as core stored them: null when that side's token has no
 * USD price or the snapshot has no ±2 % level. Not denormalised, since nothing sorts by them.
 */
export interface SnapshotDepthSides {
  /** `depthUsd[pct = 2].upUsd`: token1 (USD) that lifts the price 2 %. */
  depth2UpUsd: number | null
  /** `depthUsd[pct = 2].downUsd`: token0 (USD) that pushes the price down 2 %. */
  depth2DownUsd: number | null
}

/** Latest-snapshot summary as stored alongside scores and token pool lists. */
export interface SnapshotSummary extends SnapshotSummaryFields, SnapshotDepthSides {
  poolId: string
  blockNumber: bigint
  /** Snapshot timestamp (unix seconds). */
  updatedAt: number
  price: number
  tvlUsd: number | null
  /** `PoolSnapshot.priceDeviationBps`: null when unknown (or stored before the column existed). */
  priceDeviationBps: number | null
}

export const SUMMARY_DEPTH_PCT = 2
export const SUMMARY_SPREAD_NOTIONAL_USD = 10_000

export function snapshotSummaryFields(snapshot: PoolSnapshot): SnapshotSummaryFields {
  const depth2 = snapshot.depthUsd.find((level) => level.pct === SUMMARY_DEPTH_PCT)
  const spread10k = snapshot.spreads.find(
    (point) => point.notionalUsd === SUMMARY_SPREAD_NOTIONAL_USD,
  )
  return {
    depth2Usd: depth2?.totalUsd ?? null,
    spread10kBps: feasibleSpreadBps(spread10k, snapshot.price),
    ownerTop1Share: snapshot.concentration?.owners?.top1Share ?? null,
  }
}

/**
 * A stored spread point under today's price impact cap. A point stored before the cap existed can
 * be a "feasible" 1e24 bps on a dust pool; read back it is the infeasible point of its notional, as
 * if it had been computed today. `mid` is the snapshot's price. Points already infeasible, and
 * feasible ones within the cap, are returned as stored.
 */
export function capSpreadPoint(point: SpreadPoint, mid: number): SpreadPoint {
  if (!point.feasible || feasibleSpreadBps(point, mid) !== null) return point
  return {
    notionalUsd: point.notionalUsd,
    spreadBps: null,
    feasible: false,
    buyAvgPrice: null,
    sellAvgPrice: null,
  }
}

/**
 * The $10,000 spread of a snapshot from its stored point as JSON text (null when the snapshot has
 * no such point), under today's cap. The denormalised `spread10k_bps` column is written at insert
 * and never read back, because a row inserted before the cap holds the uncapped number.
 */
export function spread10kFromStoredPoint(pointJson: string | null, mid: number): number | null {
  if (pointJson === null) return null
  return feasibleSpreadBps(JSON.parse(pointJson) as SpreadPoint, mid)
}

export function snapshotDepthSides(snapshot: PoolSnapshot): SnapshotDepthSides {
  const depth2 = snapshot.depthUsd.find((level) => level.pct === SUMMARY_DEPTH_PCT)
  return { depth2UpUsd: depth2?.upUsd ?? null, depth2DownUsd: depth2?.downUsd ?? null }
}

export function snapshotSummary(snapshot: PoolSnapshot): SnapshotSummary {
  return {
    poolId: snapshot.poolId,
    blockNumber: snapshot.blockNumber,
    updatedAt: snapshot.timestamp,
    price: snapshot.price,
    tvlUsd: snapshot.tvlUsd,
    priceDeviationBps: snapshot.priceDeviationBps,
    ...snapshotSummaryFields(snapshot),
    ...snapshotDepthSides(snapshot),
  }
}
