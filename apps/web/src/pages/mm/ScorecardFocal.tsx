/**
 * The Scorecard focal (docs/design/visual-v4.md §5.9.4, §6.7): the band under the title section
 * with the KPI chart of the latest sample. Its legend row names the two sides and, in the middle,
 * the band's heading in eyebrow caps ("Depth within ±2 % against the KPI, 25 Oct 2026, 11:30
 * UTC"); the two bars meet at the spine on one scale, the KPI dashed on each side and a shortfall
 * hatched in Red, so a breach reads in one glance. With no sample yet the band holds one sentence
 * instead of empty bars. The facts row stacks over its lower edge.
 */
import type { ScorecardDetail } from '../../api/types.js'
import { KpiChart } from '../../components/charts/KpiChart.js'
import { Band } from '../../components/ui/Band.js'
import { dated, NB } from '../../lib/format.js'

export const KPI_HEADING_ID = 'sc-kpi'

/** "Depth within ±2 % against the KPI": the band's heading, with the sample's time. */
export function kpiHeading(bandPct: number, ts: number | null): string {
  const head = `Depth within ±${bandPct}${NB}% against the KPI`
  return ts === null ? head : `${head}, ${dated(ts)}`
}

export function ScorecardFocal({ detail }: { detail: ScorecardDetail }) {
  const { mandate, latest } = detail
  const { kpis } = mandate
  const heading = (
    <h2 className="eyebrow" id={KPI_HEADING_ID}>
      {kpiHeading(kpis.bandPct, latest?.timestamp ?? null)}
    </h2>
  )
  return (
    <Band labelledBy={KPI_HEADING_ID} className="sc-band">
      {latest ? (
        <KpiChart
          sell={latest.attribution.depthDownUsd}
          buy={latest.attribution.depthUpUsd}
          kpi={kpis.minDepthUsd}
          heading={heading}
        />
      ) : (
        <div className="sc-band-empty" data-in="">
          {heading}
          <p className="lead">No sample yet: the chart appears with the mandate’s first sample.</p>
        </div>
      )}
    </Band>
  )
}
