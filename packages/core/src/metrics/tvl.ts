/**
 * TVL in USD from raw reserves. Sides without a USD price are skipped; when neither token is
 * priced the result is null (a one-sided value is therefore a lower bound).
 */

import { rawToHuman } from '../math.js'
import type { TokenInfo } from '../types.js'

export function tvlUsd(
  reserve0: bigint,
  reserve1: bigint,
  token0: TokenInfo,
  token1: TokenInfo,
  token0Usd: number | null,
  token1Usd: number | null,
): number | null {
  const side0 = token0Usd === null ? null : rawToHuman(reserve0, token0.decimals) * token0Usd
  const side1 = token1Usd === null ? null : rawToHuman(reserve1, token1.decimals) * token1Usd
  if (side0 === null && side1 === null) return null
  return (side0 ?? 0) + (side1 ?? 0)
}
