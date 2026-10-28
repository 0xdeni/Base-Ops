/**
 * The Token band (docs/design/visual-v4.md §6.8, §5.9.1): full-bleed Base Blue under the title
 * section, carrying the depth butterfly scoped to the token. Its pools are seen from the token
 * (sides swapped where it is token1) on their own scale: the total row is "All of WETH", the
 * bracket names its deepest pool, and the biggest meaningful gap among them carries the "Gap"
 * marker. "Show data" opens the per-pool table in a surface block (CH9). The facts row stacks over
 * the band's lower edge.
 */
import type { PoolSummary } from '../../api/types.js'
import { ButterflyTable } from '../../components/charts/ChartTables.js'
import { type ButterflyGap, DepthButterfly } from '../../components/charts/DepthButterfly.js'
import { Band } from '../../components/ui/Band.js'
import { count, NB } from '../../lib/format.js'

export function TokenBand({
  symbol,
  pools,
  gap,
}: {
  symbol: string
  /** Seen from this token (sides oriented). */
  pools: readonly PoolSummary[]
  gap: ButterflyGap | null
}) {
  const n = pools.length
  return (
    <Band labelledBy="token-depth" className="token-band">
      <h2 className="eyebrow eb-row token-band-eb" id="token-depth" data-in="">
        <span>
          Depth within ±2{NB}% of {symbol}’s price
        </span>{' '}
        {n ? (
          <span className="token-ph-hide">
            {count(n)} scored {n === 1 ? 'pool' : 'pools'}
          </span>
        ) : null}
      </h2>
      {n ? (
        <DepthButterfly pools={pools} gap={gap} scope={symbol}>
          <ButterflyTable pools={pools} gapPoolId={gap?.poolId} scope={symbol} />
          <p className="tbl-note">
            Sides are {symbol}’s: selling {symbol} pushes its price down. A pool counts in full on
            the page of each of its two tokens.
          </p>
        </DepthButterfly>
      ) : (
        <p className="lead token-band-empty" data-in="">
          No pool with {symbol} is scored yet, so there is no depth to draw.
        </p>
      )}
    </Band>
  )
}
