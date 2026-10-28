/**
 * How a token is named on screen. A symbol is not an identity (Aerodrome's and Aero's AERO both
 * answer "AERO"): the API's `label` tells such tokens apart, and the unit of an amount says which
 * one only where the pool's two tokens share a symbol. Re-exported by ./format.ts.
 */
import { symbolKey } from '@depthwatch/core'

/** A token where it is named: what the API labels "AERO (Aerodrome)" beside another AERO. */
export interface NamedToken {
  symbol: string
  /** The API's display label; a server older than labels sends none. */
  label?: string
}

/**
 * A token's name in titles, headers, axis labels and pairs: the API's `label`, which tells apart
 * tokens sharing a symbol (Aerodrome's and Aero's AERO), else the symbol. Unit suffixes use
 * `unitText`.
 */
export function tokenText(token: NamedToken): string {
  return token.label ?? token.symbol
}

/**
 * A token as the unit of an amount in a pool: the bare symbol ("1,250 USDC"), or `tokenText` when
 * the pool's other token shares the symbol (core `symbolKey`), so the two sides of an AERO/AERO
 * pool read "AERO (Aero)" and "AERO (Aerodrome)".
 */
export function unitText(token: NamedToken, other: NamedToken): string {
  return symbolKey(token.symbol) === symbolKey(other.symbol) ? tokenText(token) : token.symbol
}

export function pairLabel(token0: NamedToken, token1: NamedToken) {
  return `${tokenText(token0)} / ${tokenText(token1)}`
}
