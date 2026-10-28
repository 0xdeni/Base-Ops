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
  /** Open `transaction` calls: 0 outside a transaction, 1 in one, more while nested calls run. */
  private depth = 0

  constructor(
    readonly raw: DatabaseSync,
    /** Clock in unix seconds. Injected so tests are deterministic. */
    readonly now: () => number,
  ) {}

  /** True while `transaction` runs (`DatabaseSync#isTransaction` only exists from Node 22.16). */
  get inTransaction(): boolean {
    return this.depth > 0
  }

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
   * Runs `fn` inside `BEGIN IMMEDIATE … COMMIT`, rolling back when it throws. Nested calls join
   * the enclosing transaction instead of starting a new one: the class counts its own open calls,
   * so it needs nothing from the connection beyond `exec`.
   */
  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn()
    this.raw.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const result = fn()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      rollback(this.raw)
      throw error
    } finally {
      this.depth--
    }
  }
}

/**
 * `ROLLBACK` after a failed transaction. SQLite ends a transaction by itself on some errors (a full
 * disk, an interrupt); the rollback then has nothing to undo and its own error is dropped, so the
 * caller sees the error that failed the transaction.
 */
export function rollback(raw: Pick<DatabaseSync, 'exec'>): void {
  try {
    raw.exec('ROLLBACK')
  } catch {
    // No transaction was open any more: SQLite had already rolled it back.
  }
}
