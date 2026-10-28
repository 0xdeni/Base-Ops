/**
 * Deterministic seed for API tests and offline demos: six tokens, seven pools across the four
 * DEXes, snapshot series, hourly volume, prices, positions, scores, and two market-maker
 * mandates with their samples (`seedMandates.ts`: one `ok`, one `breached`).
 *
 * Everything is anchored on `SEED_NOW` so responses are reproducible. The pools cover the cases
 * the API has to handle: scored pools with and without owner data, an unpriced pool (null depth,
 * spread, volume and gap), a pool on the gaps-feed volume floor, a pool below it, and a pool that
 * is discovered but never snapshotted or scored.
 */
import type { MmSample, PoolMeta, PoolSnapshot, UnratedReason } from '@depthwatch/core'
import {
  type Database,
  fixtureAddress,
  fixtureHealth,
  fixturePosition,
  IN_MEMORY,
  openDatabase,
  type PoolScore,
} from '@depthwatch/db'
import {
  buildBuckets,
  buildGap,
  buildPersistence,
  buildSnapshot,
  humanToRaw,
  type SnapshotSpec,
} from './builders.js'
import { DAY, HOUR, SEED_BLOCK, SEED_NOW } from './constants.js'
import { type SeedMandates, seedMandates, seedMmSamples } from './seedMandates.js'
import { blockAt, series, wobble } from './timeline.js'
import { type SeedPools, type SeedTokens, seedPools, seedTokens } from './universe.js'

export { SEED_BLOCK, SEED_NOW } from './constants.js'
export type { SeedMandates } from './seedMandates.js'
export {
  SEED_MM_BREACHED_ID,
  SEED_MM_OK_ID,
  SEED_MM_OWNER_SLIP,
  SEED_MM_OWNERS_AERO,
} from './seedMandates.js'
export type { SeedPools, SeedTokens } from './universe.js'
export { SEED_BRETT, SEED_DEGEN, SEED_TOSHI } from './universe.js'

const WETH_USD = 3000.25
const AERO_USD = 1.2
const DEGEN_USD = 0.012

interface PoolSpec {
  pool: PoolMeta
  price: number
  token0Usd: number | null
  token1Usd: number | null
  tvlUsd: number | null
  depth2Usd: number | null
  depth2Token1?: number
  spread10kBps: number | null
  maxFeasibleUsd?: number
  ownerTop1Share: number | null
  volume24hUsd: number | null
  hourlyToken1?: number
  healthTotal: number
  /** Why the pool has no grade; absent when it is rated (both ±2 % sides at least $5,000). */
  unratedReason?: UnratedReason
  notes: string[]
  /** Snapshot timestamps, ascending. */
  timestamps: number[]
}

export interface Seed {
  now: number
  tokens: SeedTokens
  pools: SeedPools
  /** Ids of pools with a score row, in `SeedPools` order. */
  scoredIds: string[]
  /** Everything inserted, keyed by pool id, for assertions. */
  snapshots: Map<string, PoolSnapshot[]>
  scores: Map<string, PoolScore>
  /** The two registered mandates (one ok, one breached). */
  mandates: SeedMandates
  /** Every scorecard sample inserted, ascending, keyed by mandate id. */
  mmSamples: Map<string, MmSample[]>
}

export interface SeedOptions {
  /** Unix seconds the newest data is stamped with. Default SEED_NOW. */
  now?: number
}

