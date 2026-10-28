/**
 * Token labels on the wire (DESIGN.md "API (apps/api)"): every token object a response carries
 * adds `label`, core's `tokenLabel` over the tokens of scored pools (`tokens.sharedSymbols()`,
 * read once per request). A symbol is not an identity: Aerodrome's and Aero's AERO both answer
 * "AERO", so the label names them apart; the address stays the identity.
 */
import { type PoolMeta, type SharedSymbols, type TokenInfo, tokenLabel } from '@depthwatch/core'

/** A token as the API returns it: its stored fields plus the display label. */
export type LabelledToken = TokenInfo & { label: string }

/** A pool whose two tokens carry their labels. */
export type LabelledPool = Omit<PoolMeta, 'token0' | 'token1'> & {
  token0: LabelledToken
  token1: LabelledToken
}

export function labelToken(token: TokenInfo, shared: SharedSymbols): LabelledToken {
  return { ...token, label: tokenLabel(token, shared) }
}

export function labelPool(pool: PoolMeta, shared: SharedSymbols): LabelledPool {
  return {
    ...pool,
    token0: labelToken(pool.token0, shared),
    token1: labelToken(pool.token1, shared),
  }
}
