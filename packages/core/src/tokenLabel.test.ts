import { describe, expect, it } from 'vitest'
import { buildSharedSymbols, symbolKey, symbolNameKey, tokenLabel } from './tokenLabel.js'
import type { Address } from './types.js'

const token = (address: string, symbol: string, name: string) => ({
  address: address as Address,
  symbol,
  name,
})

/** The two AERO tokens on Base: the same symbol, different names (each its own `name()`). */
const AERO = token('0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee', 'AERO', 'Aero')
const AERO_AERODROME = token('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'AERO', 'Aerodrome')
const USDC = token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 'USD Coin')
const COPY = token('0x00000000000000000000000000000000000000c0', 'AERO', 'Aero')

describe('tokenLabel', () => {
  it('names both AEROs when both are indexed', () => {
    const shared = buildSharedSymbols([AERO, AERO_AERODROME, USDC])
    expect(tokenLabel(AERO, shared)).toBe('AERO (Aero)')
    expect(tokenLabel(AERO_AERODROME, shared)).toBe('AERO (Aerodrome)')
    expect(tokenLabel(USDC, shared)).toBe('USDC')
  })

  it('qualifies a token outside the index when an indexed token shares its symbol', () => {
    const shared = buildSharedSymbols([AERO, USDC])
    expect(tokenLabel(AERO, shared)).toBe('AERO')
    expect(tokenLabel(AERO_AERODROME, shared)).toBe('AERO (Aerodrome)')
  })

  it('falls back to a short address when symbol and name are both shared', () => {
    const shared = buildSharedSymbols([AERO, COPY])
    expect(tokenLabel(AERO, shared)).toBe('AERO (0x3f5b…a4ee)')
    expect(tokenLabel(COPY, shared)).toBe('AERO (0x0000…00c0)')
  })

  it('uses the address form when the name is blank', () => {
    const blank = token('0x00000000000000000000000000000000000000c1', 'AERO', '  ')
    expect(tokenLabel(blank, buildSharedSymbols([AERO]))).toBe('AERO (0x0000…00c1)')
  })

  it('returns the symbol for an unshared symbol and for an empty index', () => {
    expect(tokenLabel(USDC, buildSharedSymbols([USDC, AERO]))).toBe('USDC')
    expect(tokenLabel(AERO, buildSharedSymbols([]))).toBe('AERO')
  })

  it('compares symbols, names and addresses case-insensitively', () => {
    const shouting = token('0x3F5BF3EDAC59D650D8FDF9657A71F2F904A3A4EE', ' aero ', 'AERO')
    const shared = buildSharedSymbols([shouting, AERO_AERODROME])
    expect(symbolKey(' Aero ')).toBe(symbolKey('AERO'))
    expect(symbolNameKey('AERO', 'Aero ')).toBe(symbolNameKey('aero', ' aero'))
    // The same address in another case is the token itself, not a second holder of the symbol.
    expect(tokenLabel(AERO, buildSharedSymbols([shouting]))).toBe('AERO')
    expect(tokenLabel(AERO, shared)).toBe('AERO (Aero)')
    expect(tokenLabel(AERO_AERODROME, shared)).toBe('AERO (Aerodrome)')
  })
})
