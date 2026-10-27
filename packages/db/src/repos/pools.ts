import type { PoolMeta } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colNumber, colText, jsonList, normalizeAddress, page } from '../sql.js'
import {
  POOL_FROM,
  POOL_SELECT,
  type PoolFilter,
  type PoolRecord,
  poolFilterClauses,
  rowToPoolMeta,
  rowToPoolRecord,
  whereSql,
} from './poolRow.js'
import { TokensRepo } from './tokens.js'

export interface PoolListOptions extends PoolFilter {
  limit?: number
  offset?: number
}

const UPSERT = `INSERT INTO pools (
    id, dex, kind, address, pool_id, token0, token1, fee_pips, tick_spacing, stable, hooks,
    created_at_block, tracked, first_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(id) DO UPDATE SET
    dex = excluded.dex, kind = excluded.kind, address = excluded.address, pool_id = excluded.pool_id,
    token0 = excluded.token0, token1 = excluded.token1, fee_pips = excluded.fee_pips,
    tick_spacing = excluded.tick_spacing, stable = excluded.stable, hooks = excluded.hooks,
    created_at_block = excluded.created_at_block`

const ORDER = 'ORDER BY p.id'

export class PoolsRepo {
  private readonly tokens: TokensRepo

  constructor(private readonly ctx: SqlContext) {
    this.tokens = new TokensRepo(ctx)
  }

  /**
   * Inserts or updates pool metadata, together with the embedded token0/token1 rows.
   * `tracked` and `first_seen_at` are preserved for pools already known.
   */
  upsertMany(pools: readonly PoolMeta[]): number {
    if (pools.length === 0) return 0
    return this.ctx.transaction(() => {
      const now = this.ctx.now()
      for (const pool of pools) {
        this.tokens.upsertOne(pool.token0)
        this.tokens.upsertOne(pool.token1)
        this.ctx.run(UPSERT, [
          pool.id,
          pool.dex,
          pool.kind,
          pool.address === null ? null : normalizeAddress(pool.address),
          pool.poolId === null ? null : pool.poolId.toLowerCase(),
          normalizeAddress(pool.token0.address),
          normalizeAddress(pool.token1.address),
          pool.feePips,
          pool.tickSpacing,
          pool.stable,
          pool.hooks === null ? null : normalizeAddress(pool.hooks),
          pool.createdAtBlock,
          now,
        ])
      }
      return pools.length
    })
  }

  get(id: string): PoolMeta | undefined {
    return this.getRecord(id)?.pool
  }

  getRecord(id: string): PoolRecord | undefined {
    const row = this.ctx.get(`SELECT ${POOL_SELECT} FROM ${POOL_FROM} WHERE p.id = ?`, [id])
    return row ? rowToPoolRecord(row) : undefined
  }

  /** One query for any number of ids; unknown ids are absent from the map. */
  getMany(ids: readonly string[]): Map<string, PoolMeta> {
    const out = new Map<string, PoolMeta>()
    if (ids.length === 0) return out
    const rows = this.ctx.all(
      `SELECT ${POOL_SELECT} FROM ${POOL_FROM} WHERE p.id IN (SELECT value FROM json_each(?)) ${ORDER}`,
      [jsonList([...ids])],
    )
    for (const row of rows) {
      const pool = rowToPoolMeta(row)
      out.set(pool.id, pool)
    }
    return out
  }

  /** Pools matching the filter, ordered by id. Without `limit` every match is returned. */
  list(options: PoolListOptions = {}): PoolMeta[] {
    return this.listRecords(options).map((record) => record.pool)
  }

  /** Like `list`, with the tracked flag and first-seen timestamp. */
  listRecords(options: PoolListOptions = {}): PoolRecord[] {
    const { clauses, params } = poolFilterClauses(options)
    const [limit, offset] = page(options.limit, options.offset)
    const rows = this.ctx.all(
      `SELECT ${POOL_SELECT} FROM ${POOL_FROM} ${whereSql(clauses)} ${ORDER} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    )
    return rows.map(rowToPoolRecord)
  }

  count(filter: PoolFilter = {}): number {
    const { clauses, params } = poolFilterClauses(filter)
    const row = this.ctx.get(`SELECT COUNT(*) AS n FROM ${POOL_FROM} ${whereSql(clauses)}`, params)
    return row ? colNumber(row, 'n') : 0
  }

  /** Marks pools as tracked (snapshotted/scored) or not. Returns the number of rows changed. */
  setTracked(ids: readonly string[], tracked: boolean): number {
    if (ids.length === 0) return 0
    return this.ctx.run(
      'UPDATE pools SET tracked = ? WHERE id IN (SELECT value FROM json_each(?))',
      [tracked, jsonList([...ids])],
    ).changes
  }

  isTracked(id: string): boolean {
    return this.getRecord(id)?.tracked ?? false
  }

  trackedIds(): string[] {
    return this.ctx
      .all('SELECT id FROM pools WHERE tracked = 1 ORDER BY id')
      .map((row) => colText(row, 'id'))
  }

  /** Every pool with the token on either side, ordered by id. */
  forToken(address: string): PoolMeta[] {
    const addr = normalizeAddress(address)
    const rows = this.ctx.all(
      `SELECT ${POOL_SELECT} FROM ${POOL_FROM} WHERE p.token0 = ? OR p.token1 = ? ${ORDER}`,
      [addr, addr],
    )
    return rows.map(rowToPoolMeta)
  }

  delete(id: string): boolean {
    return this.ctx.run('DELETE FROM pools WHERE id = ?', [id]).changes > 0
  }
}
