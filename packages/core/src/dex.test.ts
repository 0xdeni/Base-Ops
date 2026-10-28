import { describe, expect, it } from 'vitest'
import { DYNAMIC_FEE_DEXES, hasDynamicFee } from './dex.js'
import { DEXES } from './types.js'

describe('hasDynamicFee', () => {
  it('is true for both Slipstream families and false for every other DEX', () => {
    expect(Object.fromEntries(DEXES.map((dex) => [dex, hasDynamicFee({ dex })]))).toEqual({
      'uniswap-v3': false,
      'uniswap-v4': false,
      'aerodrome-v2': false,
      'aerodrome-slipstream': true,
      'aero-v2': false,
      'aero-slipstream': true,
    })
  })

  it('lists only known DEXes and answers false for an unknown id', () => {
    for (const dex of DYNAMIC_FEE_DEXES) expect(DEXES).toContain(dex)
    expect(hasDynamicFee({ dex: 'slipstream' })).toBe(false)
    expect(hasDynamicFee({ dex: '' })).toBe(false)
  })
})
