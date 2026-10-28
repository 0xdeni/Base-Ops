/**
 * Token labels on the wire (DESIGN.md "API (apps/api)"): every token object a response carries
 * adds `label`, core's `tokenLabel` over the tokens of scored pools (`tokens.sharedSymbols()`,
 * read once per request). A symbol is not an identity: Aerodrome's and Aero's AERO both answer
 * "AERO", so the label names them apart; the address stays the identity. A pool whose two tokens
 * share a symbol labels them against that index plus the two tokens, so the pair is told apart
 * even when neither token is in a scored pool (an unscored AERO/AERO pool, a fresh database).
 */
import {
  type PoolMeta,
  type SharedSymbols,
  symbolKey,
  type TokenInfo,
  tokenLabel,
  withTokens,
} from '@depthwatch/core'

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
  const { token0, token1 } = pool
  const index =
    symbolKey(token0.symbol) === symbolKey(token1.symbol)
      ? withTokens(shared, [token0, token1])
      : shared
  return { ...pool, token0: labelToken(token0, index), token1: labelToken(token1, index) }
}
