import type { SqlContext } from '../context.js'
import { colText } from '../sql.js'

/** Small key/value store for pipeline cursors, e.g. `discover:uniswap-v3:lastBlock`. */
export class SyncStateRepo {
  constructor(private readonly ctx: SqlContext) {}

  get(key: string): string | undefined {
    const row = this.ctx.get('SELECT value FROM sync_state WHERE key = ?', [key])
    return row ? colText(row, 'value') : undefined
  }

  set(key: string, value: string): void {
    this.ctx.run(
      'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    )
  }

  delete(key: string): boolean {
    return this.ctx.run('DELETE FROM sync_state WHERE key = ?', [key]).changes > 0
  }

  /** Reads a decimal bigint (block numbers); undefined when unset. Throws on malformed values. */
  getBigInt(key: string): bigint | undefined {
    const value = this.get(key)
    if (value === undefined) return undefined
    if (!/^-?\d+$/.test(value))
      throw new Error(`db: sync_state "${key}" is not an integer: ${value}`)
    return BigInt(value)
  }

  setBigInt(key: string, value: bigint): void {
    this.set(key, value.toString())
  }

  /** Every key that starts with `prefix` (e.g. `volume:`), ordered. */
  keys(prefix: string): string[] {
    return this.ctx
      .all('SELECT key FROM sync_state WHERE substr(key, 1, ?) = ? ORDER BY key', [
        prefix.length,
        prefix,
      ])
      .map((row) => colText(row, 'key'))
  }

  /** Every key/value pair, ordered by key. */
  entries(): Array<[key: string, value: string]> {
    return this.ctx
      .all('SELECT key, value FROM sync_state ORDER BY key')
      .map((row) => [colText(row, 'key'), colText(row, 'value')])
  }
}
