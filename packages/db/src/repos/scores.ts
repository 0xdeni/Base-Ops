import { type Address, DEXES, type Dex, MEANINGFUL_GAP_TURNOVER } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { type BindValue, colNumber, colNumberOrNull, colText, page } from '../sql.js'
import { type PoolFilter, poolFilterClauses, whereSql } from './poolRow.js'
import {
  DIRECTIONS,
  JOINED_SELECT,
  LATEST_JOIN,
  type PoolScore,
  RATED_SQL,
  rowToPoolScore,
  rowToScoredPool,
  SCORE_FROM,
  SCORE_SELECT,
  type ScoredPoolRow,
  SORT_COLUMNS,
  type SortDir,
  type TopBySort,
} from './scoreRow.js'

export type { PoolScore, ScoredPoolRow, SortDir, TopBySort } from './scoreRow.js'

export type ScoreUpsert = PoolScore

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

/** The whole gaps feed at one floor, counted (docs/METRICS.md, "Gap score and the gaps feed"). */
export interface GapCounts {
  /** Pools in the feed. */
  total: number
  /** Feed pools with a turnover of at least MEANINGFUL_GAP_TURNOVER (3×). */
  meaningful: number
}

/** A token's ±2 % depth over every scored pool containing it (docs/METRICS.md, "A token's depth"). */
export interface TokenDepth {
  /** Sum of the pools' known `depth2Usd`; null when none is known (unknown is not 0). */
  depth2UsdTotal: number | null
  /** Pools whose depth is known: the ones the sum covers. */
  depthKnownPools: number
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

  /** Counts of the whole gaps feed at `minVolumeUsd`: the rows `gaps` pages through. */
  gapCounts(minVolumeUsd: number = DEFAULT_GAP_MIN_VOLUME_USD): GapCounts {
    const row = this.ctx.get(
      `SELECT COUNT(*) AS total,
          COALESCE(SUM(json_extract(s.gap_json, '$.turnoverRatio') >= ?), 0) AS meaningful
        FROM ${SCORE_FROM} WHERE s.gap_score IS NOT NULL AND s.volume_24h_usd >= ?`,
      [MEANINGFUL_GAP_TURNOVER, minVolumeUsd],
    )
    return {
      total: row ? colNumber(row, 'total') : 0,
      meaningful: row ? colNumber(row, 'meaningful') : 0,
    }
  }

  /**
   * The ±2 % depth of every scored pool containing `token`, as the feeds list it: the score's
   * `depth2Usd`, else the newest snapshot's.
   */
  tokenDepth(token: Address): TokenDepth {
    const { clauses, params } = poolFilterClauses({ token })
    const row = this.ctx.get(
      `SELECT COUNT(d) AS known, SUM(d) AS total FROM (
          SELECT COALESCE(s.depth2_usd, sn.depth2_usd) AS d
            FROM ${SCORE_FROM} ${LATEST_JOIN} ${whereSql(clauses)})`,
      params,
    )
    const known = row ? colNumber(row, 'known') : 0
    return {
      depth2UsdTotal: known > 0 && row ? colNumberOrNull(row, 'total') : null,
      depthKnownPools: known,
    }
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
        FROM scores s CROSS JOIN pools p ON p.id = s.pool_id ORDER BY p.dex, s.health_total`,
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
