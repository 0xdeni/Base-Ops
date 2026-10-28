/**
 * Transactions on a connection without `DatabaseSync#isTransaction`, which Node 22.13 to 22.15
 * (the supported floor) do not have: nested calls join the outer transaction, a throw rolls all of
 * it back, and a failed migration leaves no transaction open.
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SqlContext } from './context.js'
import { type Database, openDatabase } from './database.js'
import { applyMigrations, SCHEMA_VERSION } from './schema.js'

const NOW = 1_700_000_000

/** `raw` as Node 22.13 exposes it: no `isTransaction` property. */
function withoutIsTransaction(raw: DatabaseSync): DatabaseSync {
  return new Proxy(raw, {
    get(target, key) {
      if (key === 'isTransaction') return undefined
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const open: Database[] = []
afterEach(() => {
  for (const db of open.splice(0)) db.close()
})

function context(): SqlContext {
  const db = openDatabase(':memory:', { now: () => NOW })
  open.push(db)
  const ctx = new SqlContext(withoutIsTransaction(db.raw), () => NOW)
  expect(ctx.raw.isTransaction).toBeUndefined()
  ctx.run('CREATE TABLE t (v INTEGER NOT NULL)')
  return ctx
}

describe('SqlContext.transaction without DatabaseSync#isTransaction', () => {
  it('lets nested calls join the outer transaction', () => {
    const ctx = context()
    const result = ctx.transaction(() => {
      ctx.run('INSERT INTO t VALUES (1)')
      return ctx.transaction(() => {
        ctx.run('INSERT INTO t VALUES (2)')
        expect(ctx.inTransaction).toBe(true)
        return 'nested'
      })
    })
    expect(result).toBe('nested')
    expect(ctx.inTransaction).toBe(false)
    expect(ctx.all('SELECT v FROM t ORDER BY v')).toEqual([{ v: 1 }, { v: 2 }])
  })

  it('rolls back the outer and nested writes when the outer call throws', () => {
    const ctx = context()
    expect(() =>
      ctx.transaction(() => {
        ctx.run('INSERT INTO t VALUES (3)')
        ctx.transaction(() => ctx.run('INSERT INTO t VALUES (4)'))
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(ctx.inTransaction).toBe(false)
    expect(ctx.all('SELECT v FROM t')).toEqual([])
    // The connection takes a new transaction: nothing was left open.
    ctx.transaction(() => ctx.run('INSERT INTO t VALUES (5)'))
    expect(ctx.all('SELECT v FROM t')).toEqual([{ v: 5 }])
  })

  it('throws the error of the transaction when SQLite already rolled it back', () => {
    const ctx = context()
    expect(() =>
      ctx.transaction(() => {
        ctx.run('INSERT INTO t VALUES (6)')
        ctx.raw.exec('ROLLBACK')
        throw new Error('after rollback')
      }),
    ).toThrow('after rollback')
    expect(ctx.inTransaction).toBe(false)
    expect(ctx.all('SELECT v FROM t')).toEqual([])
  })
})

describe('applyMigrations without DatabaseSync#isTransaction', () => {
  it('rolls a failed migration back and leaves no transaction open', () => {
    const db = openDatabase(':memory:', { now: () => NOW })
    open.push(db)
    const Connection = db.raw.constructor as typeof DatabaseSync
    const raw = new Connection(':memory:')
    try {
      const fresh = withoutIsTransaction(raw)
      const failingClock = () => {
        throw new Error('clock failed')
      }
      expect(() => applyMigrations(fresh, failingClock)).toThrow('clock failed')
      const tables = raw
        .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'`)
        .get()
      expect(tables).toEqual({ n: 0 })
      expect(applyMigrations(fresh, () => NOW)).toEqual({ from: 0, to: SCHEMA_VERSION })
    } finally {
      raw.close()
    }
  })
})
