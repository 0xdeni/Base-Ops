import type { VolumeBucket } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  type BindValue,
  colBigint,
  colNumber,
  colNumberOrNull,
  colText,
  jsonList,
  type Row,
} from '../sql.js'

const UPSERT = `INSERT INTO volume_hourly (
    pool_id, hour_start, volume_token0, volume_token1, volume_usd, swap_count
  ) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(pool_id, hour_start) DO UPDATE SET
    volume_token0 = excluded.volume_token0, volume_token1 = excluded.volume_token1,
    volume_usd = excluded.volume_usd, swap_count = excluded.swap_count`

const COLUMNS = 'pool_id, hour_start, volume_token0, volume_token1, volume_usd, swap_count'

export function rowToBucket(row: Row): VolumeBucket {
  return {
    poolId: colText(row, 'pool_id'),
    hourStart: colNumber(row, 'hour_start'),
    volumeToken0: colBigint(row, 'volume_token0'),
    volumeToken1: colBigint(row, 'volume_token1'),
    volumeUsd: colNumberOrNull(row, 'volume_usd'),
    swapCount: colNumber(row, 'swap_count'),
  }
}

/** `hour_start >= fromTs` and, when given, `hour_start < toTs` (buckets are half-open hours). */
function windowClause(
  fromTs: number,
  toTs: number | undefined,
): { sql: string; params: BindValue[] } {
  return toTs === undefined
    ? { sql: 'hour_start >= ?', params: [fromTs] }
    : { sql: 'hour_start >= ? AND hour_start < ?', params: [fromTs, toTs] }
}

export class VolumeRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Replaces whole hour buckets (the pipeline recomputes complete hours; nothing is accumulated). */
  upsertBuckets(buckets: readonly VolumeBucket[]): number {
    if (buckets.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const bucket of buckets) {
        this.ctx.run(UPSERT, [
          bucket.poolId,
          bucket.hourStart,
          bucket.volumeToken0,
          bucket.volumeToken1,
          bucket.volumeUsd,
          bucket.swapCount,
        ])
      }
      return buckets.length
    })
  }

  /**
   * USD volume over buckets starting in `[fromTs, toTs)`. Null when no bucket in the window has
   * a USD value (volume unknown, as opposed to zero).
   */
  sumUsd(poolId: string, fromTs: number, toTs?: number): number | null {
    const window = windowClause(fromTs, toTs)
    const row = this.ctx.get(
      `SELECT SUM(volume_usd) AS usd FROM volume_hourly WHERE pool_id = ? AND ${window.sql}`,
      [poolId, ...window.params],
    )
    return row ? colNumberOrNull(row, 'usd') : null
  }

  /** `sumUsd` for many pools in one query; pools with no USD volume in the window are absent. */
  sumUsdForPools(poolIds: readonly string[], fromTs: number, toTs?: number): Map<string, number> {
    const out = new Map<string, number>()
    if (poolIds.length === 0) return out
    const window = windowClause(fromTs, toTs)
    const rows = this.ctx.all(
      `SELECT pool_id, SUM(volume_usd) AS usd FROM volume_hourly
        WHERE pool_id IN (SELECT value FROM json_each(?)) AND ${window.sql}
        GROUP BY pool_id`,
      [jsonList([...poolIds]), ...window.params],
    )
    for (const row of rows) {
      const usd = colNumberOrNull(row, 'usd')
      if (usd !== null) out.set(colText(row, 'pool_id'), usd)
    }
    return out
  }

  /** Number of swaps in buckets starting in `[fromTs, toTs)`. */
  swapCount(poolId: string, fromTs: number, toTs?: number): number {
    const window = windowClause(fromTs, toTs)
    const row = this.ctx.get(
      `SELECT COALESCE(SUM(swap_count), 0) AS n FROM volume_hourly WHERE pool_id = ? AND ${window.sql}`,
      [poolId, ...window.params],
    )
    return row ? colNumber(row, 'n') : 0
  }

  /** Buckets starting in `[fromTs, toTs)`, ascending by hour. */
  series(poolId: string, fromTs: number, toTs?: number): VolumeBucket[] {
    const window = windowClause(fromTs, toTs)
    return this.ctx
      .all(
        `SELECT ${COLUMNS} FROM volume_hourly WHERE pool_id = ? AND ${window.sql} ORDER BY hour_start`,
        [poolId, ...window.params],
      )
      .map(rowToBucket)
  }

  get(poolId: string, hourStart: number): VolumeBucket | undefined {
    const row = this.ctx.get(
      `SELECT ${COLUMNS} FROM volume_hourly WHERE pool_id = ? AND hour_start = ?`,
      [poolId, hourStart],
    )
    return row ? rowToBucket(row) : undefined
  }

  /** Deletes buckets with `hour_start < ts`. Returns the number deleted. */
  pruneBefore(ts: number): number {
    return this.ctx.run('DELETE FROM volume_hourly WHERE hour_start < ?', [ts]).changes
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM volume_hourly')
    return row ? colNumber(row, 'n') : 0
  }
}
