import { encodeFunctionData, pad } from 'viem'
import { describe, expect, it } from 'vitest'
import { erc20Abi } from '../abi/erc20.js'
import { registerCall, registerRawCall, registerRevert } from '../fixtures/builders.js'
import { createChainReader } from '../reader.js'
import { addr, countingTransport, newFixture } from '../test/helpers.js'
import { createFixtureTransport, type Fixture } from '../transport/fixture.js'

function reader(fixture: Fixture) {
  const counts = new Map<string, number>()
  const r = createChainReader({
    transport: countingTransport(createFixtureTransport(fixture), counts),
  })
  return { r, counts }
}

describe('readTokens', () => {
  it('falls back to the short address for empty symbol()/name() without a bytes32 retry', async () => {
    const fixture = newFixture()
    const empty = addr(0xe0)
    registerCall(fixture, { to: empty, abi: erc20Abi, functionName: 'symbol', result: '' })
    registerCall(fixture, { to: empty, abi: erc20Abi, functionName: 'name', result: '' })
    registerCall(fixture, { to: empty, abi: erc20Abi, functionName: 'decimals', result: 18 })
    const named = addr(0xe1)
    registerCall(fixture, { to: named, abi: erc20Abi, functionName: 'symbol', result: '' })
    registerCall(fixture, { to: named, abi: erc20Abi, functionName: 'name', result: 'Named' })
    registerCall(fixture, { to: named, abi: erc20Abi, functionName: 'decimals', result: 6 })
    const { r, counts } = reader(fixture)
    expect(await r.readTokens([empty, named])).toEqual([
      { address: empty, symbol: '0x00000000', name: '0x00000000', decimals: 18 },
      { address: named, symbol: '0x00000000', name: 'Named', decimals: 6 },
    ])
    expect(counts.get('eth_call')).toBe(1) // empty strings decoded fine: nothing to retry
  })

  it('retries as bytes32 only the calls that failed and drops NUL padding wherever it sits', async () => {
    const fixture = newFixture()
    const token = addr(0xe2)
    // symbol(): a bare 32-byte word, right-aligned text → not a string, bytes32 'A'.
    registerRawCall(fixture, {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' }),
      returnData: pad('0x41', { size: 32 }),
    })
    registerCall(fixture, { to: token, abi: erc20Abi, functionName: 'name', result: 'Alpha' })
    registerCall(fixture, { to: token, abi: erc20Abi, functionName: 'decimals', result: 18 })
    const reverting = addr(0xe3)
    registerRevert(fixture, { to: reverting, abi: erc20Abi, functionName: 'symbol' })
    registerRevert(fixture, { to: reverting, abi: erc20Abi, functionName: 'name' })
    registerRevert(fixture, { to: reverting, abi: erc20Abi, functionName: 'decimals' })
    const { r, counts } = reader(fixture)
    expect(await r.readTokens([token, reverting])).toEqual([
      { address: token, symbol: 'A', name: 'Alpha', decimals: 18 },
      { address: reverting, symbol: '0x00000000', name: '0x00000000', decimals: 18 },
    ])
    expect(counts.get('eth_call')).toBe(2) // string pass + one bytes32 retry
  })
})
