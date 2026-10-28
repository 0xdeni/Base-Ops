import { getAddress } from 'viem'
import { describe, expect, it } from 'vitest'
import { BASE_ADDRESSES, REFERENCE_TOKENS, resolveAddresses, TOKENS } from './addresses.js'

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

  it('lowercases the Aero sections of an override', () => {
    const v2 = BASE_ADDRESSES.aeroV2
    const cl = BASE_ADDRESSES.aeroSlipstream[0]!
    const resolved = resolveAddresses({
      aeroV2: {
        ...v2,
        volatileFactory: getAddress(v2.volatileFactory),
        stableFeeModule: getAddress(v2.stableFeeModule),
        factoryRegistry: getAddress(v2.factoryRegistry),
      },
      aeroSlipstream: [
        { ...cl, swapHook: getAddress(cl.swapHook), factory: getAddress(cl.factory) },
      ],
    })
    expect(resolved.aeroV2).toEqual(v2)
    expect(resolved.aeroSlipstream).toEqual([cl])
    expect(() =>
      resolveAddresses({ aeroSlipstream: [{ ...cl, swapHook: '0xc0ed' as never }] }),
    ).toThrow(/addresses\.aeroSlipstream\[0\]\.swapHook/)
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
  it("carries each token's own symbol() and name() as read on Base (base-contracts.md §2.8, §2.9)", () => {
    expect(
      Object.fromEntries(
        Object.entries(TOKENS).map(([key, t]) => [key, `${t.symbol} / ${t.name}`]),
      ),
    ).toEqual({
      WETH: 'WETH / Wrapped Ether',
      USDC: 'USDC / USD Coin',
      USDBC: 'USDbC / USD Base Coin',
      CBBTC: 'cbBTC / Coinbase Wrapped BTC',
      CBETH: 'cbETH / Coinbase Wrapped Staked ETH',
      WSTETH: 'wstETH / Wrapped liquid staked Ether 2.0',
      DAI: 'DAI / Dai Stablecoin',
      USDT: 'USDT / Tether USD', // the bridged token's own name; bridged is noted only in addresses.ts
      EURC: 'EURC / EURC',
      AERO_AERODROME: 'AERO / Aerodrome',
      DEGEN: 'DEGEN / Degen',
      VIRTUAL: 'VIRTUAL / Virtual Protocol',
      BRETT: 'BRETT / Brett',
      AERO: 'AERO / Aero',
    })
  })

  it('tells the two AEROs apart by address and keeps both among the 15 reference tokens', () => {
    expect(TOKENS.AERO.address).toBe('0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee')
    expect(TOKENS.AERO_AERODROME.address).toBe('0x940181a94a35a4569e4529a3cdfb74e38fd98631')
    expect(TOKENS.AERO.decimals).toBe(18)
    expect(TOKENS.AERO_AERODROME.decimals).toBe(18)
    expect(REFERENCE_TOKENS).toHaveLength(15)
    expect(REFERENCE_TOKENS.at(-1)).toEqual(TOKENS.AERO)
    expect(new Set(REFERENCE_TOKENS.map((t) => t.address)).size).toBe(15)
  })
})

describe('Aero addresses (docs/research/base-contracts.md, `## aero`)', () => {
  const lowercase = (value: string) => value === value.toLowerCase()

  it('pins the v2 factories, their fee modules, the registry and the start block', () => {
    expect(BASE_ADDRESSES.aeroV2).toEqual({
      volatileFactory: '0x8e6a9fcd1d638cc760ffba397605fe3355de76d2',
      stableFactory: '0x78589e876edcebdce72ee3436ab3c9ad3a7cef2d',
      volatileFeeModule: '0x7949de8d67e4f6b8509bdbb43ff0503af1247a7a',
      stableFeeModule: '0x0195fc76da986d66b2a468133a1be41e90893da6',
      factoryRegistry: '0x7b2a2c12dc5ea2a31455952a05031c3e4bb28f3e',
      startBlock: 52_880_042n,
    })
  })

  it('pins the Slipstream deployment with its NFPM and reviewed swap hook', () => {
    expect(BASE_ADDRESSES.aeroSlipstream).toEqual([
      {
        name: 'aero',
        factory: '0x9cb220581b91b0c83223012fe69688b92ad07a76',
        positionManager: '0x4857db576ee0e45f10525ec59527bfd10beec60b',
        swapHook: '0xc0ed888afe87ed1acf01d9f19bb850159e3ce434',
        startBlock: 52_881_649n,
      },
    ])
  })

  it('keeps every Aero address lowercase and distinct from the Aerodrome ones', () => {
    const { aeroV2, aeroSlipstream, aerodromeV2, aerodromeSlipstream } = BASE_ADDRESSES
    const aero = [
      aeroV2.volatileFactory,
      aeroV2.stableFactory,
      aeroV2.volatileFeeModule,
      aeroV2.stableFeeModule,
      aeroV2.factoryRegistry,
      ...aeroSlipstream.flatMap((d) => [d.factory, d.positionManager, d.swapHook]),
    ]
    expect(aero.every(lowercase)).toBe(true)
    const aerodrome = [
      aerodromeV2.poolFactory,
      aerodromeV2.voter,
      ...aerodromeSlipstream.flatMap((d) => [d.factory, d.positionManager]),
    ]
    expect(aero.filter((a) => aerodrome.includes(a))).toEqual([])
  })
})
