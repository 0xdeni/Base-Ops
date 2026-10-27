import { describe, expect, it } from 'vitest'
import { computeDepth } from '../metrics/depth.js'
import { computeEffectiveSpread } from '../metrics/spread.js'
import { buildConcentratedState } from '../testing.js'
import type { ConcentratedState, TokenInfo } from '../types.js'
import { simulateSwapExactIn } from './index.js'
import {
  decodeV4ProtocolFee,
  MAX_PROTOCOL_FEE_PIPS,
  swapFeePips,
  v4SwapFeePips,
} from './protocolFee.js'

describe('v4SwapFeePips (ProtocolFeeLibrary.calculateSwapFee)', () => {
  it('combines the protocol fee with the LP fee, rounding the product down', () => {
    expect(v4SwapFeePips(125, 500)).toBe(625) // 125 + 500 − floor(0.0625)
    expect(v4SwapFeePips(500, 3_000)).toBe(3_499) // 500 + 3 000 − floor(1.5)
    expect(v4SwapFeePips(25, 100)).toBe(125)
    expect(v4SwapFeePips(1_000, 10_000)).toBe(10_990) // 1 000 + 10 000 − 10
    expect(v4SwapFeePips(0, 3_000)).toBe(3_000)
    expect(v4SwapFeePips(125, 0)).toBe(125)
    expect(v4SwapFeePips(1_000, 1_000_000)).toBe(1_000_000) // a 100 % LP fee stays 100 %
  })

  it('rejects fees outside the contract ranges', () => {
    expect(() => v4SwapFeePips(-1, 500)).toThrow(RangeError)
    expect(() => v4SwapFeePips(1.5, 500)).toThrow(RangeError)
    expect(() => v4SwapFeePips(125, 1_000_001)).toThrow(RangeError)
  })
})

describe('decodeV4ProtocolFee (slot0 packing)', () => {
  it('reads zeroForOne from the low 12 bits and oneForZero from the high 12 bits', () => {
    // The ETH/cbBTC 500/10 pool of the live run: raw protocolFee 512 125 = 125 | 125 << 12.
    expect(decodeV4ProtocolFee(512_125)).toEqual({ zeroForOne: 125, oneForZero: 125 })
    expect(decodeV4ProtocolFee(50 | (300 << 12))).toEqual({ zeroForOne: 50, oneForZero: 300 })
    expect(decodeV4ProtocolFee(0)).toEqual({ zeroForOne: 0, oneForZero: 0 })
    expect(decodeV4ProtocolFee(MAX_PROTOCOL_FEE_PIPS << 12)).toEqual({
      zeroForOne: 0,
      oneForZero: 1_000,
    })
  })

  it('rejects values the PoolManager never stores', () => {
    expect(() => decodeV4ProtocolFee(1_001)).toThrow(RangeError)
    expect(() => decodeV4ProtocolFee(1_001 << 12)).toThrow(RangeError)
    expect(() => decodeV4ProtocolFee(1 << 24)).toThrow(RangeError)
    expect(() => decodeV4ProtocolFee(-1)).toThrow(RangeError)
  })
})

const WETH: TokenInfo = {
  address: '0x4200000000000000000000000000000000000006',
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
}
const USDC: TokenInfo = {
  address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  symbol: 'USDC',
  name: 'USD Coin',
  decimals: 6,
}

/** A WETH/USDC-like v4 pool around tick −197 000 (≈ $2 750), LP fee `feePips`. */
function pool(feePips: number, protocolFeePips?: ConcentratedState['protocolFeePips']) {
  const state = buildConcentratedState({
    positions: [
      { tickLower: -199_000, tickUpper: -195_000, liquidity: 4n * 10n ** 18n },
      { tickLower: -197_500, tickUpper: -196_500, liquidity: 6n * 10n ** 18n },
    ],
    tick: -197_000,
    feePips,
    tickSpacing: 10,
  })
  return protocolFeePips === undefined ? state : { ...state, protocolFeePips }
}

describe('the v4 protocol fee in the swap walk', () => {
  it('charges each direction its own combined fee', () => {
    const state = pool(3_000, { zeroForOne: 500, oneForZero: 0 })
    expect(swapFeePips(state, 'zeroForOne')).toBe(3_499)
    expect(swapFeePips(state, 'oneForZero')).toBe(3_000)
    expect(swapFeePips(pool(3_000), 'zeroForOne')).toBe(3_000)
  })

  it('walks exactly like a pool whose LP fee is the combined fee (625 for 500 + 125)', () => {
    const v4 = pool(500, { zeroForOne: 125, oneForZero: 125 })
    const same = pool(625)
    const lpOnly = pool(500)
    for (const direction of ['zeroForOne', 'oneForZero'] as const) {
      const amount = direction === 'zeroForOne' ? 30n * 10n ** 18n : 80_000n * 10n ** 6n
      expect(simulateSwapExactIn(v4, direction, amount)).toEqual(
        simulateSwapExactIn(same, direction, amount),
      )
    }
    expect(computeDepth(v4, 18, 6)).toEqual(computeDepth(same, 18, 6))
    expect(computeEffectiveSpread(v4, WETH, USDC, 2_750, 1)).toEqual(
      computeEffectiveSpread(same, WETH, USDC, 2_750, 1),
    )
    // Same price move, same output; the input grows by the fee gross-up 1e6 / (1e6 − fee).
    const [withFee] = computeDepth(v4, 18, 6, [2])
    const [without] = computeDepth(lpOnly, 18, 6, [2])
    if (withFee === undefined || without === undefined) throw new Error('no depth level')
    for (const side of ['up', 'down'] as const) {
      expect(withFee[side].reached).toBe(true)
      expect(withFee[side].amountOut).toBe(without[side].amountOut)
      const ratio = Number(withFee[side].amountIn) / Number(without[side].amountIn)
      expect(ratio).toBeCloseTo(999_500 / 999_375, 8)
    }
  })

  it('widens the spread by about twice the protocol fee', () => {
    const [v4] = computeEffectiveSpread(
      pool(500, { zeroForOne: 125, oneForZero: 125 }),
      WETH,
      USDC,
      2_750,
      1,
      [10_000],
    )
    const [lpOnly] = computeEffectiveSpread(pool(500), WETH, USDC, 2_750, 1, [10_000])
    const widened = (v4?.spreadBps ?? 0) - (lpOnly?.spreadBps ?? 0)
    expect(widened).toBeGreaterThan(2.4) // 2 × 1.25 bps, less rounding
    expect(widened).toBeLessThan(2.6)
  })
})
