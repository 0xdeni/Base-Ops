import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { BASE_ADDRESSES, resolveAddresses, TOKENS } from './addresses.js'

describe('resolveAddresses', () => {
  it('returns the Base defaults, which are already lowercase', () => {
    expect(resolveAddresses()).toEqual(BASE_ADDRESSES)
    expect(resolveAddresses({})).toEqual(BASE_ADDRESSES)
  })

  it('lowercases every address of a checksummed override, including nested lists and anchor keys', () => {
    const v4 = BASE_ADDRESSES.uniswapV4
    const slip = BASE_ADDRESSES.aerodromeSlipstream[0]!
    const resolved = resolveAddresses({
      multicall3: getAddress(BASE_ADDRESSES.multicall3),
      uniswapV4: { ...v4, positionManager: getAddress(v4.positionManager) },
      aerodromeSlipstream: [{ ...slip, factory: getAddress(slip.factory) }],
      referenceTokens: [{ ...TOKENS.USDC, address: getAddress(TOKENS.USDC.address) }],
      stablecoinAnchors: { [getAddress(TOKENS.USDC.address)]: 1 },
    })
    expect(resolved.multicall3).toBe(BASE_ADDRESSES.multicall3)
    expect(resolved.uniswapV4).toEqual(v4)
    expect(resolved.aerodromeSlipstream).toEqual([slip])
    expect(resolved.referenceTokens).toEqual([TOKENS.USDC])
    expect(resolved.stablecoinAnchors).toEqual({ [TOKENS.USDC.address]: 1 })
    // Untouched sections keep the defaults.
    expect(resolved.uniswapV3).toEqual(BASE_ADDRESSES.uniswapV3)
    expect(resolved.aerodromeV2).toEqual(BASE_ADDRESSES.aerodromeV2)
  })

  it('keeps the default for a section explicitly set to undefined', () => {
    expect(resolveAddresses({ uniswapV4: undefined })).toEqual(BASE_ADDRESSES)
  })

  it('rejects malformed addresses, naming the field', () => {
    expect(() =>
      resolveAddresses({
        uniswapV4: { ...BASE_ADDRESSES.uniswapV4, positionManager: '0x1234' as never },
      }),
    ).toThrow(/addresses\.uniswapV4\.positionManager/)
    expect(() => resolveAddresses({ stablecoinAnchors: { usdc: 1 } as never })).toThrow(
      /stablecoinAnchors/,
    )
  })
})

describe('TOKENS', () => {
  it("carries each token's own name() as read on Base (docs/research/base-contracts.md §2.8)", () => {
    expect(Object.fromEntries(Object.values(TOKENS).map((t) => [t.symbol, t.name]))).toEqual({
      WETH: 'Wrapped Ether',
      USDC: 'USD Coin',
      USDbC: 'USD Base Coin',
      cbBTC: 'Coinbase Wrapped BTC',
      cbETH: 'Coinbase Wrapped Staked ETH',
      wstETH: 'Wrapped liquid staked Ether 2.0',
      DAI: 'Dai Stablecoin',
      USDT: 'Tether USD', // the bridged token's own name; bridged is noted only in addresses.ts
      EURC: 'EURC',
      AERO: 'Aerodrome',
      DEGEN: 'Degen',
      VIRTUAL: 'Virtual Protocol',
      BRETT: 'Brett',
    })
  })
})