function poolSpecs(now: number, p: SeedPools): PoolSpec[] {
  const recent = series(now, 2 * HOUR, HOUR)
  return [
    {
      pool: p.wethUsdcV3,
      price: WETH_USD,
      token0Usd: WETH_USD,
      token1Usd: 1,
      tvlUsd: 12_500_000,
      depth2Usd: 1_000_000,
      spread10kBps: 8,
      ownerTop1Share: 0.32,
      volume24hUsd: 2_000_000,
      healthTotal: 85,
      notes: [],
      timestamps: series(now, 8 * DAY, 2 * HOUR),
    },
    {
      pool: p.aeroUsdcV2,
      price: AERO_USD,
      token0Usd: AERO_USD,
      token1Usd: 1,
      tvlUsd: 4_000_000,
      depth2Usd: 150_000,
      spread10kBps: 35,
      ownerTop1Share: null,
      volume24hUsd: 900_000,
      healthTotal: 62,
      notes: ['concentration neutral: LP owners not indexed'],
      timestamps: recent,
    },
    {
      pool: p.wethDegenV4,
      price: WETH_USD / DEGEN_USD,
      token0Usd: WETH_USD,
      token1Usd: DEGEN_USD,
      tvlUsd: 600_000,
      depth2Usd: 12_000,
      spread10kBps: 180,
      maxFeasibleUsd: 10_000,
      ownerTop1Share: null,
      volume24hUsd: 300_000,
      healthTotal: 41,
      notes: [],
      timestamps: recent,
    },
    {
      pool: p.wethAeroSlip,
      price: WETH_USD / AERO_USD,
      token0Usd: WETH_USD,
      token1Usd: AERO_USD,
      tvlUsd: 2_200_000,
      depth2Usd: 400_000,
      spread10kBps: 15,
      ownerTop1Share: 0.55,
      volume24hUsd: 9_500,
      healthTotal: 70,
      notes: [],
      timestamps: recent,
    },
    {
      pool: p.brettToshiV3,
      price: 1.5,
      token0Usd: null,
      token1Usd: null,
      tvlUsd: null,
      depth2Usd: null,
      depth2Token1: 50_000,
      spread10kBps: null,
      ownerTop1Share: 0.8,
      volume24hUsd: null,
      hourlyToken1: 1_200,
      healthTotal: 22,
      unratedReason: 'unpriced',
      notes: ['depth unknown: no USD price', 'spread unknown: no USD price'],
      timestamps: recent,
    },
    {
      pool: p.aeroUsdcSlip,
      price: 1 / AERO_USD,
      token0Usd: 1,
      token1Usd: AERO_USD,
      tvlUsd: 30_000,
      depth2Usd: 2_000,
      spread10kBps: 95,
      maxFeasibleUsd: 10_000,
      ownerTop1Share: 0.9,
      volume24hUsd: 10_000,
      healthTotal: 48,
      unratedReason: 'thin',
      notes: [],
      timestamps: recent,
    },
  ]
}

function snapshotsFor(now: number, spec: PoolSpec): PoolSnapshot[] {
  return spec.timestamps.map((timestamp, index) => {
    const w = wobble(index)
    const last = index === spec.timestamps.length - 1
    const ladder: SnapshotSpec = {
      pool: spec.pool,
      timestamp,
      blockNumber: blockAt(now, timestamp),
      price: last ? spec.price : spec.price * w,
      decimals0: spec.pool.token0.decimals,
      decimals1: spec.pool.token1.decimals,
      token0Usd: spec.token0Usd,
      token1Usd: spec.token1Usd,
      tvlUsd: spec.tvlUsd === null ? null : last ? spec.tvlUsd : spec.tvlUsd * w,
      depth2Usd: spec.depth2Usd === null ? null : last ? spec.depth2Usd : spec.depth2Usd * w,
      depth2Token1: spec.depth2Token1,
      spread10kBps: spec.spread10kBps,
      maxFeasibleUsd: spec.maxFeasibleUsd,
      ownerTop1Share: spec.ownerTop1Share,
      activeLiquidity:
        spec.pool.kind === 'concentrated' ? humanToRaw(1_000_000 * w, 18) : undefined,
    }
    return buildSnapshot(ladder)
  })
}

function scoreFor(now: number, spec: PoolSpec, snapshots: PoolSnapshot[]): PoolScore {
  const priced = spec.depth2Usd !== null
  const in24h = snapshots.filter((s) => s.timestamp >= now - DAY).length
  const in7d = snapshots.filter((s) => s.timestamp >= now - 7 * DAY).length
  return {
    poolId: spec.pool.id,
    timestamp: now,
    health: fixtureHealth(
      spec.healthTotal,
      spec.notes,
      spec.unratedReason ?? null,
      spec.ownerTop1Share !== null
        ? 'owners'
        : spec.pool.kind === 'concentrated'
          ? 'ranges'
          : 'neutral',
    ),
    gap: buildGap(spec.volume24hUsd, spec.depth2Usd),
    persistence24h: buildPersistence(24, priced ? in24h : 0, spec.depth2Usd),
    persistence7d: buildPersistence(168, priced ? in7d : 0, spec.depth2Usd),
    volume24hUsd: spec.volume24hUsd,
    depth2Usd: spec.depth2Usd,
  }
}

