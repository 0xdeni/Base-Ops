/**
 * Human mid price (token1 per token0, decimal-adjusted) of any pool state.
 */

import { sqrtPriceX96ToPrice } from '../tickMath.js'
import type { PoolState } from '../types.js'
import { stableMarginalPrice } from './stableSwap.js'

/** Token decimals used to turn raw prices into human prices. */
export interface PriceDecimals {
  decimals0: number
  decimals1: number
}

/** Equal decimals: raw and human prices coincide. */
export const RAW_PRICE_DECIMALS: Readonly<PriceDecimals> = Object.freeze({
  decimals0: 0,
  decimals1: 0,
})

/**
 * Current marginal price of the pool:
 * - concentrated: from sqrtPriceX96;
 * - constant product: reserve1 / reserve0 (NaN when a reserve is 0);
 * - stable swap: analytic dy/dx of x³y + xy³ on normalised reserves (the state's own decimals are
 *   authoritative, the arguments are ignored).
 */
export function midPrice(state: PoolState, decimals0: number, decimals1: number): number {
  switch (state.kind) {
    case 'concentrated':
      return sqrtPriceX96ToPrice(state.sqrtPriceX96, decimals0, decimals1)
    case 'constant-product': {
      if (state.reserve0 === 0n || state.reserve1 === 0n) return Number.NaN
      return (Number(state.reserve1) / Number(state.reserve0)) * 10 ** (decimals0 - decimals1)
    }
    case 'stable-swap':
      return stableMarginalPrice(state)
  }
}
