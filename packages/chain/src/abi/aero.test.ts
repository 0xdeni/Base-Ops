/**
 * The Aero ABIs against the topics and selectors read on Base (docs/research/base-contracts.md,
 * §2.9): the v2 `PoolCreated` and the Aero NFPM's `IncreaseLiquidity` differ from their Aerodrome
 * namesakes, the Slipstream `PoolCreated` and `DecreaseLiquidity` do not.
 */
import { toEventSelector, toFunctionSelector } from 'viem'
import { describe, expect, it } from 'vitest'
import { aeroCLFactoryAbi } from './aeroCLFactory.js'
import { aerodromeCLFactoryAbi } from './aerodromeCLFactory.js'
import { aerodromePoolFactoryAbi } from './aerodromePoolFactory.js'
import { aeroNFPMAbi } from './aeroNFPM.js'
import { aeroPoolFactoryAbi } from './aeroPoolFactory.js'
import { slipstreamNFPMAbi } from './slipstreamNFPM.js'

type Item = { type: string; name?: string }
const event = (abi: readonly Item[], name: string) => {
  const item = abi.find((i) => i.type === 'event' && i.name === name)
  if (!item) throw new Error(`no event ${name}`)
  return toEventSelector(item as Parameters<typeof toEventSelector>[0])
}
const fn = (abi: readonly Item[], name: string) => {
  const item = abi.find((i) => i.type === 'function' && i.name === name)
  if (!item) throw new Error(`no function ${name}`)
  return toFunctionSelector(item as Parameters<typeof toFunctionSelector>[0])
}

describe('Aero ABIs', () => {
  it('pins the v2 PoolCreated and getPool of the Aero factories', () => {
    expect(event(aeroPoolFactoryAbi, 'PoolCreated')).toBe(
      '0xebbbe9dc3a19d2f959ac76ac0372b4983cdfb945f5d6aef4873c36fabb2ba8aa',
    )
    expect(event(aerodromePoolFactoryAbi, 'PoolCreated')).toBe(
      '0x2128d88d14c80cb081c1252a5acff7a264671bf199ce226b53788fb26065005e',
    )
    expect(fn(aeroPoolFactoryAbi, 'getPool')).toBe('0x531aa03e')
    expect(fn(aerodromePoolFactoryAbi, 'getPool')).toBe('0x79bc57d5')
  })

  it('pins the NFPM events: IncreaseLiquidity changed, DecreaseLiquidity did not', () => {
    expect(event(aeroNFPMAbi, 'IncreaseLiquidity')).toBe(
      '0x0f8712c47eb813e705bf827a60bdd551e6f2e055b4a1c2004304d52208a5a513',
    )
    expect(event(slipstreamNFPMAbi, 'IncreaseLiquidity')).toBe(
      '0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f',
    )
    expect(event(aeroNFPMAbi, 'DecreaseLiquidity')).toBe(
      event(slipstreamNFPMAbi, 'DecreaseLiquidity'),
    )
    expect(event(aeroNFPMAbi, 'Transfer')).toBe(event(slipstreamNFPMAbi, 'Transfer'))
  })

  it('shares the Slipstream PoolCreated and has no getSwapFee on the Aero CLFactory', () => {
    expect(event(aeroCLFactoryAbi, 'PoolCreated')).toBe(
      '0xab0d57f0df537bb25e80245ef7748fa62353808c54d6e528a9dd20887aed9ac2',
    )
    expect(event(aerodromeCLFactoryAbi, 'PoolCreated')).toBe(event(aeroCLFactoryAbi, 'PoolCreated'))
    const names = (aeroCLFactoryAbi as readonly Item[]).map((i) => i.name)
    expect(names).not.toContain('getSwapFee')
    expect(names).toEqual(expect.arrayContaining(['getPoolSwapHook', 'defaultSwapHook', 'isPool']))
  })
})
