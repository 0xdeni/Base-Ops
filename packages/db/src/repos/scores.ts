import {
  DEXES,
  type Dex,
  type GapMetrics,
  type HealthScore,
  type PersistenceMetrics,
  type PoolMeta,
} from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  type BindValue,
  colBigint,
  colBool,
  colJson,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  page,
  type Row,
} from '../sql.js'
import { type SnapshotSummary, spread10kFromStoredPoint } from '../summary.js'
import {
  POOL_SELECT,
  type PoolFilter,
  poolFilterClauses,
  rowToPoolMeta,
  whereSql,
} from './poolRow.js'
import { depth2SideSql, spread10kPointSql } from './snapshots.js'

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

export type ScoreUpsert = PoolScore

export type TopBySort = 'health' | 'gap' | 'depth' | 'volume' | 'tvl'
export type SortDir = 'asc' | 'desc'

export interface TopByOptions extends PoolFilter {
  /**
   * Defaults to 'desc'. Nulls sort last in both directions; sorting by health also puts unrated
   * pools after the rated ones in both directions.
   */
  dir?: SortDir
  /** True keeps only rated pools, false only unrated ones; both when undefined. */
  rated?: boolean
  /** Defaults to 50. */
  limit?: number
  offset?: number
  /** Keeps only pools with a known 24 h volume of at least this many USD. */
  minVolumeUsd?: number
}

export interface ScoredPoolRow {
  pool: PoolMeta
  tracked: boolean
  score: PoolScore
  /** Summary of the pool's newest snapshot; null when it has none. */
  latest: SnapshotSummary | null
}

export interface TopByResult {
  items: ScoredPoolRow[]
  /** Number of scored pools matching the filters, ignoring limit/offset. */
  total: number
}

export const DEFAULT_GAP_MIN_VOLUME_USD = 10_000
const DEFAULT_LIMIT = 50

export interface GapsOptions {
  /** Defaults to 50. */
  limit?: number
  offset?: number
  /** Defaults to DEFAULT_GAP_MIN_VOLUME_USD (10 000). */
  minVolumeUsd?: number
}

export interface DexStats {
  dex: Dex
  /** Pools discovered for the dex. */
  pools: number
  tracked: number
  /** Pools with a score row. */
  scored: number
  /** Scored pools that are rated (docs/METRICS.md, "Rated and unrated pools"). */
  rated: number
  depth2UsdSum: number
  /** Sum over scored pools with a known 24 h volume; null when none has one (unknown is not 0). */
  volume24hUsdSum: number | null
  /** Median health total over rated pools; null when none are rated. */
  medianHealth: number | null
}

const UPSERT = `INSERT INTO scores (
    pool_id, timestamp, health_json, gap_json, persistence_24h_json, persistence_7d_json,
    volume_24h_usd, depth2_usd, health_total, gap_score
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(pool_id) DO UPDATE SET
    timestamp = excluded.timestamp, health_json = excluded.health_json, gap_json = excluded.gap_json,
    persistence_24h_json = excluded.persistence_24h_json,
    persistence_7d_json = excluded.persistence_7d_json, volume_24h_usd = excluded.volume_24h_usd,
    depth2_usd = excluded.depth2_usd, health_total = excluded.health_total,
    gap_score = excluded.gap_score`

const SCORE_SELECT = `s.pool_id AS s_pool_id, s.timestamp AS s_timestamp,
  s.health_json AS s_health_json, s.gap_json AS s_gap_json,
  s.persistence_24h_json AS s_persistence_24h_json, s.persistence_7d_json AS s_persistence_7d_json,
  s.volume_24h_usd AS s_volume_24h_usd, s.depth2_usd AS s_depth2_usd`

const LATEST_SELECT = `sn.id AS sn_id, sn.block_number AS sn_block_number,
  sn.timestamp AS sn_timestamp, sn.price AS sn_price, sn.tvl_usd AS sn_tvl_usd,
  sn.depth2_usd AS sn_depth2_usd, ${spread10kPointSql('sn.spreads_json')} AS sn_spread10k_point,
  sn.owner_top1_share AS sn_owner_top1_share,
  ${depth2SideSql('sn.depth_usd_json', 'upUsd')} AS sn_depth2_up_usd,
  ${depth2SideSql('sn.depth_usd_json', 'downUsd')} AS sn_depth2_down_usd`

/**
 * Whether the stored score is rated: the flag lives in `health_json`. A row scored before ratings
 * existed has none and counts as unrated until `score` runs again.
 */
const RATED_SQL = `COALESCE(json_extract(s.health_json, '$.rated'), 0) = 1`

const SCORE_FROM = `scores s
  JOIN pools p ON p.id = s.pool_id
  JOIN tokens t0 ON t0.address = p.token0
  JOIN tokens t1 ON t1.address = p.token1`

