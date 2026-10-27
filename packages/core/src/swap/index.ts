/**
 * Swap simulation over any PoolState (fees included, rounding in the pool's favour like the
 * contracts). Dispatches on `state.kind`.
 */

import { priceToSqrtPriceX96 } from '../tickMath.js'
import type { PoolState, SwapDirection, SwapResult } from '../types.js'
import { simulateConcentratedExactIn, simulateConcentratedToSqrtPrice } from './concentrated.js'
import {
  simulateConstantProductExactIn,
  simulateConstantProductToPrice,
} from './constantProduct.js'
import type { PriceDecimals } from './midPrice.js'
import { simulateStableExactIn, simulateStableToPrice } from './stableSwap.js'

export * from './concentrated.js'
export * from './constantProduct.js'
export * from './fees.js'
export * from './midPrice.js'
export * from './protocolFee.js'
export * from './stableSwap.js'

/**
 * Exact-input swap. `amountIn` is the gross input including the LP fee; the result's `amountIn`
 * is the part actually consumed (equal to the input when `complete`).
 */
export function simulateSwapExactIn(
  state: PoolState,
  direction: SwapDirection,
  amountIn: bigint,
): SwapResult {
  switch (state.kind) {
    case 'concentrated':
      return simulateConcentratedExactIn(state, direction, amountIn)
    case 'constant-product':
      return simulateConstantProductExactIn(state, direction, amountIn)
    case 'stable-swap':
      return simulateStableExactIn(state, direction, amountIn)
  }
}

/**
 * Swap until the pool's marginal price reaches `targetPrice` (human, token1 per token0).
 * Direction is implied: above the current price → `oneForZero`, below → `zeroForOne`.
 *
 * `decimals` (the two tokens' decimals) turns the human target into the pool's raw price for
 * concentrated and constant-product pools; it is required so a human target can never be misread
 * as a raw one. Stable pools carry their own decimals in the state, which are authoritative (the
 * argument is ignored, exactly like `midPrice`).
 */
export function simulateSwapToPrice(
  state: PoolState,
  targetPrice: number,
  decimals: PriceDecimals,
): SwapResult {
  if (!(targetPrice > 0) || !Number.isFinite(targetPrice))
    throw new RangeError(`simulateSwapToPrice: invalid target price ${targetPrice}`)
  switch (state.kind) {
    case 'concentrated':
      return simulateConcentratedToSqrtPrice(
        state,
        priceToSqrtPriceX96(targetPrice, decimals.decimals0, decimals.decimals1),
      )
    case 'constant-product':
      return simulateConstantProductToPrice(state, targetPrice, decimals)
    case 'stable-swap':
      return simulateStableToPrice(state, targetPrice)
  }
}
