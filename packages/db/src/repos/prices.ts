import type { Address } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colJson, colNumber, colText, normalizeAddress, type Row } from '../sql.js'

export interface PriceInput {
  token: Address
  usd: number
  /** Pool ids / sources walked from the USD anchor (DerivedPrice.via). */
  via: string[]
}

export interface PriceEntry extends PriceInput {
  updatedAt: number
}

const UPSERT = `INSERT INTO prices (token, usd, via_json, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(token) DO UPDATE SET
    usd = excluded.usd, via_json = excluded.via_json, updated_at = excluded.updated_at`

const SELECT = 'SELECT token, usd, via_json, updated_at FROM prices'

export function rowToPrice(row: Row): PriceEntry {
  return {
    token: colText(row, 'token') as Address,
    usd: colNumber(row, 'usd'),
    via: colJson<string[]>(row, 'via_json'),
    updatedAt: colNumber(row, 'updated_at'),
  }
}

export class PricesRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Inserts or overwrites prices; `updatedAt` defaults to the database clock. */
  upsertMany(entries: readonly PriceInput[], updatedAt?: number): number {
    if (entries.length === 0) return 0
    return this.ctx.transaction(() => {
      const at = updatedAt ?? this.ctx.now()
      for (const entry of entries) {
        this.ctx.run(UPSERT, [
          normalizeAddress(entry.token),
          entry.usd,
          JSON.stringify(entry.via),
          at,
        ])
      }
      return entries.length
    })
  }

  /** Drops every stored price and writes `entries` (the pipeline rebuilds the whole price map). */
  replaceAll(entries: readonly PriceInput[], updatedAt?: number): number {
    return this.ctx.transaction(() => {
      this.ctx.run('DELETE FROM prices')
      return this.upsertMany(entries, updatedAt)
    })
  }

  get(token: string): PriceEntry | undefined {
    const row = this.ctx.get(`${SELECT} WHERE token = ?`, [normalizeAddress(token)])
    return row ? rowToPrice(row) : undefined
  }

  usd(token: string): number | null {
    return this.get(token)?.usd ?? null
  }

  all(): Map<Address, PriceEntry> {
    const out = new Map<Address, PriceEntry>()
    for (const row of this.ctx.all(`${SELECT} ORDER BY token`)) {
      const entry = rowToPrice(row)
      out.set(entry.token, entry)
    }
    return out
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM prices')
    return row ? colNumber(row, 'n') : 0
  }
}
