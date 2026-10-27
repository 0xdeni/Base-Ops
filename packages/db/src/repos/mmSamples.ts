/**
 * Scorecard samples (docs/design/scorecards.md §4): one row per mandate per snapshot of its pool.
 * `block_number` is decimal TEXT, `attribution_json` an MmAttribution and `breaches_json` a
 * BreachKind[] (neither holds bigints); `within_kpi` is NULL for non-evaluable samples.
 */
import type { BreachKind, MmAttribution, MmSample } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  colBigint,
  colJson,
  colNumber,
  colNumberOrNull,
  colText,
  jsonList,
  page,
  type Row,
} from '../sql.js'

const COLUMNS = `id, mandate_id, pool_id, block_number, timestamp, attribution_json, within_kpi,
  breaches_json`

const INSERT = `INSERT INTO mm_samples (
    mandate_id, pool_id, block_number, timestamp, attribution_json, within_kpi, breaches_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`

/** Newest row per mandate: highest timestamp, then highest id (insertion order) as the tie-break. */
const LATEST_PER_MANDATE = `SELECT ${COLUMNS} FROM (
    SELECT ${COLUMNS}, ROW_NUMBER() OVER (PARTITION BY mandate_id ORDER BY timestamp DESC, id DESC) AS rn
    FROM mm_samples WHERE mandate_id IN (SELECT value FROM json_each(?))
  ) WHERE rn = 1 ORDER BY mandate_id`

export function rowToMmSample(row: Row): MmSample {
  const withinKpi = colNumberOrNull(row, 'within_kpi')
  return {
    mandateId: colText(row, 'mandate_id'),
    poolId: colText(row, 'pool_id'),
    blockNumber: colBigint(row, 'block_number'),
    timestamp: colNumber(row, 'timestamp'),
    attribution: colJson<MmAttribution>(row, 'attribution_json'),
    withinKpi: withinKpi === null ? null : withinKpi !== 0,
    breaches: colJson<BreachKind[]>(row, 'breaches_json'),
  }
}

export class MmSamplesRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Appends one sample and returns its row id. */
  insert(sample: MmSample): number {
    return this.ctx.run(INSERT, [
      sample.mandateId,
      sample.poolId,
      sample.blockNumber,
      sample.timestamp,
      JSON.stringify(sample.attribution),
      sample.withinKpi === null ? null : sample.withinKpi,
      JSON.stringify(sample.breaches),
    ]).lastInsertRowid
  }

  insertMany(samples: readonly MmSample[]): number {
    if (samples.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const sample of samples) this.insert(sample)
      return samples.length
    })
  }

  /**
   * Samples with `fromTs <= timestamp` (and `timestamp <= toTs` when given), ascending by
   * timestamp then insertion order.
   */
  seriesFor(mandateId: string, fromTs: number, toTs?: number): MmSample[] {
    const rows =
      toTs === undefined
        ? this.ctx.all(
            `SELECT ${COLUMNS} FROM mm_samples WHERE mandate_id = ? AND timestamp >= ?
              ORDER BY timestamp, id`,
            [mandateId, fromTs],
          )
        : this.ctx.all(
            `SELECT ${COLUMNS} FROM mm_samples WHERE mandate_id = ? AND timestamp >= ? AND timestamp <= ?
              ORDER BY timestamp, id`,
            [mandateId, fromTs, toTs],
          )
    return rows.map(rowToMmSample)
  }

  /** The newest `limit` samples of a mandate, returned oldest first (for streak walks). */
  recentFor(mandateId: string, limit: number): MmSample[] {
    const [bound] = page(limit, undefined)
    const rows = this.ctx.all(
      `SELECT ${COLUMNS} FROM (
          SELECT ${COLUMNS} FROM mm_samples WHERE mandate_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?
        ) ORDER BY timestamp, id`,
      [mandateId, bound],
    )
    return rows.map(rowToMmSample)
  }

  latestFor(mandateId: string): MmSample | undefined {
    const row = this.ctx.get(
      `SELECT ${COLUMNS} FROM mm_samples WHERE mandate_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [mandateId],
    )
    return row ? rowToMmSample(row) : undefined
  }

  /** The newest sample of each mandate, in one query. Mandates without samples are absent. */
  latestForMany(mandateIds: readonly string[]): Map<string, MmSample> {
    const out = new Map<string, MmSample>()
    if (mandateIds.length === 0) return out
    for (const row of this.ctx.all(LATEST_PER_MANDATE, [jsonList([...mandateIds])])) {
      const sample = rowToMmSample(row)
      out.set(sample.mandateId, sample)
    }
    return out
  }

  /** Deletes samples with `timestamp < ts` across all mandates. Returns the number deleted. */
  pruneBefore(ts: number): number {
    return this.ctx.run('DELETE FROM mm_samples WHERE timestamp < ?', [ts]).changes
  }

  /** Deletes every sample of a mandate (after the mandate itself was deleted). */
  deleteFor(mandateId: string): number {
    return this.ctx.run('DELETE FROM mm_samples WHERE mandate_id = ?', [mandateId]).changes
  }

  countFor(mandateId: string): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM mm_samples WHERE mandate_id = ?', [
      mandateId,
    ])
    return row ? colNumber(row, 'n') : 0
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM mm_samples')
    return row ? colNumber(row, 'n') : 0
  }
}
