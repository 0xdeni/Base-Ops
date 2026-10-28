/**
 * `openDatabase(path | ':memory:')` opens (or creates) a SQLite database, runs migrations and
 * returns the typed repositories.
 *
 * `node:sqlite` is loaded lazily through `createRequire` rather than a static import: Node emits
 * its ExperimentalWarning while the module graph is still loading, before any user code could
 * install a filter, so the filter is installed first and the module required right after.
 */
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'
import { SqlContext } from './context.js'
import { MandatesRepo } from './repos/mandates.js'
import { MmAlertsRepo } from './repos/mmAlerts.js'
import { MmSamplesRepo } from './repos/mmSamples.js'
import { PoolsRepo } from './repos/pools.js'
import { PositionsRepo } from './repos/positions.js'
import { PricesRepo } from './repos/prices.js'
import { ScoresRepo } from './repos/scores.js'
import { SnapshotsRepo } from './repos/snapshots.js'
import { SyncStateRepo } from './repos/syncState.js'
import { TokensRepo } from './repos/tokens.js'
import { VolumeRepo } from './repos/volume.js'
import { applyMigrations, type MigrationResult } from './schema.js'
import { registerSummaryFunctions } from './summary.js'
import { installSqliteWarningFilter } from './warnings.js'

export interface OpenDatabaseOptions {
  /** Clock in unix seconds for `first_seen_at`, `updated_at` and migration timestamps. */
  now?: () => number
}

export interface Database {
  /** The path given to openDatabase (`':memory:'` for in-memory databases). */
  readonly path: string
  /** Escape hatch for ad-hoc SQL; repositories cover everything the pipeline needs. */
  readonly raw: DatabaseSync
  readonly migration: MigrationResult
  readonly tokens: TokensRepo
  readonly pools: PoolsRepo
  readonly snapshots: SnapshotsRepo
  readonly volume: VolumeRepo
  readonly positions: PositionsRepo
  readonly prices: PricesRepo
  readonly scores: ScoresRepo
  readonly syncState: SyncStateRepo
  /** Market-maker scorecards (docs/design/scorecards.md §4). */
  readonly mandates: MandatesRepo
  readonly mmSamples: MmSamplesRepo
  readonly mmAlerts: MmAlertsRepo
  /** Runs `fn` in `BEGIN IMMEDIATE … COMMIT`, rolling back on throw; nested calls join the outer one. */
  transaction<T>(fn: () => T): T
  /**
   * Refreshes the planner statistics (`ANALYZE`, sampling at most `ANALYSIS_LIMIT` rows per
   * index) after a bulk write of pools, so the dex-filtered feeds and `statsByDex` search the
   * small side of a join first. Costs milliseconds; the pipeline runs it after discovery.
   */
  analyze(): void
  /** Runs `PRAGMA optimize` and closes the connection. Safe to call more than once. */
  close(): void
  readonly isOpen: boolean
}

/** Rows `ANALYZE` and `PRAGMA optimize` sample per index: SQLite's recommended 100–1000 range. */
export const ANALYSIS_LIMIT = 1000

type SqliteModule = typeof import('node:sqlite')

const require = createRequire(import.meta.url)
let sqlite: SqliteModule | undefined

function loadSqlite(): SqliteModule {
  if (!sqlite) {
    installSqliteWarningFilter()
    sqlite = require('node:sqlite') as SqliteModule
  }
  return sqlite
}

class SqliteDatabase implements Database {
  readonly tokens: TokensRepo
  readonly pools: PoolsRepo
  readonly snapshots: SnapshotsRepo
  readonly volume: VolumeRepo
  readonly positions: PositionsRepo
  readonly prices: PricesRepo
  readonly scores: ScoresRepo
  readonly syncState: SyncStateRepo
  readonly mandates: MandatesRepo
  readonly mmSamples: MmSamplesRepo
  readonly mmAlerts: MmAlertsRepo
  private open = true

  constructor(
    readonly path: string,
    readonly raw: DatabaseSync,
    readonly migration: MigrationResult,
    private readonly ctx: SqlContext,
  ) {
    this.tokens = new TokensRepo(ctx)
    this.pools = new PoolsRepo(ctx)
    this.snapshots = new SnapshotsRepo(ctx)
    this.volume = new VolumeRepo(ctx)
    this.positions = new PositionsRepo(ctx)
    this.prices = new PricesRepo(ctx)
    this.scores = new ScoresRepo(ctx)
    this.syncState = new SyncStateRepo(ctx)
    this.mandates = new MandatesRepo(ctx)
    this.mmSamples = new MmSamplesRepo(ctx)
    this.mmAlerts = new MmAlertsRepo(ctx)
  }

  get isOpen(): boolean {
    return this.open
  }

  transaction<T>(fn: () => T): T {
    return this.ctx.transaction(fn)
  }

  analyze(): void {
    this.raw.exec('ANALYZE')
  }

  close(): void {
    if (!this.open) return
    this.open = false
    try {
      // SQLite's advice for a long-lived connection: refresh stale statistics before closing.
      this.raw.exec('PRAGMA optimize')
    } catch {
      // A database that cannot be written (a read-only file) keeps the statistics it has.
    }
    this.raw.close()
  }
}

export const IN_MEMORY = ':memory:'

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Database {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const { DatabaseSync } = loadSqlite()
  const raw = new DatabaseSync(path)
  try {
    if (path !== IN_MEMORY) {
      raw.exec('PRAGMA journal_mode = WAL')
      raw.exec('PRAGMA synchronous = NORMAL')
      raw.exec('PRAGMA busy_timeout = 5000')
    }
    raw.exec('PRAGMA temp_store = MEMORY')
    raw.exec(`PRAGMA analysis_limit = ${ANALYSIS_LIMIT}`)
    registerSummaryFunctions(raw)
    const migration = applyMigrations(raw, now)
    return new SqliteDatabase(path, raw, migration, new SqlContext(raw, now))
  } catch (error) {
    raw.close()
    throw error
  }
}