/** Fills `db` with the seed data set. The database must be empty (or freshly opened). */
export function seedDatabase(db: Database, options: SeedOptions = {}): Seed {
  const now = options.now ?? SEED_NOW
  const tokens = seedTokens()
  const pools = seedPools(tokens)
  const specs = poolSpecs(now, pools)
  const latestHourStart = now - (now % HOUR)
  const snapshots = new Map<string, PoolSnapshot[]>()
  const scores = new Map<string, PoolScore>()
  const mandates = seedMandates(now, pools)
  const mmSamples = seedMmSamples(now, mandates)

  db.transaction(() => {
    db.tokens.upsertMany(Object.values(tokens))
    db.pools.upsertMany(Object.values(pools))
    db.pools.setTracked(
      specs.map((spec) => spec.pool.id),
      true,
    )

    for (const spec of specs) {
      const rows = snapshotsFor(now, spec)
      db.snapshots.insertMany(rows)
      snapshots.set(spec.pool.id, rows)
      const score = scoreFor(now, spec, rows)
      db.scores.upsert(score)
      scores.set(spec.pool.id, score)
      db.volume.upsertBuckets(
        buildBuckets({
          pool: spec.pool,
          latestHourStart,
          hours: 24,
          volume24hUsd: spec.volume24hUsd,
          price: spec.price,
          token0Usd: spec.token0Usd,
          token1Usd: spec.token1Usd,
          hourlyToken1: spec.hourlyToken1,
        }),
      )
    }

    // Discovered-only pool: a little recent volume, nothing else.
    db.volume.upsertBuckets(
      buildBuckets({
        pool: pools.usdcDegenV3,
        latestHourStart,
        hours: 2,
        volume24hUsd: 48_000,
        price: DEGEN_USD,
        token0Usd: DEGEN_USD,
        token1Usd: 1,
      }),
    )

    db.positions.replaceForPool(
      pools.wethUsdcV3.id,
      [
        fixturePosition({ owner: fixtureAddress(0xa1), tickLower: -887_220, tickUpper: 887_220 }),
        fixturePosition({
          owner: fixtureAddress(0xa2),
          tickLower: -201_000,
          tickUpper: -199_000,
          liquidity: humanToRaw(250_000, 18),
          tokenId: 2n,
        }),
        fixturePosition({
          owner: fixtureAddress(0xa3),
          tickLower: -200_500,
          tickUpper: -200_200,
          liquidity: humanToRaw(90_000, 18),
          tokenId: 3n,
        }),
      ],
      { updatedBlock: SEED_BLOCK },
    )

    db.prices.replaceAll(
      [
        { token: tokens.USDC.address, usd: 1, via: [] },
        { token: tokens.WETH.address, usd: WETH_USD, via: [pools.wethUsdcV3.id] },
        { token: tokens.AERO.address, usd: AERO_USD, via: [pools.aeroUsdcV2.id] },
        {
          token: tokens.DEGEN.address,
          usd: DEGEN_USD,
          via: [pools.wethDegenV4.id, pools.wethUsdcV3.id],
        },
      ],
      now,
    )

    for (const dex of ['uniswap-v3', 'uniswap-v4', 'aerodrome-v2', 'aerodrome-slipstream']) {
      db.syncState.setBigInt(`discover:${dex}:lastBlock`, SEED_BLOCK)
    }

    db.mandates.upsertMany(Object.values(mandates))
    for (const samples of mmSamples.values()) db.mmSamples.insertMany(samples)
  })

  return {
    now,
    tokens,
    pools,
    scoredIds: specs.map((spec) => spec.pool.id),
    snapshots,
    scores,
    mandates,
    mmSamples,
  }
}

/** Opens an in-memory database whose clock is fixed at the seed's `now`, and seeds it. */
export function createSeededDatabase(options: SeedOptions = {}): { db: Database; seed: Seed } {
  const now = options.now ?? SEED_NOW
  const db = openDatabase(IN_MEMORY, { now: () => now })
  const seed = seedDatabase(db, { now })
  return { db, seed }
}
