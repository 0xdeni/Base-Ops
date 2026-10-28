/**
 * Aero venues beside the seed (`seed.ts`, which stays as it is): Aero's AERO token, an `aero-v2`
 * AERO/USDC pool and an `aero-slipstream` WETH/USDC pool, each with two snapshots (the second
 * Slipstream snapshot read another fee, as a block's dynamic fee does) and a score. The seed's
 * Aerodrome pools hold Aerodrome's AERO (`seed.tokens.AERO`), which answers the same symbol.
 *
 * `scoreAeroV2: false` leaves the AERO/USDC pool unscored, so Aero's AERO is outside the set of
 * scored tokens that labels are told apart in (core `tokenLabel`).
 */
import type { PoolMeta, PoolSnapshot, TokenInfo } from '@depthwatch/core'
import { type Database, fixtureAddress, fixturePool, fixtureScore } from '@depthwatch/db'
import { buildSnapshot } from './builders.js'
import { HOUR } from './constants.js'
import type { Seed } from './seed.js'
import { blockAt } from './timeline.js'

/** Aero's AERO on Base (docs/research/base-contracts.md, `aero_token`). */
export const SEED_AERO_NEW: TokenInfo = {
  address: '0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee',
  symbol: 'AERO',
  name: 'Aero',
  decimals: 18,
}

export interface AeroSeed {
  token: TokenInfo
  /** Aero v2 AERO(Aero)/USDC volatile, 30 bps. */
  aeroUsdcAeroV2: PoolMeta
  /** Aero Slipstream WETH/USDC, tick spacing 50; its fee is the latest snapshot's reading. */
  wethUsdcAeroSlip: PoolMeta
  /** Every snapshot inserted, keyed by pool id, ascending. */
  snapshots: Map<string, PoolSnapshot[]>
}

const AERO_NEW_USD = 0.9

export function seedAeroPools(seed: Seed): Omit<AeroSeed, 'snapshots'> {
  const { USDC, WETH } = seed.tokens
  return {
    token: SEED_AERO_NEW,
    aeroUsdcAeroV2: fixturePool({
      dex: 'aero-v2',
      kind: 'constant-product',
      address: fixtureAddress(0x2001),
      token0: SEED_AERO_NEW,
      token1: USDC,
      feePips: 3000,
      tickSpacing: null,
      createdAtBlock: 52_884_700n,
    }),
    wethUsdcAeroSlip: fixturePool({
      dex: 'aero-slipstream',
      address: fixtureAddress(0x2002),
      token0: WETH,
      token1: USDC,
      feePips: 465,
      tickSpacing: 50,
      createdAtBlock: 52_885_483n,
    }),
  }
}

/** Adds the Aero token and pools to a seeded database (`seedDatabase`). */
export function seedAeroTokens(
  db: Database,
  seed: Seed,
  opts: { scoreAeroV2?: boolean } = {},
): AeroSeed {
  const pools = seedAeroPools(seed)
  const now = seed.now
  const at = (timestamp: number) => ({ timestamp, blockNumber: blockAt(now, timestamp) })
  const v2 = pools.aeroUsdcAeroV2
  const slip = pools.wethUsdcAeroSlip
  const v2Snapshots = [now - HOUR, now].map((timestamp) =>
    buildSnapshot({
      pool: v2,
      ...at(timestamp),
      price: AERO_NEW_USD,
      decimals0: 18,
      decimals1: 6,
      token0Usd: AERO_NEW_USD,
      token1Usd: 1,
      tvlUsd: 2_400_000,
      depth2Usd: 80_000,
      spread10kBps: 70,
      ownerTop1Share: null,
    }),
  )
  // Two blocks, two fees: what a Slipstream pool's `fee()` reads from one block to the next.
  const slipSnapshots = [
    { timestamp: now - HOUR, feePips: 2055 },
    { timestamp: now, feePips: 465 },
  ].map(({ timestamp, feePips }) =>
    buildSnapshot({
      pool: slip,
      ...at(timestamp),
      feePips,
      price: 3000.25,
      decimals0: 18,
      decimals1: 6,
      token0Usd: 3000.25,
      token1Usd: 1,
      tvlUsd: 9_000_000,
      depth2Usd: 600_000,
      spread10kBps: 12,
      ownerTop1Share: null,
    }),
  )
  db.transaction(() => {
    db.pools.upsertMany([v2, slip])
    db.pools.setTracked([v2.id, slip.id], true)
    db.snapshots.insertMany([...v2Snapshots, ...slipSnapshots])
    if (opts.scoreAeroV2 !== false)
      db.scores.upsert(
        fixtureScore({
          poolId: v2.id,
          timestamp: now,
          healthTotal: 58,
          depth2Usd: 80_000,
          volume24hUsd: 400_000,
          gapScore: 34.9,
        }),
      )
    db.scores.upsert(
      fixtureScore({
        poolId: slip.id,
        timestamp: now,
        healthTotal: 74,
        depth2Usd: 600_000,
        volume24hUsd: 1_500_000,
        gapScore: 19.9,
      }),
    )
  })
  return {
    ...pools,
    snapshots: new Map([
      [v2.id, v2Snapshots],
      [slip.id, slipSnapshots],
    ]),
  }
}
