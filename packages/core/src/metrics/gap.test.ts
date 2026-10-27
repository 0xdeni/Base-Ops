import { describe, expect, it } from 'vitest'
import { makeToken } from '../testing.js'
import { computeGap, GAP_FEED_MIN_VOLUME_USD } from './gap.js'
import { tvlUsd } from './tvl.js'

describe('computeGap', () => {
  it('turnover 1× → 0, 10× → 50, 100× → 100, capped beyond', () => {
    expect(computeGap(1_000, 1_000)).toEqual({
      volume24hUsd: 1_000,
      depth2Usd: 1_000,
      turnoverRatio: 1,
      gapScore: 0,
    })
    expect(computeGap(10_000, 1_000).gapScore).toBeCloseTo(50, 12)
    expect(computeGap(100_000, 1_000).gapScore).toBe(100)
    expect(computeGap(1_000_000, 1_000).gapScore).toBe(100)
    expect(computeGap(500, 1_000).gapScore).toBe(0)
    expect(computeGap(500, 1_000).turnoverRatio).toBe(0.5)
    expect(computeGap(0, 1_000).gapScore).toBe(0)
  })

  it('is null when volume or depth is unknown or depth is 0', () => {
    expect(computeGap(null, 1_000)).toEqual({
      volume24hUsd: null,
      depth2Usd: 1_000,
      turnoverRatio: null,
      gapScore: null,
    })
    expect(computeGap(1_000, null).gapScore).toBeNull()
    expect(computeGap(1_000, 0).gapScore).toBeNull()
    expect(computeGap(1_000, 0).turnoverRatio).toBeNull()
    expect(computeGap(Number.NaN, 1).gapScore).toBeNull()
    expect(GAP_FEED_MIN_VOLUME_USD).toBe(10_000)
  })
})

describe('tvlUsd', () => {
  const usdc = makeToken('USDC', 6)
  const weth = makeToken('WETH', 18)

  it('sums both sides in USD', () => {
    expect(tvlUsd(2_000_000_000n, 10n ** 18n, usdc, weth, 1, 3000)).toBe(5000)
  })

  it('uses whichever side is priced, null when neither', () => {
    expect(tvlUsd(2_000_000_000n, 10n ** 18n, usdc, weth, 1, null)).toBe(2000)
    expect(tvlUsd(2_000_000_000n, 10n ** 18n, usdc, weth, null, 3000)).toBe(3000)
    expect(tvlUsd(2_000_000_000n, 10n ** 18n, usdc, weth, null, null)).toBeNull()
  })
})
