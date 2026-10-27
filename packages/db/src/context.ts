/**
 * Thin wrapper around a DatabaseSync connection: prepared-statement cache, typed parameter
 * binding and a re-entrant transaction helper. Repositories only talk to this class.
 */
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { type BindValue, bind, type Row, toCount } from './sql.js'

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

export class SqlContext {
  private readonly statements = new Map<string, StatementSync>()

  constructor(
    readonly raw: DatabaseSync,
    /** Clock in unix seconds. Injected so tests are deterministic. */
    readonly now: () => number,
  ) {}

  prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.raw.prepare(sql)
      this.statements.set(sql, statement)
    }
    return statement
  }

  run(sql: string, params: readonly BindValue[] = []): RunResult {
    const result = this.prepare(sql).run(...bind(params))
    return { changes: toCount(result.changes), lastInsertRowid: toCount(result.lastInsertRowid) }
  }

  get(sql: string, params: readonly BindValue[] = []): Row | undefined {
    return this.prepare(sql).get(...bind(params))
  }

  all(sql: string, params: readonly BindValue[] = []): Row[] {
    return this.prepare(sql).all(...bind(params))
  }

  /**
   * Runs `fn` inside `BEGIN IMMEDIATE … COMMIT`, rolling back when it throws.
   * Nested calls join the enclosing transaction instead of starting a new one.
   */
  transaction<T>(fn: () => T): T {
    if (this.raw.isTransaction) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK')
      throw error
    }
  }
}
