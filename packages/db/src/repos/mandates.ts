/**
 * Market-maker mandates (docs/design/scorecards.md §1, §4): one row per registered mandate.
 * Addresses are stored lowercase; `kpis` and `addresses` live in JSON columns (no bigints).
 */
import type { Address, Mandate, MandateKpis } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import {
  type BindValue,
  colBool,
  colJson,
  colNumber,
  colText,
  colTextOrNull,
  jsonList,
  normalizeAddress,
  type Row,
} from '../sql.js'
import { whereSql } from './poolRow.js'

export interface MandateListOptions {
  /** Keep only active (true) or deactivated (false) mandates. */
  active?: boolean
  /** Keep only mandates keyed to this pool id. */
  poolId?: string
}

const COLUMNS = `id, name, pool_id, market_maker, addresses_json, kpis_json, alert_webhook_url,
  alert_after_samples, active, created_at, notes`

const UPSERT = `INSERT INTO mandates (
    id, name, pool_id, market_maker, addresses_json, kpis_json, alert_webhook_url,
    alert_after_samples, active, created_at, notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name, pool_id = excluded.pool_id, market_maker = excluded.market_maker,
    addresses_json = excluded.addresses_json, kpis_json = excluded.kpis_json,
    alert_webhook_url = excluded.alert_webhook_url,
    alert_after_samples = excluded.alert_after_samples, active = excluded.active,
    created_at = excluded.created_at, notes = excluded.notes`

const ORDER = 'ORDER BY id'

export function rowToMandate(row: Row): Mandate {
  return {
    id: colText(row, 'id'),
    name: colText(row, 'name'),
    poolId: colText(row, 'pool_id'),
    marketMaker: colText(row, 'market_maker'),
    addresses: colJson<Address[]>(row, 'addresses_json'),
    kpis: colJson<MandateKpis>(row, 'kpis_json'),
    alertWebhookUrl: colTextOrNull(row, 'alert_webhook_url'),
    alertAfterSamples: colNumber(row, 'alert_after_samples'),
    active: colBool(row, 'active'),
    createdAt: colNumber(row, 'created_at'),
    notes: colTextOrNull(row, 'notes'),
  }
}

function listClauses(options: MandateListOptions): { clauses: string[]; params: BindValue[] } {
  const clauses: string[] = []
  const params: BindValue[] = []
  if (options.active !== undefined) {
    clauses.push('active = ?')
    params.push(options.active)
  }
  if (options.poolId !== undefined) {
    clauses.push('pool_id = ?')
    params.push(options.poolId)
  }
  return { clauses, params }
}

export class MandatesRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Inserts or overwrites the mandate (every column, including `active` and `createdAt`). */
  upsert(mandate: Mandate): void {
    this.ctx.run(UPSERT, [
      mandate.id,
      mandate.name,
      mandate.poolId,
      mandate.marketMaker,
      JSON.stringify(mandate.addresses.map(normalizeAddress)),
      JSON.stringify(mandate.kpis),
      mandate.alertWebhookUrl,
      mandate.alertAfterSamples,
      mandate.active,
      mandate.createdAt,
      mandate.notes,
    ])
  }

  upsertMany(mandates: readonly Mandate[]): number {
    if (mandates.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const mandate of mandates) this.upsert(mandate)
      return mandates.length
    })
  }

  get(id: string): Mandate | undefined {
    const row = this.ctx.get(`SELECT ${COLUMNS} FROM mandates WHERE id = ?`, [id])
    return row ? rowToMandate(row) : undefined
  }

  /** Mandates matching the filter, ordered by id. */
  list(options: MandateListOptions = {}): Mandate[] {
    const { clauses, params } = listClauses(options)
    return this.ctx
      .all(`SELECT ${COLUMNS} FROM mandates ${whereSql(clauses)} ${ORDER}`, params)
      .map(rowToMandate)
  }

  /**
   * Every mandate (active or not) of each pool, in one query; mandates are ordered by id and
   * pools without mandates are absent from the map.
   */
  forPools(poolIds: readonly string[]): Map<string, Mandate[]> {
    const out = new Map<string, Mandate[]>()
    if (poolIds.length === 0) return out
    const rows = this.ctx.all(
      `SELECT ${COLUMNS} FROM mandates WHERE pool_id IN (SELECT value FROM json_each(?)) ${ORDER}`,
      [jsonList([...poolIds])],
    )
    for (const row of rows) {
      const mandate = rowToMandate(row)
      const list = out.get(mandate.poolId)
      if (list) list.push(mandate)
      else out.set(mandate.poolId, [mandate])
    }
    return out
  }

  /** Activates or deactivates a mandate. Returns false when the id is unknown. */
  setActive(id: string, active: boolean): boolean {
    return this.ctx.run('UPDATE mandates SET active = ? WHERE id = ?', [active, id]).changes > 0
  }

  /** Deletes the mandate row only; its samples and alerts stay (see MmSamplesRepo.deleteFor). */
  delete(id: string): boolean {
    return this.ctx.run('DELETE FROM mandates WHERE id = ?', [id]).changes > 0
  }

  count(options: MandateListOptions = {}): number {
    const { clauses, params } = listClauses(options)
    const row = this.ctx.get(`SELECT COUNT(*) AS n FROM mandates ${whereSql(clauses)}`, params)
    return row ? colNumber(row, 'n') : 0
  }
}
