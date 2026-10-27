/**
 * Versioned schema. `MIGRATIONS[i]` brings the database to version `i + 1`; each entry is a batch
 * of SQL statements applied in one transaction and recorded in `schema_version`.
 *
 * Never edit an entry that has shipped: append a new one.
 *
 * Storage conventions (DESIGN.md "Storage"): bigints are TEXT decimal strings, JSON columns hold
 * the core types with bigints as strings, addresses are lowercase, timestamps are unix seconds.
 * A few denormalised columns (snapshots.depth2_usd / spread10k_bps / owner_top1_share,
 * scores.health_total / gap_score) exist so that the dashboard's sorts run in SQL. Reads of
 * `spread10k_bps` and `spreads_json` go through core's price impact cap (summary.ts): a row
 * stored before the cap holds the uncapped spread.
 *
 * Version 2 adds the market-maker scorecard tables (`mandates`, `mm_samples`, `mm_alerts`).
 */
import type { DatabaseSync } from 'node:sqlite'
import { toCount } from './sql.js'

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL
  );

  CREATE TABLE pools (
    id TEXT PRIMARY KEY,
    dex TEXT NOT NULL,
    kind TEXT NOT NULL,
    address TEXT,
    pool_id TEXT,
    token0 TEXT NOT NULL,
    token1 TEXT NOT NULL,
    fee_pips INTEGER NOT NULL,
    tick_spacing INTEGER,
    stable INTEGER NOT NULL DEFAULT 0,
    hooks TEXT,
    created_at_block TEXT NOT NULL,
    tracked INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL
  );
  CREATE INDEX pools_dex ON pools(dex);
  CREATE INDEX pools_token0 ON pools(token0);
  CREATE INDEX pools_token1 ON pools(token1);
  CREATE INDEX pools_tracked ON pools(tracked);

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    block_number TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    price REAL NOT NULL,
    token0_usd REAL,
    token1_usd REAL,
    tvl_usd REAL,
    active_liquidity TEXT NOT NULL,
    depth_json TEXT NOT NULL,
    depth_usd_json TEXT NOT NULL,
    spreads_json TEXT NOT NULL,
    concentration_json TEXT,
    depth2_usd REAL,
    spread10k_bps REAL,
    owner_top1_share REAL
  );
  CREATE INDEX snapshots_pool_timestamp ON snapshots(pool_id, timestamp);
  CREATE INDEX snapshots_timestamp ON snapshots(timestamp);

  CREATE TABLE volume_hourly (
    pool_id TEXT NOT NULL,
    hour_start INTEGER NOT NULL,
    volume_token0 TEXT NOT NULL,
    volume_token1 TEXT NOT NULL,
    volume_usd REAL,
    swap_count INTEGER NOT NULL,
    PRIMARY KEY (pool_id, hour_start)
  );
  CREATE INDEX volume_hourly_hour_start ON volume_hourly(hour_start);

  CREATE TABLE positions (
    pool_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,
    updated_block TEXT NOT NULL,
    PRIMARY KEY (pool_id, token_id)
  );

  CREATE TABLE prices (
    token TEXT PRIMARY KEY,
    usd REAL NOT NULL,
    via_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE scores (
    pool_id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    health_json TEXT NOT NULL,
    gap_json TEXT NOT NULL,
    persistence_24h_json TEXT NOT NULL,
    persistence_7d_json TEXT NOT NULL,
    volume_24h_usd REAL,
    depth2_usd REAL,
    health_total REAL NOT NULL,
    gap_score REAL
  );
  CREATE INDEX scores_depth2_usd ON scores(depth2_usd);
  CREATE INDEX scores_volume_24h_usd ON scores(volume_24h_usd);
  CREATE INDEX scores_health_total ON scores(health_total);
  CREATE INDEX scores_gap_score ON scores(gap_score);

  CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Version 2: market-maker scorecards (docs/design/scorecards.md §4). `addresses_json` is a JSON
  // array of lowercase addresses, `kpis_json` a MandateKpis, `attribution_json` an MmAttribution
  // (no bigints), `breaches_json` a BreachKind[] and `payload_json` the posted alert body.
  // `within_kpi` is NULL when the sample was not evaluable (a required USD price was missing).
  `
  CREATE TABLE mandates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    market_maker TEXT NOT NULL,
    addresses_json TEXT NOT NULL,
    kpis_json TEXT NOT NULL,
    alert_webhook_url TEXT,
    alert_after_samples INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    notes TEXT
  );
  CREATE INDEX mandates_pool_id ON mandates(pool_id);

  CREATE TABLE mm_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandate_id TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    block_number TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attribution_json TEXT NOT NULL,
    within_kpi INTEGER,
    breaches_json TEXT NOT NULL
  );
  CREATE INDEX mm_samples_mandate_timestamp ON mm_samples(mandate_id, timestamp);

  CREATE TABLE mm_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandate_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    streak_samples INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    delivered INTEGER NOT NULL,
    response_status INTEGER,
    error TEXT
  );
  CREATE INDEX mm_alerts_mandate_timestamp ON mm_alerts(mandate_id, timestamp);
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

export interface MigrationResult {
  /** Version found before migrating (0 for a fresh database). */
  from: number
  /** Version after migrating (always SCHEMA_VERSION). */
  to: number
}

/** Creates `schema_version` when missing and applies every pending migration in one transaction. */
export function applyMigrations(db: DatabaseSync, now: () => number): MigrationResult {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
  )
  const from = currentVersion(db)
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `db: database schema version ${from} is newer than this build (${SCHEMA_VERSION}); upgrade depthwatch`,
    )
  }
  if (from === SCHEMA_VERSION) return { from, to: from }

  const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
  db.exec('BEGIN IMMEDIATE')
  try {
    for (let version = from + 1; version <= SCHEMA_VERSION; version++) {
      const sql = MIGRATIONS[version - 1]
      if (sql === undefined) throw new Error(`db: migration ${version} is missing`)
      db.exec(sql)
      record.run(version, now())
    }
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
  return { from, to: SCHEMA_VERSION }
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get()
  const version = row?.version
  if (typeof version === 'number') return version
  if (typeof version === 'bigint') return toCount(version)
  return 0
}
