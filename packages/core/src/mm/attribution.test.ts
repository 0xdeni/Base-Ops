import { describe, expect, it } from 'vitest'
import { WAD } from '../math.js'
import { bandSqrtBounds, poolBandWeight, positionsBandWeight } from '../metrics/concentration.js'
import { computeDepth, depthToUsd } from '../metrics/depth.js'
import { computeEffectiveSpread } from '../metrics/spread.js'
import {
  buildConcentratedState,
  buildConstantProductState,
  buildStableSwapState,
  makeToken,
} from '../testing.js'
import type { Address, ConcentratedState, PoolState, Position } from '../types.js'
import {
  type AttributionInput,
  buildMmConcentratedState,
  buildMmReserveState,
  computeMmAttribution,
  filterPositionsByOwners,
  lpShare,
  lpShareOfPool,
  positionsShareOfPool,
} from './attribution.js'
import type { LpHolding, MandateKpis } from './types.js'

const L = 10n ** 24n
const tokenA = makeToken('AAA', 18)
const tokenB = makeToken('BBB', 18)
const owner = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address
const kpis: MandateKpis = {
  minDepthUsd: 1_000,
  bandPct: 2,
  maxSpreadBps: 50,
  spreadNotionalUsd: 10_000,
  targetUptime: 0.95,
}
const base = { tick: 0, feePips: 3000, tickSpacing: 60, blockNumber: 77n, timestamp: 1_700_000_123 }

function position(
  ownerIndex: number,
  tickLower: number,
  tickUpper: number,
  liquidity = L,
): Position {
  return { owner: owner(ownerIndex), tickLower, tickUpper, liquidity, tokenId: BigInt(ownerIndex) }
}

function pool(positions: readonly Position[]): ConcentratedState {
  return buildConcentratedState({
    ...base,
    positions: positions.map((p) => ({
      tickLower: p.tickLower,
      tickUpper: p.tickUpper,
      liquidity: p.liquidity,
    })),
  })
}

function attribute(
  state: PoolState,
  mmState: PoolState | null,
  extra: Partial<AttributionInput> = {},
) {
  return computeMmAttribution({
    token0: tokenA,
    token1: tokenB,
    token0Usd: 1,
    token1Usd: 1,
    state,
    mmState,
    method: 'positions',
    holdings: 1,
    shareOfPool: 0.5,
    kpis,
    ...extra,
  })
}

const inside = position(1, -120, 120)
const outside = position(2, 600, 1200)
const straddling = position(3, -60, 3000)
const wide = position(4, -6000, 6000)
const all = [inside, outside, straddling, wide]

describe('filterPositionsByOwners', () => {
  it('keeps the positions of the given owners in input order, case-insensitively', () => {
    const upper = owner(3).toUpperCase().replace('0X', '0x') as Address
    const shouted = { ...straddling, owner: upper }
    const positions = [inside, outside, shouted, wide]
    expect(filterPositionsByOwners(positions, [owner(3), owner(1)])).toEqual([inside, shouted])
    expect(filterPositionsByOwners(positions, [upper])).toEqual([shouted])
    expect(filterPositionsByOwners(positions, [owner(9)])).toEqual([])
    expect(filterPositionsByOwners(positions, [])).toEqual([])
  })
})

