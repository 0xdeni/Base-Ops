import { describe, expect, it } from 'vitest'
import { BIGINT_KEYS, jsonStringify, reviveBigints, toJsonSafe } from './json.js'

describe('json helpers', () => {
  it('round-trips bigints through decimal strings', () => {
    const input = {
      a: 1n,
      nested: { liquidity: 2n ** 100n, list: [3n, { amountIn: -4n }] },
      s: '123',
    }
    const safe = toJsonSafe(input)
    expect(safe).toEqual({
      a: '1',
      nested: { liquidity: (2n ** 100n).toString(), list: ['3', { amountIn: '-4' }] },
      s: '123',
    })
    const text = jsonStringify(input)
    const revived = reviveBigints<typeof input>(
      JSON.parse(text),
      new Set(['a', 'liquidity', 'amountIn']),
    )
    expect(revived.a).toBe(1n)
    expect(revived.nested.liquidity).toBe(2n ** 100n)
    expect((revived.nested.list[1] as { amountIn: bigint }).amountIn).toBe(-4n)
    // Arrays of bare bigints are not revivable by key; they stay strings, which is intended.
    expect(revived.nested.list[0]).toBe('3')
    expect(revived.s).toBe('123')
  })

  it('rejects non-integer strings under bigint keys', () => {
    expect(() => reviveBigints({ liquidity: 'abc' }, BIGINT_KEYS)).toThrow(/liquidity/)
  })
})
