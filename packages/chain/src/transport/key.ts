/**
 * Stable fixture keys: `${method}:${keccak256(canonical params)}`. Canonical form lowercases hex
 * strings, sorts object keys, drops `undefined` values and renders bigints as decimal strings, so
 * the same logical request always maps to the same key regardless of address casing or key order.
 *
 * Keys are memoised by canonical form (bounded): fixtures register, and transports look up, the
 * same requests over and over (the time-varying synthetic world builds one fixture per epoch).
 */
import { keccak256, stringToHex } from 'viem'

const HEX_RE = /^0x[0-9a-fA-F]*$/

export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(HEX_RE.test(value) ? value.toLowerCase() : value)
    case 'number':
    case 'boolean':
      return JSON.stringify(value)
    case 'bigint':
      return JSON.stringify(value.toString())
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
    }
    default:
      throw new TypeError(`fixture key: cannot canonicalize a ${typeof value}`)
  }
}

/** Memoised keys; cleared whole when full (a cache, never a source of truth). */
const KEY_CACHE_LIMIT = 200_000
/** Longer canonical forms (whole multicall batches) are rarely repeated: hashed, not kept. */
const KEY_CACHE_MAX_LENGTH = 2_048
const keyCache = new Map<string, string>()

export function fixtureKey(method: string, params: unknown): string {
  const canonical = canonicalize(params ?? [])
  if (canonical.length > KEY_CACHE_MAX_LENGTH)
    return `${method}:${keccak256(stringToHex(canonical))}`
  const memo = `${method}\u0000${canonical}`
  const cached = keyCache.get(memo)
  if (cached !== undefined) return cached
  const key = `${method}:${keccak256(stringToHex(canonical))}`
  if (keyCache.size >= KEY_CACHE_LIMIT) keyCache.clear()
  keyCache.set(memo, key)
  return key
}
