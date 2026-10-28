/**
 * The two AEROs in the price graph (docs/METRICS.md, "Two AEROs"): no synthetic edge ties them,
 * but a pool that pairs them (Aero v2's stable AERO/AERO pool) is an ordinary edge at its own
 * price, weighted by its ±2 % depth, so the old AERO is priced through it only when that is the
 * widest route.
 */
import type { PoolOverview } from '@depthwatch/chain'
import type { Address, PoolMeta, TokenInfo } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { buildPriceEdges, computePrices, pricingFor } from './prices.js'

const token = (address: string, name: string, decimals: number): TokenInfo => ({
  address: address as Address,
  symbol: name === 'USD Coin' ? 'USDC' : 'AERO',
  name,
  decimals,
})
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USD Coin', 6)
const AERO_NEW = token('0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee', 'Aero', 18)
const AERO_OLD = token('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'Aerodrome', 18)
const ANCHORS: Record<Address, number> = { [USDC.address]: 1 }
const E18 = 10n ** 18n

/** A reserve pool (Aero v2): stable for the AERO/AERO pair, volatile for the USDC pairs. */
function reservePool(
  id: string,
  token0: TokenInfo,
  token1: TokenInfo,
  reserve0: bigint,
  reserve1: bigint,
  stable = false,
): PoolOverview {
  const pool: PoolMeta = {
    id,
    dex: 'aero-v2',
    kind: stable ? 'stable-swap' : 'constant-product',
    address: id.slice('aero-v2:'.length) as Address,
    poolId: null,
    token0,
    token1,
    feePips: stable ? 500 : 3_000,
    tickSpacing: null,
    stable,
    hooks: null,
    createdAtBlock: 1n,
  }
  return {
    pool,
    blockNumber: 100n,
    sqrtPriceX96: null,
    tick: null,
    liquidity: null,
    reserve0,
    reserve1,
  }
}

const NEW_USDC = reservePool(
  'aero-v2:0x01',
  AERO_NEW,
  USDC,
  2_000_000n * E18,
  1_000_000n * 10n ** 6n,
)
/** Old AERO's own USDC pool: thin, and quoting it at $0.40 instead of the $0.50 of the new one. */
const OLD_USDC = reservePool('aero-v2:0x02', AERO_OLD, USDC, 2_500n * E18, 1_000n * 10n ** 6n)
/** The AERO/AERO stable pool (token0 is the new AERO: its address sorts first), at about 1:1. */
const AEROS = reservePool('aero-v2:0x03', AERO_NEW, AERO_OLD, 400_000n * E18, 400_000n * E18, true)

describe('the two AEROs in the price graph', () => {
  it('a pool pairing them is an ordinary edge between the two tokens', () => {
    const [edge] = buildPriceEdges([pricingFor(AEROS)])
    expect(edge).toMatchObject({
      token0: AERO_NEW.address,
      token1: AERO_OLD.address,
      source: AEROS.pool.id,
    })
    expect(edge?.price).toBeCloseTo(1, 6)
  })

  it('prices the old AERO through the new one when that route is the widest', () => {
    const prices = computePrices([NEW_USDC, OLD_USDC, AEROS], ANCHORS)
    expect(prices.get(AERO_NEW.address)?.usd).toBeCloseTo(0.5, 6)
    expect(prices.get(AERO_OLD.address)?.usd).toBeCloseTo(0.5, 6)
    expect(prices.get(AERO_OLD.address)?.via).toEqual([NEW_USDC.pool.id, AEROS.pool.id])
    // Without the AERO/AERO pool, each AERO is priced from its own pool.
    const apart = computePrices([NEW_USDC, OLD_USDC], ANCHORS)
    expect(apart.get(AERO_OLD.address)?.usd).toBeCloseTo(0.4, 6)
  })
})
