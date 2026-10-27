/**
 * The tokens and pools of the seed data set (metadata only; `seed.ts` adds snapshots, scores,
 * volume and prices). Addresses of the extra tokens are their real Base mainnet addresses,
 * lowercase; pool addresses are deterministic fixtures.
 */
import type { PoolMeta, TokenInfo } from '@depthwatch/core'
import {
  FIXTURE_AERO,
  FIXTURE_USDC,
  FIXTURE_WETH,
  fixtureAddress,
  fixturePool,
} from '@depthwatch/db'

export const SEED_DEGEN: TokenInfo = {
  address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
  symbol: 'DEGEN',
  name: 'Degen',
  decimals: 18,
}
export const SEED_BRETT: TokenInfo = {
  address: '0x532f27101965dd16442e59d40670faf5ebb142e4',
  symbol: 'BRETT',
  name: 'Brett',
  decimals: 18,
}
export const SEED_TOSHI: TokenInfo = {
  address: '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4',
  symbol: 'TOSHI',
  name: 'Toshi',
  decimals: 18,
}

export interface SeedTokens {
  WETH: TokenInfo
  USDC: TokenInfo
  AERO: TokenInfo
  DEGEN: TokenInfo
  BRETT: TokenInfo
  TOSHI: TokenInfo
}

export interface SeedPools {
  /** Uniswap v3 WETH/USDC 0.05 %: deep, tight, grade A. */
  wethUsdcV3: PoolMeta
  /** Aerodrome v2 AERO/USDC volatile: no owner data, grade C, high turnover. */
  aeroUsdcV2: PoolMeta
  /** Uniswap v4 WETH/DEGEN with hooks: thin, grade D, top of the gaps feed. */
  wethDegenV4: PoolMeta
  /** Aerodrome Slipstream WETH/AERO: grade B but 24 h volume below the gaps floor. */
  wethAeroSlip: PoolMeta
  /** Uniswap v3 DEGEN/USDC 1 %: discovered only (untracked, no snapshot, no score). */
  usdcDegenV3: PoolMeta
  /** Uniswap v3 BRETT/TOSHI: unpriced, so depth / spread / volume / gap are null, grade F. */
  brettToshiV3: PoolMeta
  /** Aerodrome Slipstream USDC/AERO: tiny, volume exactly on the $10k gaps floor. */
  aeroUsdcSlip: PoolMeta
}

export function seedTokens(): SeedTokens {
  return {
    WETH: FIXTURE_WETH,
    USDC: FIXTURE_USDC,
    AERO: FIXTURE_AERO,
    DEGEN: SEED_DEGEN,
    BRETT: SEED_BRETT,
    TOSHI: SEED_TOSHI,
  }
}

export function seedPools(t: SeedTokens): SeedPools {
  return {
    wethUsdcV3: fixturePool({
      address: fixtureAddress(0x1001),
      token0: t.WETH,
      token1: t.USDC,
      feePips: 500,
      tickSpacing: 10,
      createdAtBlock: 2_000_000n,
    }),
    aeroUsdcV2: fixturePool({
      dex: 'aerodrome-v2',
      kind: 'constant-product',
      address: fixtureAddress(0x1002),
      token0: t.AERO,
      token1: t.USDC,
      feePips: 3000,
      tickSpacing: null,
      createdAtBlock: 3_200_000n,
    }),
    wethDegenV4: fixturePool({
      dex: 'uniswap-v4',
      address: null,
      poolId: `0x${'7a'.repeat(32)}`,
      token0: t.WETH,
      token1: t.DEGEN,
      feePips: 3000,
      tickSpacing: 60,
      hooks: fixtureAddress(0x40c0),
      createdAtBlock: 25_350_000n,
    }),
    wethAeroSlip: fixturePool({
      dex: 'aerodrome-slipstream',
      address: fixtureAddress(0x1004),
      token0: t.WETH,
      token1: t.AERO,
      feePips: 500,
      tickSpacing: 100,
      createdAtBlock: 13_900_000n,
    }),
    usdcDegenV3: fixturePool({
      address: fixtureAddress(0x1005),
      token0: t.DEGEN,
      token1: t.USDC,
      feePips: 10_000,
      tickSpacing: 200,
      createdAtBlock: 9_800_000n,
    }),
    brettToshiV3: fixturePool({
      address: fixtureAddress(0x1006),
      token0: t.BRETT,
      token1: t.TOSHI,
      feePips: 3000,
      tickSpacing: 60,
      createdAtBlock: 11_400_000n,
    }),
    aeroUsdcSlip: fixturePool({
      dex: 'aerodrome-slipstream',
      address: fixtureAddress(0x1007),
      token0: t.USDC,
      token1: t.AERO,
      feePips: 500,
      tickSpacing: 50,
      createdAtBlock: 14_100_000n,
    }),
  }
}
