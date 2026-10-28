/**
 * Webhook alert log (docs/design/scorecards.md §4, §5): every delivery attempt, successful or not.
 * `payload_json` holds the posted body; bigints inside it are stored as decimal strings and read
 * back as strings (the payload is wire JSON, not a domain type).
 */
import { jsonStringify, type MmAlert, type MmAlertKind } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  colBool,
  colJson,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  page,
  type Row,
} from '../sql.js'

const COLUMNS = `id, mandate_id, timestamp, kind, streak_samples, payload_json, delivered,
  response_status, error`

const INSERT = `INSERT INTO mm_alerts (
    mandate_id, timestamp, kind, streak_samples, payload_json, delivered, response_status, error
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

/** Newest first: highest timestamp, then highest id (insertion order). */
const NEWEST_FIRST = 'ORDER BY timestamp DESC, id DESC'

export function rowToMmAlert(row: Row): MmAlert {
  return {
    mandateId: colText(row, 'mandate_id'),
    timestamp: colNumber(row, 'timestamp'),
    kind: colText(row, 'kind') as MmAlertKind,
    streakSamples: colNumber(row, 'streak_samples'),
    payload: colJson<Record<string, unknown>>(row, 'payload_json'),
    delivered: colBool(row, 'delivered'),
    responseStatus: colNumberOrNull(row, 'response_status'),
    error: colTextOrNull(row, 'error'),
  }
}

export class MmAlertsRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Appends one alert attempt and returns its row id. */
  insert(alert: MmAlert): number {
    return this.ctx.run(INSERT, [
      alert.mandateId,
      alert.timestamp,
      alert.kind,
      alert.streakSamples,
      jsonStringify(alert.payload),
      alert.delivered,
      alert.responseStatus,
      alert.error,
    ]).lastInsertRowid
  }

  /** The newest alert of a mandate (by timestamp, then insertion order). */
  latestFor(mandateId: string): MmAlert | undefined {
    const row = this.ctx.get(
      `SELECT ${COLUMNS} FROM mm_alerts WHERE mandate_id = ? ${NEWEST_FIRST} LIMIT 1`,
      [mandateId],
    )
    return row ? rowToMmAlert(row) : undefined
  }

  /** The newest delivered alert of a mandate, whatever its kind. */
  latestDeliveredFor(mandateId: string): MmAlert | undefined {
    const row = this.ctx.get(
      `SELECT ${COLUMNS} FROM mm_alerts WHERE mandate_id = ? AND delivered = 1 ${NEWEST_FIRST} LIMIT 1`,
      [mandateId],
    )
    return row ? rowToMmAlert(row) : undefined
  }

  /**
   * Attempts of one kind recorded for a mandate, delivered or not; with `afterTs`, those with
   * `timestamp > afterTs` only (the breach attempts of the streak that follows a within-KPI
   * sample, the recovery attempts that follow a delivered breach).
   */
  countAttempts(mandateId: string, kind: MmAlertKind, afterTs?: number): number {
    const row =
      afterTs === undefined
        ? this.ctx.get('SELECT COUNT(*) AS n FROM mm_alerts WHERE mandate_id = ? AND kind = ?', [
            mandateId,
            kind,
          ])
        : this.ctx.get(
            'SELECT COUNT(*) AS n FROM mm_alerts WHERE mandate_id = ? AND kind = ? AND timestamp > ?',
            [mandateId, kind, afterTs],
          )
    return row ? colNumber(row, 'n') : 0
  }

  /** The newest `limit` alerts of a mandate, newest first. */
  listFor(mandateId: string, limit: number): MmAlert[] {
    const [bound] = page(limit, undefined)
    return this.ctx
      .all(`SELECT ${COLUMNS} FROM mm_alerts WHERE mandate_id = ? ${NEWEST_FIRST} LIMIT ?`, [
        mandateId,
        bound,
      ])
      .map(rowToMmAlert)
  }

  /** Deletes alerts with `timestamp < ts` across all mandates. Returns the number deleted. */
  pruneBefore(ts: number): number {
    return this.ctx.run('DELETE FROM mm_alerts WHERE timestamp < ?', [ts]).changes
  }

  /** Deletes every alert of a mandate (after the mandate itself was deleted). */
  deleteFor(mandateId: string): number {
    return this.ctx.run('DELETE FROM mm_alerts WHERE mandate_id = ?', [mandateId]).changes
  }

  countFor(mandateId: string): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM mm_alerts WHERE mandate_id = ?', [
      mandateId,
    ])
    return row ? colNumber(row, 'n') : 0
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM mm_alerts')
    return row ? colNumber(row, 'n') : 0
  }
}
