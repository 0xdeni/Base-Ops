/**
 * SQL fragments, sort whitelist and row mappers of the score feeds: a score joined with its pool,
 * the pool's tokens and its newest snapshot. ScoresRepo builds every feed query from these, so a
 * listed value and the value a feed orders by are read by the same SQL.
 */
import type { GapMetrics, HealthScore, PersistenceMetrics, PoolMeta } from '@depthwatch/core'
import {
  colBigint,
  colBool,
  colJson,
  colNumber,
  colNumberOrNull,
  colText,
  type Row,
} from '../sql.js'
import type { SnapshotSummary } from '../summary.js'
import { POOL_SELECT, rowToPoolMeta } from './poolRow.js'
import { LATEST_JOIN } from './scoreStats.js'
import { depth2SideSql, spread10kSql } from './snapshots.js'

export interface PoolScore {
  poolId: string
  /** When the score was computed (unix seconds). */
  timestamp: number
  health: HealthScore
  gap: GapMetrics
  persistence24h: PersistenceMetrics
  persistence7d: PersistenceMetrics
  volume24hUsd: number | null
  depth2Usd: number | null
}

export interface ScoredPoolRow {
  pool: PoolMeta
  tracked: boolean
  score: PoolScore
  /** Summary of the pool's newest snapshot; null when it has none. */
  latest: SnapshotSummary | null
}

/**
 * Sort keys of the score feeds: health total, ±2 % depth, 24 h volume, gap score, TVL, and the
 * newest snapshot's $10,000 spread (`spread`) and top owner share (`top`).
 */
export type TopBySort = 'health' | 'gap' | 'depth' | 'volume' | 'tvl' | 'spread' | 'top'
export type SortDir = 'asc' | 'desc'

export const SCORE_SELECT = `s.pool_id AS s_pool_id, s.timestamp AS s_timestamp,
  s.health_json AS s_health_json, s.gap_json AS s_gap_json,
  s.persistence_24h_json AS s_persistence_24h_json, s.persistence_7d_json AS s_persistence_7d_json,
  s.volume_24h_usd AS s_volume_24h_usd, s.depth2_usd AS s_depth2_usd`

const LATEST_SELECT = `sn.id AS sn_id, sn.block_number AS sn_block_number,
  sn.timestamp AS sn_timestamp, sn.price AS sn_price, sn.tvl_usd AS sn_tvl_usd,
  sn.depth2_usd AS sn_depth2_usd, ${spread10kSql('sn.spreads_json', 'sn.price')} AS sn_spread10k_bps,
  sn.owner_top1_share AS sn_owner_top1_share,
  ${depth2SideSql('sn.depth_usd_json', 'upUsd')} AS sn_depth2_up_usd,
  ${depth2SideSql('sn.depth_usd_json', 'downUsd')} AS sn_depth2_down_usd,
  sn.price_deviation_bps AS sn_price_deviation_bps`

/**
 * `CROSS JOIN` pins the scored set as the outer loop. Without planner statistics SQLite would
 * otherwise start from `pools` for a count or a filtered page: every discovered pool (a full
 * factory scan finds a hundred thousand) scanned for a few hundred scores.
 */
export const SCORE_FROM = `scores s
  CROSS JOIN pools p ON p.id = s.pool_id
  JOIN tokens t0 ON t0.address = p.token0
  JOIN tokens t1 ON t1.address = p.token1`

export const JOINED_SELECT = `SELECT ${POOL_SELECT}, ${SCORE_SELECT}, ${LATEST_SELECT} FROM ${SCORE_FROM} ${LATEST_JOIN}`

/**
 * Whitelists: the only values ever interpolated into SQL. `spread` orders by the selected
 * `sn_spread10k_bps`, the very value a row lists, under core's price impact cap.
 */
export const SORT_COLUMNS: Readonly<Record<TopBySort, string>> = Object.freeze({
  health: 's.health_total',
  gap: 's.gap_score',
  depth: 's.depth2_usd',
  volume: 's.volume_24h_usd',
  tvl: 'sn.tvl_usd',
  spread: 'sn_spread10k_bps',
  top: 'sn.owner_top1_share',
})
export const DIRECTIONS: Readonly<Record<SortDir, string>> = Object.freeze({
  asc: 'ASC',
  desc: 'DESC',
})

/**
 * A health score as stored. One written before ratings existed has no `rated` flag: it reads as
 * unrated with no reason, and no grade, until the next `score` run replaces it. One written before
 * the concentration basis was recorded reads `concentrationBasis: null` until then.
 */
function readHealth(row: Row): HealthScore {
  const stored = colJson<HealthScore>(row, 's_health_json')
  const health = { ...stored, concentrationBasis: stored.concentrationBasis ?? null }
  if (typeof health.rated === 'boolean') return health
  return { ...health, grade: null, rated: false, unratedReason: null }
}

export function rowToPoolScore(row: Row): PoolScore {
  return {
    poolId: colText(row, 's_pool_id'),
    timestamp: colNumber(row, 's_timestamp'),
    health: readHealth(row),
    gap: colJson<GapMetrics>(row, 's_gap_json'),
    persistence24h: colJson<PersistenceMetrics>(row, 's_persistence_24h_json'),
    persistence7d: colJson<PersistenceMetrics>(row, 's_persistence_7d_json'),
    volume24hUsd: colNumberOrNull(row, 's_volume_24h_usd'),
    depth2Usd: colNumberOrNull(row, 's_depth2_usd'),
  }
}

function rowToLatest(row: Row, poolId: string): SnapshotSummary | null {
  if (colNumberOrNull(row, 'sn_id') === null) return null
  return {
    poolId,
    blockNumber: colBigint(row, 'sn_block_number'),
    updatedAt: colNumber(row, 'sn_timestamp'),
    price: colNumber(row, 'sn_price'),
    tvlUsd: colNumberOrNull(row, 'sn_tvl_usd'),
    depth2Usd: colNumberOrNull(row, 'sn_depth2_usd'),
    spread10kBps: colNumberOrNull(row, 'sn_spread10k_bps'),
    ownerTop1Share: colNumberOrNull(row, 'sn_owner_top1_share'),
    depth2UpUsd: colNumberOrNull(row, 'sn_depth2_up_usd'),
    depth2DownUsd: colNumberOrNull(row, 'sn_depth2_down_usd'),
    priceDeviationBps: colNumberOrNull(row, 'sn_price_deviation_bps'),
  }
}

export function rowToScoredPool(row: Row): ScoredPoolRow {
  const pool = rowToPoolMeta(row)
  return {
    pool,
    tracked: colBool(row, 'p_tracked'),
    score: rowToPoolScore(row),
    latest: rowToLatest(row, pool.id),
  }
}