describe('buildMmConcentratedState', () => {
  const state = pool(all)

  it('rebuilds ticks and active liquidity from the given positions only, copying the rest', () => {
    const mm = buildMmConcentratedState(state, [inside])
    expect(mm.ticks).toEqual([
      { index: -120, liquidityNet: L, liquidityGross: L },
      { index: 120, liquidityNet: -L, liquidityGross: L },
    ])
    expect(mm.liquidity).toBe(L)
    expect(state.liquidity).toBe(3n * L)
    const { ticks: _t, liquidity: _l, ...rest } = state
    expect(mm).toMatchObject(rest)
    expect(mm.tickLowerBound).toBe(-6000)
    expect(mm.tickUpperBound).toBe(6000)
    expect(mm.blockNumber).toBe(77n)
  })

  it('is the same aggregation as buildConcentratedState', () => {
    const subset = [outside, straddling]
    const mm = buildMmConcentratedState(state, subset)
    const reference = buildConcentratedState({
      ...base,
      positions: subset.map(({ tickLower, tickUpper, liquidity }) => ({
        tickLower,
        tickUpper,
        liquidity,
      })),
      tickLowerBound: state.tickLowerBound,
      tickUpperBound: state.tickUpperBound,
    })
    expect(mm).toEqual(reference)
  })

  it('has no active liquidity when nothing straddles the tick', () => {
    expect(buildMmConcentratedState(state, [outside]).liquidity).toBe(0n)
    const empty = buildMmConcentratedState(state, [])
    expect(empty.liquidity).toBe(0n)
    expect(empty.ticks).toEqual([])
  })

  it('rejects an inverted position', () => {
    expect(() => buildMmConcentratedState(state, [position(1, 60, 60)])).toThrow(RangeError)
  })
})

describe('lpShare / buildMmReserveState', () => {
  const holding = (balance: bigint, staked: bigint, totalSupply = 100n): LpHolding => ({
    address: owner(1),
    balance,
    staked,
    totalSupply,
  })

  it('sums wallet and staked balances over the supply, clamped to 1', () => {
    expect(lpShare([holding(40n, 10n)])).toEqual({ num: 50n, den: 100n })
    expect(lpShare([holding(40n, 10n), { ...holding(25n, 0n), address: owner(2) }])).toEqual({
      num: 75n,
      den: 100n,
    })
    expect(lpShare([holding(90n, 20n)])).toEqual({ num: 100n, den: 100n })
    expect(lpShareOfPool([holding(40n, 10n)])).toBe(0.5)
  })

  it('is null without holdings or without supply', () => {
    expect(lpShare([])).toBeNull()
    expect(lpShare([holding(1n, 0n, 0n)])).toBeNull()
    expect(lpShareOfPool([])).toBeNull()
  })

  it('scales both reserves by the share and keeps everything else', () => {
    const cp = buildConstantProductState(10n ** 24n, 2n * 10n ** 24n, 3000, { blockNumber: 9n })
    const mm = buildMmReserveState(cp, [holding(40n, 10n)])
    expect(mm).toEqual({ ...cp, reserve0: 5n * 10n ** 23n, reserve1: 10n ** 24n })
    const stable = buildStableSwapState(10n ** 24n, 10n ** 12n, 18, 6, 500)
    const mmStable = buildMmReserveState(stable, [holding(1n, 0n, 4n)])
    expect(mmStable).toEqual({ ...stable, reserve0: 25n * 10n ** 22n, reserve1: 25n * 10n ** 10n })
    expect(buildMmReserveState(cp, [])).toEqual({ ...cp, reserve0: 0n, reserve1: 0n })
  })
})

describe('positionsShareOfPool', () => {
  const state = pool(all)
  const band = bandSqrtBounds(state.sqrtPriceX96, 2)

  it('equals the concentration weight ratio', () => {
    const expected = Number(
      (positionsBandWeight([inside], band) * WAD) / poolBandWeight(state, band),
    )
    expect(positionsShareOfPool(state, [inside], 2)).toBe(expected / 1e18)
    expect(positionsShareOfPool(state, all, 2)).toBe(1)
    expect(positionsShareOfPool(state, [], 2)).toBe(0)
    expect(positionsShareOfPool(state, [outside], 2)).toBe(0)
    expect(positionsShareOfPool(state, [outside], 10)).toBeGreaterThan(0)
  })

  it('is null for a pool without in-band weight', () => {
    expect(positionsShareOfPool(pool([]), [], 2)).toBeNull()
    expect(positionsShareOfPool(pool([outside]), [outside], 2)).toBeNull()
  })
})

