import { describe, expect, it } from 'vitest'
import { aggregatePositionTicks } from './positionTicks.js'

describe('aggregatePositionTicks', () => {
  it('nets liquidity at the range edges and sums the positions straddling the tick', () => {
    const agg = aggregatePositionTicks(
      [
        { tickLower: -600, tickUpper: 600, liquidity: 100n },
        { tickLower: -60, tickUpper: 600, liquidity: 50n },
        { tickLower: 600, tickUpper: 1200, liquidity: 7n },
        { tickLower: 1200, tickUpper: 1800, liquidity: 0n }, // zero liquidity: no tick
      ],
      0,
    )
    expect(agg).toEqual({
      ticks: [
        { index: -600, liquidityNet: 100n, liquidityGross: 100n },
        { index: -60, liquidityNet: 50n, liquidityGross: 50n },
        { index: 600, liquidityNet: -143n, liquidityGross: 157n },
        { index: 1200, liquidityNet: -7n, liquidityGross: 7n },
      ],
      liquidity: 150n,
      minTick: -600,
      maxTick: 1800,
    })
    // a position whose upper tick equals the current tick is not active
    expect(
      aggregatePositionTicks([{ tickLower: -60, tickUpper: 0, liquidity: 5n }], 0).liquidity,
    ).toBe(0n)
    expect(
      aggregatePositionTicks([{ tickLower: 0, tickUpper: 60, liquidity: 5n }], 0).liquidity,
    ).toBe(5n)
  })

  it('includes the current tick in the extremes and is empty without positions', () => {
    expect(aggregatePositionTicks([], 42)).toEqual({
      ticks: [],
      liquidity: 0n,
      minTick: 42,
      maxTick: 42,
    })
  })

  it('rejects inverted ranges and negative liquidity', () => {
    expect(() =>
      aggregatePositionTicks([{ tickLower: 10, tickUpper: 10, liquidity: 1n }], 0),
    ).toThrow(RangeError)
    expect(() =>
      aggregatePositionTicks([{ tickLower: 0, tickUpper: 10, liquidity: -1n }], 0),
    ).toThrow(RangeError)
  })
})
