import { describe, expect, it } from 'vitest'
import { bearerToken, checkAdminAuth, tokensEqual } from './auth.js'

describe('bearerToken', () => {
  it('extracts the token of a Bearer header, scheme case-insensitive', () => {
    expect(bearerToken('Bearer s3cret')).toBe('s3cret')
    expect(bearerToken('bearer s3cret')).toBe('s3cret')
    expect(bearerToken('BEARER   s3cret  ')).toBe('s3cret')
  })

  it('rejects other schemes and malformed headers', () => {
    expect(bearerToken(undefined)).toBeUndefined()
    expect(bearerToken(null)).toBeUndefined()
    expect(bearerToken('')).toBeUndefined()
    expect(bearerToken('Basic s3cret')).toBeUndefined()
    expect(bearerToken('Bearer')).toBeUndefined()
    expect(bearerToken('Bearer ')).toBeUndefined()
    expect(bearerToken('Bearer two words')).toBeUndefined()
    expect(bearerToken('s3cret')).toBeUndefined()
  })
})

describe('tokensEqual', () => {
  it('compares exact bytes', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true)
    expect(tokensEqual('abc', 'abd')).toBe(false)
    expect(tokensEqual('abc', 'abcd')).toBe(false)
    expect(tokensEqual('abc', 'ab')).toBe(false)
    expect(tokensEqual('', '')).toBe(true)
    expect(tokensEqual('ü', 'u')).toBe(false)
  })
})

describe('checkAdminAuth', () => {
  it('is disabled without a configured token, whatever is presented', () => {
    expect(checkAdminAuth(undefined, undefined)).toBe('disabled')
    expect(checkAdminAuth(undefined, 'Bearer anything')).toBe('disabled')
    expect(checkAdminAuth('', 'Bearer ')).toBe('disabled')
  })

  it('accepts the configured token only', () => {
    expect(checkAdminAuth('s3cret', 'Bearer s3cret')).toBe('ok')
    expect(checkAdminAuth('s3cret', 'bearer s3cret')).toBe('ok')
    expect(checkAdminAuth('s3cret', 'Bearer S3CRET')).toBe('unauthorized')
    expect(checkAdminAuth('s3cret', 'Bearer s3cret2')).toBe('unauthorized')
    expect(checkAdminAuth('s3cret', 'Basic s3cret')).toBe('unauthorized')
    expect(checkAdminAuth('s3cret', undefined)).toBe('unauthorized')
    expect(checkAdminAuth('s3cret', '')).toBe('unauthorized')
  })
})
