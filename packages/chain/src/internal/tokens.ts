/**
 * ERC-20 metadata with a per-reader cache. `symbol()`/`name()` are tried as `string` first and as
 * `bytes32` only for tokens whose answer does not decode as a string (MKR-style); tokens that
 * answer neither, or answer an empty string, get the truncated address as symbol. A missing
 * `decimals()` defaults to 18 (documented, rare).
 */
import { type Address, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'
import { hexToString } from 'viem'
import { erc20Abi, erc20Bytes32Abi } from '../abi/erc20.js'
import { NATIVE_ETH_TOKEN } from '../addresses.js'
import { lowercase, type ReaderContext, unique } from './context.js'
import { type CallResult, multicallBatched, optionalResult } from './multicall.js'

function shortAddress(address: Address): string {
  return address.slice(0, 10)
}

/** Text of a `bytes32` answer: NUL padding is dropped wherever it sits; nothing left → undefined. */
function bytes32ToText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('0x')) return undefined
  const text = hexToString(value as `0x${string}`)
    .replace(/\0/g, '')
    .trim()
  return text.length > 0 ? text : undefined
}

function textResult(r: CallResult | undefined): string | undefined {
  const v = optionalResult(r)
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** The call reverted or its answer did not decode (viem reports both as a per-call failure). */
function failed(r: CallResult | undefined): boolean {
  return r !== undefined && r.status === 'failure'
}

async function fetchTokens(ctx: ReaderContext, addresses: Address[]): Promise<TokenInfo[]> {
  const calls = addresses.flatMap((address) => [
    { address, abi: erc20Abi, functionName: 'symbol' },
    { address, abi: erc20Abi, functionName: 'name' },
    { address, abi: erc20Abi, functionName: 'decimals' },
  ])
  const results = await multicallBatched(ctx, calls)
  const symbols = addresses.map((_, i) => textResult(results[i * 3]))
  const names = addresses.map((_, i) => textResult(results[i * 3 + 1]))
  const decimals = addresses.map((_, i) => {
    const v = optionalResult(results[i * 3 + 2])
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 255 ? v : undefined
  })

  // Retry as bytes32 only where the string decode failed: an empty string is a successful answer
  // (its encoding would decode as a bogus bytes32) and falls through to the short-address fallback.
  const retry = addresses.flatMap((_, i) =>
    failed(results[i * 3]) || failed(results[i * 3 + 1]) ? [i] : [],
  )
  if (retry.length > 0) {
    const bytesCalls = retry.flatMap((i) => [
      { address: addresses[i] as Address, abi: erc20Bytes32Abi, functionName: 'symbol' },
      { address: addresses[i] as Address, abi: erc20Bytes32Abi, functionName: 'name' },
    ])
    const bytesResults = await multicallBatched(ctx, bytesCalls)
    retry.forEach((i, j) => {
      if (failed(results[i * 3])) symbols[i] = bytes32ToText(optionalResult(bytesResults[j * 2]))
      if (failed(results[i * 3 + 1]))
        names[i] = bytes32ToText(optionalResult(bytesResults[j * 2 + 1]))
    })
  }

  return addresses.map((address, i) => {
    const symbol = symbols[i] ?? shortAddress(address)
    return { address, symbol, name: names[i] ?? symbol, decimals: decimals[i] ?? 18 }
  })
}

export async function readTokens(ctx: ReaderContext, addresses: Address[]): Promise<TokenInfo[]> {
  const wanted = unique(addresses.map(lowercase))
  const missing = wanted.filter((a) => a !== NATIVE_ETH && !ctx.tokenCache.has(a))
  if (missing.length > 0) {
    for (const info of await fetchTokens(ctx, missing)) ctx.tokenCache.set(info.address, info)
  }
  return addresses.map((raw) => {
    const address = lowercase(raw)
    if (address === NATIVE_ETH) return NATIVE_ETH_TOKEN
    const info = ctx.tokenCache.get(address)
    if (!info) throw new Error(`token metadata missing for ${address}`)
    return info
  })
}

export function tokenMap(tokens: readonly TokenInfo[]): Map<Address, TokenInfo> {
  return new Map(tokens.map((t) => [t.address, t]))
}
