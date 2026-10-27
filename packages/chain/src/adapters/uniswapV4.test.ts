import { NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { TOKENS } from '../addresses.js'
import { packPositionInfo } from '../fixtures/syntheticV4.js'
import { computePoolId, decodePositionInfo, uniswapV4PoolId } from './uniswapV4.js'

const NO_HOOKS = '0x0000000000000000000000000000000000000000'

describe('computePoolId', () => {
  it('matches keccak256(abi.encode(PoolKey)) check values from the research notes', () => {
    expect(
      computePoolId({
        currency0: NATIVE_ETH,
        currency1: TOKENS.USDC.address,
        fee: 500,
        tickSpacing: 10,
        hooks: NO_HOOKS,
      }),
    ).toBe('0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a')
    expect(
      computePoolId({
        currency0: TOKENS.WETH.address,
        currency1: TOKENS.USDC.address,
        fee: 500,
        tickSpacing: 10,
        hooks: NO_HOOKS,
      }),
    ).toBe('0x90333bb05c258fe0dddb2840ef66f1a05165aa7dac6815d24e807cc6ebd943a0')
    expect(
      computePoolId({
        currency0: NATIVE_ETH,
        currency1: TOKENS.USDC.address,
        fee: 3000,
        tickSpacing: 60,
        hooks: NO_HOOKS,
      }),
    ).toBe('0xe070797535b13431808f8fc81fdbe7b41362960ed0b55bc2b6117c49c51b7eb9')
  })

  it('builds lowercase pool ids', () => {
    expect(uniswapV4PoolId('0xABCD')).toBe('uniswap-v4:0xabcd')
  })
})

describe('decodePositionInfo', () => {
  it('unpacks tickLower / tickUpper including negative ticks', () => {
    const poolId = '0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a'
    for (const [lower, upper] of [
      [-887220, 887220],
      [-100, 50],
      [0, 10],
      [-200, -10],
    ] as const) {
      const packed = packPositionInfo(poolId, lower, upper)
      expect(decodePositionInfo(packed)).toEqual({ tickLower: lower, tickUpper: upper })
      // The upper 200 bits are the truncated PoolId.
      expect(packed >> 56n).toBe(BigInt(poolId) >> 56n)
    }
  })
})
