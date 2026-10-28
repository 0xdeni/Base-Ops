/**
 * The Pool band (docs/design/visual-v4.md §6.4, §5.9.3): full-bleed Base Blue under the title
 * section, carrying the focal mirrored depth curve. Its legend row names the two sides and, in the
 * middle, the band's heading in eyebrow caps; under the curve, "Show data" opens the ±1 / 2 / 5 %
 * table in a surface block (CH9). With no snapshot yet the band holds one sentence instead. The
 * facts row stacks over its lower edge.
 */
import type { PoolDetail } from '../../api/types.js'
import { DepthCurveTable } from '../../components/charts/ChartTables.js'
import { DepthCurve } from '../../components/charts/DepthCurve.js'
import { Band } from '../../components/ui/Band.js'
import { NB } from '../../lib/format.js'

export const DEPTH_HEADING = `Depth to move the price, measured at ±1, 2 and 5${NB}%`

export function PoolBand({ detail }: { detail: PoolDetail }) {
  const { pool, latest } = detail
  return (
    <Band labelledBy="pool-depth" className="pool-band">
      {latest ? (
        <DepthCurve
          snapshot={latest}
          token0={pool.token0}
          token1={pool.token1}
          heading={
            <h2 className="eyebrow" id="pool-depth">
              {DEPTH_HEADING}
            </h2>
          }
        >
          <DepthCurveTable snapshot={latest} token0={pool.token0} token1={pool.token1} />
        </DepthCurve>
      ) : (
        <>
          <h2 className="eyebrow" id="pool-depth" data-in="">
            {DEPTH_HEADING}
          </h2>
          <p className="lead pool-band-empty" data-in="">
            No snapshot yet: the curve appears after the pool’s first snapshot.
          </p>
        </>
      )}
    </Band>
  )
}
