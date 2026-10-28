/**
 * The Scorecards list's block contents (ia-v3 §4.5, docs/design/visual-v4.md §6.6):
 * - `MandateRows`: the shared mandate row, reading "Demo Markets on USDC / AERO, Aerodrome v2".
 *   On desktop with 10 mandates or fewer each row adds its 7 d uptime strip, where only breaches
 *   are coloured (CH8); those samples are fetched only then (ia-v3 §6.3).
 * - `HowItWorks`: with no mandate registered, one destination block over the band that says how a
 *   scorecard is checked and opens the method (§5.12).
 */
import { useScorecardSamples } from '../../api/hooks.js'
import type { PoolMetaDto, ScorecardSummaryDto } from '../../api/types.js'
import { UptimeStrip } from '../../components/charts/UptimeStrip.js'
import { Block } from '../../components/ui/Block.js'
import { MandateRow } from '../../components/ui/MandateRow.js'
import { NB } from '../../lib/format.js'
import { poolWords, windowPoints } from './mmText.js'

/** Strips are drawn for at most this many mandates (ia-v3 §4.5). */
export const STRIP_LIMIT = 10

function RowStrip({ id }: { id: string }) {
  const samples = useScorecardSamples(id, '7d')
  const data = samples.data
  if (!data) return <span className="mml-strip-space" aria-hidden="true" />
  const points = windowPoints(data.points, [data.from, data.to])
  if (!points.length) return <span className="mml-strip-none">No samples in 7{NB}d</span>
  return (
    <div className="mml-strip">
      <UptimeStrip points={points} axis={false} />
    </div>
  )
}

export function MandateRows({
  items,
  pools,
  strips,
}: {
  items: readonly ScorecardSummaryDto[]
  pools: ReadonlyMap<string, PoolMetaDto>
  /** Draw the 7 d strips (desktop, at most `STRIP_LIMIT` mandates). */
  strips: boolean
}) {
  return (
    <ol className="rowlist is-ruled mml-list">
      {items.map((s) => {
        const words = poolWords(s.mandate.poolId, pools.get(s.mandate.poolId))
        return (
          <MandateRow
            key={s.mandate.id}
            summary={s}
            where={`${words.pair}, ${words.dex}`}
            strip={strips ? <RowStrip id={s.mandate.id} /> : undefined}
          />
        )
      })}
    </ol>
  )
}

export function HowItWorks() {
  return (
    <Block over to="/methodology#scorecards" className="mml-how">
      <span className="eyebrow">Methodology</span>
      <h2 className="h2">what a scorecard checks</h2>
      <span className="take">
        At every snapshot the pool is rebuilt with only the market maker’s own liquidity, and its
        depth on each side and its spread are measured against the mandate.
      </span>
      <span className="ulink">How scorecards work</span>
    </Block>
  )
}