const LATEST_JOIN = `LEFT JOIN snapshots sn ON sn.id = (
    SELECT x.id FROM snapshots x WHERE x.pool_id = s.pool_id ORDER BY x.timestamp DESC, x.id DESC LIMIT 1
  )`

const JOINED_SELECT = `SELECT ${POOL_SELECT}, ${SCORE_SELECT}, ${LATEST_SELECT} FROM ${SCORE_FROM} ${LATEST_JOIN}`

/** Whitelists: the only values ever interpolated into SQL. */
const SORT_COLUMNS: Readonly<Record<TopBySort, string>> = Object.freeze({
  health: 's.health_total',
  gap: 's.gap_score',
  depth: 's.depth2_usd',
  volume: 's.volume_24h_usd',
  tvl: 'sn.tvl_usd',
})
const DIRECTIONS: Readonly<Record<SortDir, string>> = Object.freeze({ asc: 'ASC', desc: 'DESC' })

/**
 * A health score as stored. One written before ratings existed has no `rated` flag: it reads as
 * unrated with no reason, and no grade, until the next `score` run replaces it.
 */
function readHealth(row: Row): HealthScore {
  const health = colJson<HealthScore>(row, 's_health_json')
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
  const price = colNumber(row, 'sn_price')
  return {
    poolId,
    blockNumber: colBigint(row, 'sn_block_number'),
    updatedAt: colNumber(row, 'sn_timestamp'),
    price,
    tvlUsd: colNumberOrNull(row, 'sn_tvl_usd'),
    depth2Usd: colNumberOrNull(row, 'sn_depth2_usd'),
    spread10kBps: spread10kFromStoredPoint(colTextOrNull(row, 'sn_spread10k_point'), price),
    ownerTop1Share: colNumberOrNull(row, 'sn_owner_top1_share'),
    depth2UpUsd: colNumberOrNull(row, 'sn_depth2_up_usd'),
    depth2DownUsd: colNumberOrNull(row, 'sn_depth2_down_usd'),
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

/** Median of an ascending list; null for an empty list. */
export function median(sorted: readonly number[]): number | null {
  const n = sorted.length
  if (n === 0) return null
  const mid = Math.floor(n / 2)
  const upper = sorted[mid]
  const lower = sorted[mid - 1]
  if (upper === undefined) return null
  if (n % 2 === 1 || lower === undefined) return upper
  return (lower + upper) / 2
}

export class ScoresRepo {
  constructor(private readonly ctx: SqlContext) {}

  upsert(score: ScoreUpsert): void {
    this.ctx.run(UPSERT, [
      score.poolId,
      score.timestamp,
      JSON.stringify(score.health),
      JSON.stringify(score.gap),
      JSON.stringify(score.persistence24h),
      JSON.stringify(score.persistence7d),
      score.volume24hUsd,
      score.depth2Usd,
      score.health.total,
      score.gap.gapScore,
    ])
  }

  upsertMany(scores: readonly ScoreUpsert[]): number {
    if (scores.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const score of scores) this.upsert(score)
      return scores.length
    })
  }

  get(poolId: string): PoolScore | undefined {
    const row = this.ctx.get(`SELECT ${SCORE_SELECT} FROM scores s WHERE s.pool_id = ?`, [poolId])
    return row ? rowToPoolScore(row) : undefined
  }

  /** Scored pool joined with its metadata and newest snapshot, or undefined when unscored. */
  getRow(poolId: string): ScoredPoolRow | undefined {
    const row = this.ctx.get(`${JOINED_SELECT} WHERE s.pool_id = ?`, [poolId])
    return row ? rowToScoredPool(row) : undefined
  }

  /** Ranked, filtered page of scored pools plus the unpaged match count. */
  topBy(sort: TopBySort, options: TopByOptions = {}): TopByResult {
    if (!Object.hasOwn(SORT_COLUMNS, sort)) throw new RangeError(`db: invalid sort "${sort}"`)
    const dir = options.dir ?? 'desc'
    if (!Object.hasOwn(DIRECTIONS, dir)) throw new RangeError(`db: invalid dir "${dir}"`)
    const column = SORT_COLUMNS[sort]
    const direction = DIRECTIONS[dir]
    const { clauses, params } = this.filterClauses(options)
    const [limit, offset] = page(options.limit, options.offset, DEFAULT_LIMIT)
    const where = whereSql(clauses)
    // Unrated pools follow the rated ones whichever way health is sorted: their totals are not
    // comparable with a grade.
    const unratedLast = sort === 'health' ? `CASE WHEN ${RATED_SQL} THEN 0 ELSE 1 END, ` : ''
    const items = this.ctx
      .all(
        `${JOINED_SELECT} ${where} ORDER BY ${unratedLast}${column} ${direction} NULLS LAST, s.pool_id ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )
      .map(rowToScoredPool)
    const countRow = this.ctx.get(`SELECT COUNT(*) AS n FROM ${SCORE_FROM} ${where}`, params)
    return { items, total: countRow ? colNumber(countRow, 'n') : 0 }
  }

  /** Liquidity gaps feed: real volume on thin depth, best gap score first. */
  gaps(options: GapsOptions = {}): ScoredPoolRow[] {
    const minVolumeUsd = options.minVolumeUsd ?? DEFAULT_GAP_MIN_VOLUME_USD
    const [limit, offset] = page(options.limit, options.offset, DEFAULT_LIMIT)
    return this.ctx
      .all(
        `${JOINED_SELECT} WHERE s.gap_score IS NOT NULL AND s.volume_24h_usd >= ?
          ORDER BY s.gap_score DESC, s.pool_id ASC LIMIT ? OFFSET ?`,
        [minVolumeUsd, limit, offset],
      )
      .map(rowToScoredPool)
  }

  /** Per-dex totals, in DEXES order (dexes without pools included with zeros). */
  statsByDex(): DexStats[] {
    const stats = new Map<string, DexStats>()
    const statsFor = (dex: string): DexStats => {
      let entry = stats.get(dex)
      if (!entry) {
        entry = {
          dex: dex as Dex,
          pools: 0,
          tracked: 0,
          scored: 0,
          rated: 0,
          depth2UsdSum: 0,
          volume24hUsdSum: null,
          medianHealth: null,
        }
        stats.set(dex, entry)
      }
      return entry
    }
    for (const dex of DEXES) statsFor(dex)

    const poolRows = this.ctx.all(
      'SELECT dex, COUNT(*) AS pools, COALESCE(SUM(tracked), 0) AS tracked FROM pools GROUP BY dex',
    )
    for (const row of poolRows) {
      const entry = statsFor(colText(row, 'dex'))
      entry.pools = colNumber(row, 'pools')
      entry.tracked = colNumber(row, 'tracked')
    }

    const healthByDex = new Map<string, number[]>()
    const scoreRows = this.ctx.all(
      `SELECT p.dex AS dex, s.health_total AS health, s.depth2_usd AS depth2,
          s.volume_24h_usd AS volume, ${RATED_SQL} AS rated
        FROM scores s JOIN pools p ON p.id = s.pool_id ORDER BY p.dex, s.health_total`,
    )
    for (const row of scoreRows) {
      const dex = colText(row, 'dex')
      const entry = statsFor(dex)
      entry.scored += 1
      entry.depth2UsdSum += colNumberOrNull(row, 'depth2') ?? 0
      // An unknown volume is not 0: the sum stays null until one pool has a known volume.
      const volume = colNumberOrNull(row, 'volume')
      if (volume !== null) entry.volume24hUsdSum = (entry.volume24hUsdSum ?? 0) + volume
      // The health median is over rated pools only: an unrated total is not a grade.
      if (colNumber(row, 'rated') !== 1) continue
      entry.rated += 1
      const totals = healthByDex.get(dex) ?? []
      totals.push(colNumber(row, 'health'))
      healthByDex.set(dex, totals)
    }
    for (const [dex, totals] of healthByDex) statsFor(dex).medianHealth = median(totals)

    const known = DEXES.map((dex) => statsFor(dex))
    const extra = [...stats.values()]
      .filter((entry) => !DEXES.includes(entry.dex))
      .sort((a, b) => a.dex.localeCompare(b.dex))
    return [...known, ...extra]
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM scores')
    return row ? colNumber(row, 'n') : 0
  }

  /** Median health total over rated pools (all DEXes); null when none is rated. */
  medianRatedHealth(): number | null {
    const rows = this.ctx.all(
      `SELECT s.health_total AS health FROM scores s WHERE ${RATED_SQL} ORDER BY s.health_total`,
    )
    return median(rows.map((row) => colNumber(row, 'health')))
  }

  delete(poolId: string): boolean {
    return this.ctx.run('DELETE FROM scores WHERE pool_id = ?', [poolId]).changes > 0
  }

  /**
   * Deletes the score rows of pools that are not tracked any more (or no longer exist), so the
   * feeds built on `scores` only ever show the current tracked set. Returns the rows removed.
   */
  deleteUntracked(): number {
    return this.ctx.run(
      'DELETE FROM scores WHERE pool_id NOT IN (SELECT id FROM pools WHERE tracked = 1)',
    ).changes
  }

  private filterClauses(options: TopByOptions): { clauses: string[]; params: BindValue[] } {
    const { clauses, params } = poolFilterClauses(options)
    if (options.minVolumeUsd !== undefined) {
      clauses.push('s.volume_24h_usd >= ?')
      params.push(options.minVolumeUsd)
    }
    if (options.rated !== undefined) clauses.push(options.rated ? RATED_SQL : `NOT (${RATED_SQL})`)
    return { clauses, params }
  }
}
