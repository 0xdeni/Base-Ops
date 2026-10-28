import type { PoolMeta } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colNumber, colText, jsonList, normalizeAddress, page } from '../sql.js'
import {
  filterReadsTokens,
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

/** A pool with a snapshot keeps its fee: the snapshot step writes it (`setFees`), nothing else. */
const UPSERT = `INSERT INTO pools (
    id, dex, kind, address, pool_id, token0, token1, fee_pips, tick_spacing, stable, hooks,
    created_at_block, tracked, first_seen_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  ON CONFLICT(id) DO UPDATE SET
    dex = excluded.dex, kind = excluded.kind, address = excluded.address, pool_id = excluded.pool_id,
    token0 = excluded.token0, token1 = excluded.token1,
    fee_pips = CASE WHEN EXISTS (SELECT 1 FROM snapshots s WHERE s.pool_id = excluded.id)
      THEN pools.fee_pips ELSE excluded.fee_pips END,
    tick_spacing = excluded.tick_spacing, stable = excluded.stable, hooks = excluded.hooks,
    created_at_block = excluded.created_at_block`

const SET_FEE = 'UPDATE pools SET fee_pips = ? WHERE id = ? AND fee_pips <> ?'

/** The LP fee a snapshot's state read for one pool (`PoolSnapshot.feePips`). */
export interface PoolFee {
  id: string
  feePips: number
}

const ORDER = 'ORDER BY p.id'

export class PoolsRepo {
  private readonly tokens: TokensRepo

  constructor(private readonly ctx: SqlContext) {
    this.tokens = new TokensRepo(ctx)
  }

  /**
   * Inserts or updates pool metadata, together with the embedded token0/token1 rows.
   * `tracked` and `first_seen_at` are preserved for pools already known, and so is `fee_pips` once
   * the pool has a snapshot: from then on it is the latest snapshot's reading (`setFees`), which a
   * discovery or seeding reading taken at another block must not replace.
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

  /**
   * Writes only the fee column of each pool: what the snapshot step stores for every pool it
   * snapshotted, in the transaction that stores the snapshots. No other column is touched, so a
   * `discover --seed` that rewrote a pool's `hooks` meanwhile keeps its write. Unknown ids are
   * skipped. Returns the number of pools whose stored fee changed.
   */
  setFees(fees: readonly PoolFee[]): number {
    if (fees.length === 0) return 0
    return this.ctx.transaction(() => {
      let changed = 0
      for (const { id, feePips } of fees)
        changed += this.ctx.run(SET_FEE, [feePips, id, feePips]).changes
      return changed
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

  /**
   * Pools matching the filter. Only `q` reads token columns, so every other count runs on `pools`
   * alone (its indexes, no join): `upsertMany` writes both token rows with every pool, so the
   * joins would change nothing and cost a scan of every pool.
   */
  count(filter: PoolFilter = {}): number {
    const { clauses, params } = poolFilterClauses(filter)
    const from = filterReadsTokens(filter) ? POOL_FROM : 'pools p'
    const row = this.ctx.get(`SELECT COUNT(*) AS n FROM ${from} ${whereSql(clauses)}`, params)
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