describe('computeMmAttribution', () => {
  const state = pool(all)

  it('reproduces the whole pool from the full position set', () => {
    const attr = attribute(state, buildMmConcentratedState(state, all), { holdings: 4 })
    expect(attr.method).toBe('positions')
    expect(attr.holdings).toBe(4)
    expect(attr.shareOfPool).toBe(0.5)
    expect(attr.depthUpUsd).toBe(attr.poolDepthUpUsd)
    expect(attr.depthDownUsd).toBe(attr.poolDepthDownUsd)
    expect(attr.spreadBps).toBe(attr.poolSpreadBps)
    expect(attr.poolDepthUpUsd).toBeGreaterThan(0)
    expect(attr.poolSpreadBps).toBeGreaterThan(0)
  })

  it('measures a position inside the band on its own (depth bounded by its range)', () => {
    const mmState = buildMmConcentratedState(state, [inside])
    const attr = attribute(state, mmState)
    const level = depthToUsd(computeDepth(mmState, 18, 18, [2]), tokenA, tokenB, 1, 1)[0]
    expect(attr.depthUpUsd).toBe(level?.upUsd ?? null)
    expect(attr.depthDownUsd).toBe(level?.downUsd ?? null)
    // ±1.2 % of range at L = 1e24: 1e6 · (1.0001^60 − 1) grossed up for the 0.3 % fee ≈ 6035.84 a side
    expect(attr.depthUpUsd).toBeCloseTo((1e6 * (1.0001 ** 60 - 1)) / 0.997, 2)
    expect(attr.depthDownUsd).toBeCloseTo((1e6 * (1.0001 ** 60 - 1)) / 0.997, 2)
    expect(attr.depthUpUsd ?? 0).toBeLessThan(attr.poolDepthUpUsd ?? 0)
    // $10k pushes the price past tick 120: the buy leg is incomplete → spread infeasible.
    expect(attr.spreadBps).toBeNull()
    expect(attr.poolSpreadBps).toBe(
      computeEffectiveSpread(state, tokenA, tokenB, 1, 1, [10_000])[0]?.spreadBps ?? null,
    )
  })

  it('a straddling position contributes its clipped part', () => {
    const mmState = buildMmConcentratedState(state, [straddling])
    const attr = attribute(state, mmState)
    // [-60, 3000] covers the whole way up (reached) but only 0.6 % of the way down (fee grossed up).
    expect(attr.depthUpUsd).toBeCloseTo((1e6 * (Math.sqrt(1.02) - 1)) / 0.997, 2)
    expect(attr.depthDownUsd).toBeCloseTo((1e6 * (1.0001 ** 30 - 1)) / 0.997, 2)
    // the $10k sell leg runs past tick −60: the spread is infeasible on this position alone
    expect(attr.spreadBps).toBeNull()
    const wideAttr = attribute(state, buildMmConcentratedState(state, [wide]))
    expect(wideAttr.spreadBps).not.toBeNull()
    expect(wideAttr.spreadBps ?? 0).toBeGreaterThan(wideAttr.poolSpreadBps ?? 0)
  })

  it('a position outside the band gives zero depth', () => {
    const attr = attribute(state, buildMmConcentratedState(state, [outside]))
    expect(attr.depthUpUsd).toBe(0)
    expect(attr.depthDownUsd).toBe(0)
    expect(attr.spreadBps).toBeNull()
  })

  it('without an mm state: zero depth on priced sides, null spread, no holdings', () => {
    const attr = attribute(state, null, { holdings: 3, method: 'none', shareOfPool: null })
    expect(attr).toMatchObject({
      method: 'none',
      holdings: 0,
      shareOfPool: null,
      depthUpUsd: 0,
      depthDownUsd: 0,
      spreadBps: null,
    })
    expect(attr.poolDepthUpUsd).toBeGreaterThan(0)
    expect(attr.poolSpreadBps).toBeGreaterThan(0)
    const noToken1 = attribute(state, null, { token1Usd: null })
    expect(noToken1.depthUpUsd).toBeNull()
    expect(noToken1.depthDownUsd).toBe(0)
    expect(noToken1.poolDepthUpUsd).toBeNull()
    expect(noToken1.poolSpreadBps).toBeNull()
    const noToken0 = attribute(state, null, { token0Usd: null })
    expect(noToken0.depthUpUsd).toBe(0)
    expect(noToken0.depthDownUsd).toBeNull()
  })

  it('an unpriced side is null with an mm state too', () => {
    const attr = attribute(state, buildMmConcentratedState(state, all), { token0Usd: null })
    expect(attr.depthUpUsd).toBeGreaterThan(0)
    expect(attr.depthDownUsd).toBeNull()
    expect(attr.poolDepthDownUsd).toBeNull()
    expect(attr.spreadBps).toBeNull()
  })

  it('scales reserve pools by the LP share', () => {
    const cp = buildConstantProductState(10n ** 24n, 10n ** 24n, 3000)
    const holdings: LpHolding[] = [
      { address: owner(1), balance: 40n, staked: 10n, totalSupply: 100n },
    ]
    const attr = attribute(cp, buildMmReserveState(cp, holdings), {
      method: 'lp-share',
      shareOfPool: lpShareOfPool(holdings),
    })
    expect(attr.method).toBe('lp-share')
    expect(attr.shareOfPool).toBe(0.5)
    expect((attr.depthUpUsd ?? 0) / (attr.poolDepthUpUsd ?? 1)).toBeCloseTo(0.5, 9)
    expect((attr.depthDownUsd ?? 0) / (attr.poolDepthDownUsd ?? 1)).toBeCloseTo(0.5, 9)
    expect(attr.spreadBps ?? 0).toBeGreaterThan(attr.poolSpreadBps ?? 0)
  })
})

