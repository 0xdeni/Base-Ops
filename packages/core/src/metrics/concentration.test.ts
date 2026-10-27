import { describe, expect, it } from 'vitest'
import { maxBigint, minBigint, WAD } from '../math.js'
import { positionsShareOfPool } from '../mm/attribution.js'
import { buildConcentratedState, buildConstantProductState } from '../testing.js'
import { getSqrtRatioAtTick } from '../tickMath.js'
import type { Address, Position } from '../types.js'
import {
  bandSqrtBounds,
  clipBandToKnownTicks,
  computeConcentration,
  computeConcentrationForReserves,
  poolBandWeight,
  positionBandWeight,
  positionsBandWeight,
} from './concentration.js'

const L = 10n ** 21n
const owner = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}` as Address

function position(
  ownerIndex: number,
  tickLower: number,
  tickUpper: number,
  liquidity = L,
): Position {
  return { owner: owner(ownerIndex), tickLower, tickUpper, liquidity, tokenId: BigInt(ownerIndex) }
}

function share(weight: bigint, total: bigint): number {
  return Number((weight * WAD) / total) / 1e18
}

describe('bandSqrtBounds', () => {
  it('brackets the price by ±band % in price space', () => {
    const sqrt = getSqrtRatioAtTick(0)
    const band = bandSqrtBounds(sqrt, 5)
    expect(Number(band.lower) / Number(sqrt)).toBeCloseTo(Math.sqrt(0.95), 12)
    expect(Number(band.upper) / Number(sqrt)).toBeCloseTo(Math.sqrt(1.05), 12)
    expect(() => bandSqrtBounds(sqrt, 0)).toThrow(RangeError)
  })
})

describe('range HHI', () => {
  it('a single full-width range is fully concentrated and fully active', () => {
    const state = buildConcentratedState({
      positions: [{ tickLower: -6000, tickUpper: 6000, liquidity: L }],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const m = computeConcentration(state, null)
    expect(m).toEqual({ bandPct: 5, rangeHhi: 1, activeRangeShare: 1, owners: null })
  })

  it('weights ranges by L·Δ√P clipped to the band', () => {
    const state = buildConcentratedState({
      positions: [
        { tickLower: -6000, tickUpper: 6000, liquidity: L },
        { tickLower: -60, tickUpper: 60, liquidity: L },
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    const band = bandSqrtBounds(state.sqrtPriceX96, 5)
    const lo = getSqrtRatioAtTick(-60)
    const hi = getSqrtRatioAtTick(60)
    const w = [L * (lo - band.lower), 2n * L * (hi - lo), L * (band.upper - hi)]
    const total = w.reduce((a, b) => a + b, 0n)
    const shares = w.map((x) => share(x, total))
    const expectedHhi = shares.reduce((a, s) => a + s * s, 0)
    const m = computeConcentration(state, null)
    expect(m.rangeHhi).toBeCloseTo(expectedHhi, 12)
    expect(m.activeRangeShare).toBeCloseTo(shares[1] ?? 0, 12)
    expect(m.owners).toBeNull()
  })

  it('ignores liquidity outside the band and respects a custom band', () => {
    const state = buildConcentratedState({
      positions: [
        { tickLower: -6000, tickUpper: 6000, liquidity: L },
        { tickLower: 1200, tickUpper: 1800, liquidity: 100n * L }, // > +5 %, outside the band
      ],
      tick: 0,
      feePips: 3000,
      tickSpacing: 60,
    })
    expect(computeConcentration(state, null).rangeHhi).toBe(1)
    // a 20 % band includes it
    const wide = computeConcentration(state, null, 20)
    expect(wide.bandPct).toBe(20)
    expect(wide.rangeHhi).toBeLessThan(1)
    expect(wide.activeRangeShare).toBeLessThan(0.5)
  })

  it('never extrapolates beyond the known tick bounds', () => {
    const state = {
      ...buildConcentratedState({
        positions: [{ tickLower: -6000, tickUpper: 6000, liquidity: L }],
        tick: 0,
        feePips: 3000,
        tickSpacing: 60,
      }),
      tickLowerBound: -100,
      tickUpperBound: 100,
    }
    const m = computeConcentration(state, null)
    expect(m.rangeHhi).toBe(1)
    expect(m.activeRangeShare).toBe(1)
  })

  it('an empty band yields rangeHhi 1 and no active share', () => {
    const state = buildConcentratedState({ positions: [], tick: 0, feePips: 3000, tickSpacing: 60 })
    const m = computeConcentration(state, [])
    expect(m.rangeHhi).toBe(1)
    expect(m.activeRangeShare).toBe(0)
    expect(m.owners).toEqual({ count: 0, top1Share: 0, top3Share: 0, hhi: 0 })
  })
})

describe('owner concentration', () => {
  const base = { tick: 0, feePips: 3000, tickSpacing: 60 }

  it('single owner → top1 = 1, hhi = 1', () => {
    const state = buildConcentratedState({
      ...base,
      positions: [{ tickLower: -600, tickUpper: 600, liquidity: L }],
    })
    const m = computeConcentration(state, [position(1, -600, 600)])
    expect(m.owners).toEqual({ count: 1, top1Share: 1, top3Share: 1, hhi: 1 })
  })

  it('n equal owners → shares 1/n', () => {
    const positions = [1, 2, 3, 4].map((i) => position(i, -600, 600))
    const state = buildConcentratedState({
      ...base,
      positions: positions.map((p) => ({
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        liquidity: p.liquidity,
      })),
    })
    const m = computeConcentration(state, positions)
    expect(m.owners?.count).toBe(4)
    expect(m.owners?.top1Share).toBeCloseTo(0.25, 12)
    expect(m.owners?.top3Share).toBeCloseTo(0.75, 12)
    expect(m.owners?.hhi).toBeCloseTo(0.25, 12)
  })

  it('aggregates by owner case-insensitively and clips to the band', () => {
    const state = buildConcentratedState({
      ...base,
      positions: [
        { tickLower: -6000, tickUpper: 6000, liquidity: L },
        { tickLower: -60, tickUpper: 60, liquidity: L },
        { tickLower: 3000, tickUpper: 4000, liquidity: L },
      ],
    })
    const upper = owner(1).toUpperCase().replace('0X', '0x') as Address
    const positions: Position[] = [
      { ...position(1, -6000, 6000) },
      { ...position(1, -60, 60), owner: upper },
      position(2, 3000, 4000), // outside the ±5 % band: no weight
      position(3, -600, 600, 0n), // zero liquidity: ignored
    ]
    const m = computeConcentration(state, positions)
    expect(m.owners?.count).toBe(1)
    expect(m.owners?.top1Share).toBe(1)
    expect(m.owners?.hhi).toBe(1)
  })

  it('clipped widths decide the shares', () => {
    const state = buildConcentratedState({
      ...base,
      positions: [
        { tickLower: -6000, tickUpper: 6000, liquidity: L },
        { tickLower: -60, tickUpper: 60, liquidity: L },
      ],
    })
    const band = bandSqrtBounds(state.sqrtPriceX96, 5)
    const wide =
      L *
      (minBigint(getSqrtRatioAtTick(6000), band.upper) -
        maxBigint(getSqrtRatioAtTick(-6000), band.lower))
    const narrow = L * (getSqrtRatioAtTick(60) - getSqrtRatioAtTick(-60))
    const total = wide + narrow
    const m = computeConcentration(state, [position(1, -6000, 6000), position(2, -60, 60)])
    expect(m.owners?.count).toBe(2)
    expect(m.owners?.top1Share).toBeCloseTo(share(wide, total), 12)
    expect(m.owners?.top3Share).toBeCloseTo(1, 12)
    expect(m.owners?.hhi).toBeCloseTo(share(wide, total) ** 2 + share(narrow, total) ** 2, 12)
  })

  it('weighs owners with the band clipped to the known ticks, so Σ owners = pool', () => {
    // Known ticks ±300 are narrower than the ±5 % band (≈ ±488 ticks): positions reaching past
    // the known ticks must not be over-weighted relative to narrow ones.
    const wide = position(1, -6000, 6000)
    const positions = [
      wide,
      position(2, 600, 1200), // outside both the band and the known ticks
      position(3, -120, 120),
      position(4, -60, 3000),
    ]
    const state = {
      ...buildConcentratedState({ ...base, positions }),
      tickLowerBound: -300,
      tickUpperBound: 300,
    }
    const band = bandSqrtBounds(state.sqrtPriceX96, 5)
    const clipped = clipBandToKnownTicks(state, band)
    expect(clipped.lower).toBeGreaterThan(band.lower)
    expect(clipped.upper).toBeLessThan(band.upper)
    const w1 = L * (clipped.upper - clipped.lower)
    const w3 = L * (getSqrtRatioAtTick(120) - getSqrtRatioAtTick(-120))
    const w4 = L * (clipped.upper - getSqrtRatioAtTick(-60))
    const total = poolBandWeight(state, band)
    expect(w1 + w3 + w4).toBe(total)
    expect(positionsBandWeight(positions, clipped)).toBe(total)

    const m = computeConcentration(state, positions, 5)
    expect(m.owners?.count).toBe(3)
    expect(m.owners?.top1Share).toBeCloseTo(share(w1, total), 12)
    expect(m.owners?.top3Share).toBeCloseTo(1, 12)
    expect(m.owners?.hhi).toBeCloseTo(
      share(w1, total) ** 2 + share(w3, total) ** 2 + share(w4, total) ** 2,
      12,
    )
    // The same owner reads the same share through the attribution helper.
    expect(m.owners?.top1Share).toBeCloseTo(positionsShareOfPool(state, [wide], 5) ?? -1, 12)
    // With the raw (unclipped) band the wide position would be over-weighted.
    expect(positionsBandWeight(positions, band)).toBeGreaterThan(total)
  })
})

describe('computeConcentrationForReserves', () => {
  it('is a single full range with unknown owners', () => {
    const m = computeConcentrationForReserves(buildConstantProductState(1n, 1n, 3000))
    expect(m).toEqual({ bandPct: 5, rangeHhi: 1, activeRangeShare: 1, owners: null })
    expect(
      computeConcentrationForReserves(buildConstantProductState(1n, 1n, 3000), 2).bandPct,
    ).toBe(2)
  })
})

describe('band weights', () => {
  const base = { tick: 0, feePips: 3000, tickSpacing: 60 }
  const sqrt = getSqrtRatioAtTick(0)
  const band = bandSqrtBounds(sqrt, 5)

  it('positionBandWeight is liquidity × the clipped √P width', () => {
    const lo = getSqrtRatioAtTick(-60)
    const hi = getSqrtRatioAtTick(60)
    expect(positionBandWeight(position(1, -60, 60), band)).toBe(L * (hi - lo))
    expect(positionBandWeight(position(1, -6000, 6000), band)).toBe(L * (band.upper - band.lower))
    expect(positionBandWeight(position(1, -6000, 60), band)).toBe(L * (hi - band.lower))
    expect(positionBandWeight(position(1, 3000, 4000), band)).toBe(0n)
    expect(positionBandWeight(position(1, -60, 60, 0n), band)).toBe(0n)
    expect(positionBandWeight({ ...position(1, 60, 60) }, band)).toBe(0n)
    expect(positionsBandWeight([position(1, -60, 60), position(2, -6000, 60)], band)).toBe(
      L * (hi - lo) + L * (hi - band.lower),
    )
    expect(positionsBandWeight([], band)).toBe(0n)
  })

  it('poolBandWeight equals the positions weight of the pool and the range weights', () => {
    const positions = [position(1, -6000, 6000), position(2, -60, 60), position(3, 3000, 4000)]
    const state = buildConcentratedState({ ...base, positions })
    const lo = getSqrtRatioAtTick(-60)
    const hi = getSqrtRatioAtTick(60)
    const ranges = [L * (lo - band.lower), 2n * L * (hi - lo), L * (band.upper - hi)]
    const total = ranges.reduce((a, b) => a + b, 0n)
    expect(poolBandWeight(state, band)).toBe(total)
    expect(positionsBandWeight(positions, band)).toBe(total)
    expect(poolBandWeight(buildConcentratedState({ ...base, positions: [] }), band)).toBe(0n)
  })

  it('clips to the known ticks', () => {
    const state = {
      ...buildConcentratedState({ ...base, positions: [position(1, -6000, 6000)] }),
      tickLowerBound: -100,
      tickUpperBound: 100,
    }
    const clipped = clipBandToKnownTicks(state, band)
    expect(clipped).toEqual({ lower: getSqrtRatioAtTick(-100), upper: getSqrtRatioAtTick(101) })
    expect(poolBandWeight(state, band)).toBe(L * (clipped.upper - clipped.lower))
    expect(positionsBandWeight([position(1, -6000, 6000)], clipped)).toBe(
      poolBandWeight(state, band),
    )
    const wide = buildConcentratedState({ ...base, positions: [position(1, -6000, 6000)] })
    expect(clipBandToKnownTicks(wide, band)).toEqual(band)
    const far = { ...wide, tickLowerBound: 1000, tickUpperBound: 2000 }
    const empty = clipBandToKnownTicks(far, band)
    expect(empty.upper <= empty.lower).toBe(true)
    expect(poolBandWeight(far, band)).toBe(0n)
  })
})
