/**
 * The SQL the score queries share, and the per-DEX totals of `GET /api/stats`: counts, the ±2 %
 * depth sum without stale quotes (docs/METRICS.md, "Stale quotes"), the known 24 h volume sum and
 * the health median over rated pools.
 */
import { DEXES, type Dex, STALE_QUOTE_MIN_DEVIATION_BPS } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colNumber, colNumberOrNull, colText } from '../sql.js'

/**
 * Whether the stored score is rated: the flag lives in `health_json`. A row scored before ratings
 * existed has none and counts as unrated until `score` runs again.
 */
export const RATED_SQL = `COALESCE(json_extract(s.health_json, '$.rated'), 0) = 1`

/** The pool's newest snapshot `sn`, joined to its score row `s` (none: every `sn` column NULL). */
export const LATEST_JOIN = `LEFT JOIN snapshots sn ON sn.id = (
    SELECT x.id FROM snapshots x WHERE x.pool_id = s.pool_id ORDER BY x.timestamp DESC, x.id DESC LIMIT 1
  )`

/**
 * Whether the newest snapshot `sn` is a stale quote (core's `isStaleQuote`): a deviation that is
 * unknown (NULL, or no snapshot) is not stale.
 */
export const STALE_SQL = `COALESCE(sn.price_deviation_bps >= ${STALE_QUOTE_MIN_DEVIATION_BPS}, 0) = 1`

export interface DexStats {
  dex: Dex
  /** Pools discovered for the dex. */
  pools: number
  tracked: number
  /** Pools with a score row. */
  scored: number
  /** Scored pools that are rated (docs/METRICS.md, "Rated and unrated pools"). */
  rated: number
  /** Sum over scored pools whose newest snapshot is not a stale quote. */
  depth2UsdSum: number
  /** Sum over scored pools with a known 24 h volume; null when none has one (unknown is not 0). */
  volume24hUsdSum: number | null
  /** Median health total over rated pools; null when none are rated. */
  medianHealth: number | null
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

/** Per-dex totals, in DEXES order (dexes without pools included with zeros). */
export function statsByDex(ctx: SqlContext): DexStats[] {
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

  const poolRows = ctx.all(
    'SELECT dex, COUNT(*) AS pools, COALESCE(SUM(tracked), 0) AS tracked FROM pools GROUP BY dex',
  )
  for (const row of poolRows) {
    const entry = statsFor(colText(row, 'dex'))
    entry.pools = colNumber(row, 'pools')
    entry.tracked = colNumber(row, 'tracked')
  }

  const healthByDex = new Map<string, number[]>()
  const scoreRows = ctx.all(
    `SELECT p.dex AS dex, s.health_total AS health, s.depth2_usd AS depth2,
        s.volume_24h_usd AS volume, ${RATED_SQL} AS rated, ${STALE_SQL} AS stale
      FROM scores s CROSS JOIN pools p ON p.id = s.pool_id ${LATEST_JOIN}
      ORDER BY p.dex, s.health_total`,
  )
  for (const row of scoreRows) {
    const dex = colText(row, 'dex')
    const entry = statsFor(dex)
    entry.scored += 1
    // A stale quote's depth is measured at a price nobody trades: it stays out of the sum.
    if (colNumber(row, 'stale') !== 1) entry.depth2UsdSum += colNumberOrNull(row, 'depth2') ?? 0
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

/** Median health total over rated pools (all DEXes); null when none is rated. */
export function medianRatedHealth(ctx: SqlContext): number | null {
  const rows = ctx.all(
    `SELECT s.health_total AS health FROM scores s WHERE ${RATED_SQL} ORDER BY s.health_total`,
  )
  return median(rows.map((row) => colNumber(row, 'health')))
}