/** Deterministic PRNG (mulberry32) for the property-style check. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('property: a pool made of N owners positions', () => {
  it('Σ owners positionsBandWeight = poolBandWeight; the full set reproduces the pool', () => {
    const rnd = mulberry32(20_251_023)
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
    for (let round = 0; round < 25; round++) {
      const owners = int(2, 6)
      const positions: Position[] = []
      for (let o = 1; o <= owners; o++) {
        for (let k = int(1, 3); k > 0; k--) {
          const tickLower = -3000 + 60 * int(0, 99)
          const tickUpper = tickLower + 60 * int(1, 50)
          positions.push(position(o, tickLower, tickUpper, BigInt(int(1, 1_000_000)) * 10n ** 12n))
        }
      }
      const state = pool(positions)
      for (const bandPct of [2, 5]) {
        const band = bandSqrtBounds(state.sqrtPriceX96, bandPct)
        const total = poolBandWeight(state, band)
        let sum = 0n
        let shares = 0
        for (let o = 1; o <= owners; o++) {
          const mine = filterPositionsByOwners(positions, [owner(o)])
          sum += positionsBandWeight(mine, band)
          if (total > 0n) shares += positionsShareOfPool(state, mine, bandPct) ?? 0
          const attr = attribute(state, buildMmConcentratedState(state, mine), {
            kpis: { ...kpis, bandPct },
          })
          expect(attr.depthUpUsd ?? 0).toBeLessThanOrEqual(attr.poolDepthUpUsd ?? 0)
          expect(attr.depthDownUsd ?? 0).toBeLessThanOrEqual(attr.poolDepthDownUsd ?? 0)
        }
        expect(sum).toBe(total)
        expect(positionsBandWeight(positions, band)).toBe(total)
        if (total > 0n) expect(shares).toBeCloseTo(1, 9)
      }
      const mmState = buildMmConcentratedState(state, positions)
      expect(mmState).toEqual(state)
      const attr = attribute(state, mmState, { holdings: positions.length })
      expect(attr.depthUpUsd).toBe(attr.poolDepthUpUsd)
      expect(attr.depthDownUsd).toBe(attr.poolDepthDownUsd)
      expect(attr.spreadBps).toBe(attr.poolSpreadBps)
    }
  })
})
