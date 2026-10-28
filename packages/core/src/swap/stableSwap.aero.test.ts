/**
 * Aero v2 pools against core's v2 math, with answers read on Base (docs/research/base-contracts.md
 * §2.9, `## aero`): six `getAmountOut` reads of three Aero stable pools at block 53,085,844 (fee
 * 5 bps; 6/18, 18/6 and 18/18 decimals, the last the WETH/msETH pool 0x45adce4b…, inputs of 1 % and
 * 20 % of reserve0) and one of the volatile WETH/USDC pool 0x800eb395… at 53,211,732 (30 bps).
 * Fees are basis points × 100 (pips), as the adapter reads `getBaseFee`.
 */
import { describe, expect, it } from 'vitest'
import { buildConstantProductState, buildStableSwapState } from '../testing.js'
import { simulateSwapExactIn } from './index.js'
import { stableGetAmountOut } from './stableSwap.js'

interface StableVector {
  decimals: readonly [number, number]
  reserves: readonly [bigint, bigint]
  amountIn: bigint
  amountOut: bigint
}

const STABLE_VECTORS: readonly StableVector[] = [
  {
    decimals: [6, 18],
    reserves: [767_760_232_090n, 1_008_389_305_169_255_506_904_431n],
    amountIn: 7_677_602_320n,
    amountOut: 7_708_500_199_456_113_207_420n,
  },
  {
    decimals: [6, 18],
    reserves: [767_760_232_090n, 1_008_389_305_169_255_506_904_431n],
    amountIn: 153_552_046_418n,
    amountOut: 153_624_005_082_887_339_544_654n,
  },
  {
    decimals: [18, 6],
    reserves: [254_147_343_859_406_991_646_781n, 109_351_581_840n],
    amountIn: 2_541_473_438_594_069_916_467n,
    amountOut: 2_224_278_726n,
  },
  {
    decimals: [18, 6],
    reserves: [254_147_343_859_406_991_646_781n, 109_351_581_840n],
    amountIn: 50_829_468_771_881_398_329_356n,
    amountOut: 38_207_374_059n,
  },
  {
    decimals: [18, 18],
    reserves: [65_360_853_889_782_056_566n, 150_921_430_619_221_195_440n],
    amountIn: 653_608_538_897_820_565n,
    amountOut: 737_347_824_432_227_326n,
  },
  {
    decimals: [18, 18],
    reserves: [65_360_853_889_782_056_566n, 150_921_430_619_221_195_440n],
    amountIn: 13_072_170_777_956_411_313n,
    amountOut: 14_110_310_113_463_221_465n,
  },
]

describe('Aero v2 pools against the chain', () => {
  it.each(STABLE_VECTORS)(
    'stable $decimals: getAmountOut($amountIn) = $amountOut',
    ({ decimals, reserves, amountIn, amountOut }) => {
      const state = buildStableSwapState(reserves[0], reserves[1], decimals[0], decimals[1], 500)
      expect(stableGetAmountOut(state, 'zeroForOne', amountIn)).toBe(amountOut)
      expect(simulateSwapExactIn(state, 'zeroForOne', amountIn).amountOut).toBe(amountOut)
    },
  )

  it('volatile WETH/USDC: getAmountOut(1 WETH) = 2,351,367,683 (x·y = k, 30 bps off the input)', () => {
    const state = buildConstantProductState(
      1_386_847_103_436_033_451_528n,
      3_273_151_228_427n,
      3_000,
    )
    const swap = simulateSwapExactIn(state, 'zeroForOne', 10n ** 18n)
    expect(swap.amountOut).toBe(2_351_367_683n)
    expect(swap.feePaid).toBe(3n * 10n ** 15n)
  })
})
