import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from './database.js'
import {
  fixtureMandate,
  fixtureMmAlert,
  fixtureMmSample,
  fixturePool,
  fixtureToken,
} from './fixtures.js'
import { currentVersion, MIGRATIONS, SCHEMA_VERSION } from './schema.js'

const NOW = 1_700_000_000

const EXPECTED_TABLES = [
  'mandates',
  'mm_alerts',
  'mm_samples',
  'pools',
  'positions',
  'prices',
  'schema_version',
  'scores',
  'snapshots',
  'sync_state',
  'tokens',
  'volume_hourly',
]

const EXPECTED_INDEXES = [
  'mandates_pool_id',
  'mm_alerts_mandate_timestamp',
  'mm_samples_mandate_timestamp',
  'pools_dex',
  'pools_token0',
  'pools_token1',
  'pools_tracked',
  'scores_depth2_usd',
  'scores_gap_score',
  'scores_health_total',
  'scores_volume_24h_usd',
  'snapshots_pool_timestamp',
  'snapshots_timestamp',
  'volume_hourly_hour_start',
]

function names(db: Database, type: 'table' | 'index'): string[] {
  return db.raw
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    )
    .all(type)
    .map((row) => String(row.name))
}

describe('openDatabase', () => {
  const open: Database[] = []
  const tempDirs: string[] = []
  afterEach(() => {
    for (const db of open.splice(0)) db.close()
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function memory(): Database {
    const db = openDatabase(':memory:', { now: () => NOW })
    open.push(db)
    return db
  }

  it('creates the schema and records every migration once', () => {
    const db = memory()
    expect(db.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(MIGRATIONS.length).toBe(2)
    expect(SCHEMA_VERSION).toBe(2)
    expect(names(db, 'table')).toEqual(EXPECTED_TABLES)
    expect(names(db, 'index')).toEqual(EXPECTED_INDEXES)
    const versions = db.raw
      .prepare('SELECT version, applied_at FROM schema_version ORDER BY version')
      .all()
    expect(versions).toEqual(
      MIGRATIONS.map((_, index) => ({ version: index + 1, applied_at: NOW })),
    )
    expect(currentVersion(db.raw)).toBe(SCHEMA_VERSION)
    expect(db.path).toBe(':memory:')
    expect(db.isOpen).toBe(true)
  })

  it('is idempotent on reopen of a file database and uses WAL journaling', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'test.sqlite')

    const first = openDatabase(path, { now: () => NOW })
    expect(first.migration).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(first.raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    first.tokens.upsertMany([fixtureToken()])
    first.mandates.upsert(fixtureMandate())
    first.mmSamples.insert(fixtureMmSample())
    first.mmAlerts.insert(fixtureMmAlert())
    first.close()
    expect(first.isOpen).toBe(false)

    const second = openDatabase(path, { now: () => NOW + 1 })
    open.push(second)
    expect(second.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(second.raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual({
      n: SCHEMA_VERSION,
    })
    expect(names(second, 'table')).toEqual(EXPECTED_TABLES)
    expect(names(second, 'index')).toEqual(EXPECTED_INDEXES)
    expect(second.tokens.get(fixtureToken().address)).toEqual(fixtureToken())
    expect(second.pools.upsertMany([fixturePool()])).toBe(1)
    expect(second.mandates.get(fixtureMandate().id)).toEqual(fixtureMandate())
    expect(second.mmSamples.latestFor(fixtureMandate().id)).toEqual(fixtureMmSample())
    expect(second.mmAlerts.latestFor(fixtureMandate().id)).toEqual(fixtureMmAlert())
    expect(readdirSync(dir)).toContain('test.sqlite')
  })

  it('upgrades a version-1 database to the scorecard schema and keeps its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'v1.sqlite')

    // Roll a fresh database back to version 1 (layer 1 tables only) the way a pre-layer-2
    // build would have left it, then reopen with the current build.
    const fresh = openDatabase(path, { now: () => NOW })
    fresh.tokens.upsertMany([fixtureToken()])
    fresh.raw.exec('DROP TABLE mm_alerts; DROP TABLE mm_samples; DROP TABLE mandates')
    fresh.raw.prepare('DELETE FROM schema_version WHERE version > 1').run()
    expect(currentVersion(fresh.raw)).toBe(1)
    expect(names(fresh, 'table')).not.toContain('mandates')
    fresh.close()

    const upgraded = openDatabase(path, { now: () => NOW + 5 })
    open.push(upgraded)
    expect(upgraded.migration).toEqual({ from: 1, to: SCHEMA_VERSION })
    expect(names(upgraded, 'table')).toEqual(EXPECTED_TABLES)
    expect(names(upgraded, 'index')).toEqual(EXPECTED_INDEXES)
    expect(
      upgraded.raw.prepare('SELECT version, applied_at FROM schema_version ORDER BY version').all(),
    ).toEqual([
      { version: 1, applied_at: NOW },
      { version: 2, applied_at: NOW + 5 },
    ])
    expect(upgraded.tokens.get(fixtureToken().address)).toEqual(fixtureToken())
    upgraded.mandates.upsert(fixtureMandate())
    expect(upgraded.mandates.count()).toBe(1)
    upgraded.close()

    const again = openDatabase(path, { now: () => NOW + 9 })
    open.push(again)
    expect(again.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(again.mandates.get(fixtureMandate().id)).toEqual(fixtureMandate())
  })

  it('refuses a database written by a newer schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-'))
    tempDirs.push(dir)
    const path = join(dir, 'newer.sqlite')
    const db = openDatabase(path, { now: () => NOW })
    db.raw
      .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION + 1, NOW)
    db.close()
    expect(() => openDatabase(path)).toThrow(/newer than this build/)
  })

  it('commits transactions, rolls back on throw and lets nested calls join', () => {
    const db = memory()
    const result = db.transaction(() => {
      db.syncState.set('a', '1')
      return db.transaction(() => {
        db.syncState.set('b', '2')
        expect(db.raw.isTransaction).toBe(true)
        return 'nested'
      })
    })
    expect(result).toBe('nested')
    expect(db.raw.isTransaction).toBe(false)
    expect(db.syncState.entries()).toEqual([
      ['a', '1'],
      ['b', '2'],
    ])

    expect(() =>
      db.transaction(() => {
        db.syncState.set('c', '3')
        db.transaction(() => {
          db.syncState.set('d', '4')
        })
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(db.raw.isTransaction).toBe(false)
    expect(db.syncState.get('c')).toBeUndefined()
    expect(db.syncState.get('d')).toBeUndefined()
  })

  it('stamps first_seen_at from the injected clock and closes idempotently', () => {
    const db = memory()
    db.pools.upsertMany([fixturePool()])
    expect(db.pools.getRecord(fixturePool().id)?.firstSeenAt).toBe(NOW)
    db.close()
    expect(() => db.close()).not.toThrow()
    expect(db.isOpen).toBe(false)
  })
})
