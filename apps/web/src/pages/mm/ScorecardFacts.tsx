/**
 * The Scorecard's facts row (docs/design/visual-v4.md §5.6, §6.7): one ink block over the band's
 * lower edge. The sell and the buy side now against the per-side KPI, each with its bullet; then
 * the 7 d uptime as a count ("80 of 83") over "samples within KPI in 7 d: uptime 96.4 %, target
 * 95 %", the bullet ticked at the target; and, with a spread KPI, the spread now. Scrubbing the
 * time chart rewrites the two sides and the spread to that sample ("sell side then, below the
 * $50K KPI"); the uptime stays the window's. Marks read the sample's stored evaluation.
 */
import type { MmSampleDto, ScorecardDetail } from '../../api/types.js'
import { BulletGraph, depthBullet } from '../../components/charts/BulletGraph.js'
import { Overlap } from '../../components/ui/Block.js'
import { Fact, FactsRow } from '../../components/ui/Fact.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { bps, NB, uptime, usd } from '../../lib/format.js'
import { sampleMark } from '../../lib/scorecard.js'
import { markWord, uptimeFact, uptimeLabel } from './mmText.js'

/** The sample the time chart is scrubbed to; `latest` is true for the newest one. */
export interface Scrub {
  p: MmSampleDto
  latest: boolean
}

function DepthFact({
  side,
  sample,
  when,
  kpi,
  bandPct,
}: {
  side: 'sell' | 'buy'
  sample: MmSampleDto | null
  when: 'now' | 'then' | null
  kpi: number
  bandPct: number
}) {
  const a = sample?.attribution
  const v = a ? (side === 'sell' ? a.depthDownUsd : a.depthUpUsd) : null
  const mark = sampleMark(sample, side === 'sell' ? 'depthDown' : 'depthUp')
  const lead = `${side} side ${when ?? 'now'}, ${markWord(mark)} the ${usd(kpi)}`
  // At rest "KPI" opens its definition; while scrubbing the label is plain words.
  const label =
    when === null ? (
      <>
        {lead}{' '}
        <Glossary
          definition={`The minimum depth the market maker agreed to keep on each side, within ±${bandPct}${NB}% of the price.`}
          anchor="scorecards"
        >
          KPI
        </Glossary>
      </>
    ) : (
      `${lead} KPI`
    )
  return (
    <Fact
      value={usd(v)}
      label={label}
      breached={mark === 'fail'}
      bullet={
        <BulletGraph
          {...depthBullet(v, kpi)}
          wide
          label={`${side === 'sell' ? 'Sell' : 'Buy'} side ${usd(v)} against the ${usd(kpi)} KPI`}
        />
      }
    />
  )
}

export function ScorecardFacts({
  detail,
  scrub,
}: {
  detail: ScorecardDetail
  scrub: Scrub | null
}) {
  const { kpis } = detail.mandate
  const sample = scrub ? scrub.p : detail.latest
  const when = scrub ? (scrub.latest ? 'now' : 'then') : null
  const d7 = detail.uptime.d7
  const max = kpis.maxSpreadBps
  const spreadMark = sampleMark(sample, 'spread')
  const spread = sample?.attribution.spreadBps ?? null
  return (
    <Overlap label="Mandate now" className="sc-facts-wrap">
      <FactsRow
        layout="scorecard"
        label="Mandate now"
        className={`sc-facts${max !== null ? ' is-four' : ''}`}
      >
        <DepthFact
          side="sell"
          sample={sample}
          when={when}
          kpi={kpis.minDepthUsd}
          bandPct={kpis.bandPct}
        />
        <DepthFact
          side="buy"
          sample={sample}
          when={when}
          kpi={kpis.minDepthUsd}
          bandPct={kpis.bandPct}
        />
        <Fact
          value={uptimeFact(d7)}
          label={uptimeLabel(d7, kpis.targetUptime)}
          breached={d7.uptime !== null && d7.uptime < kpis.targetUptime}
          breachedLabel="Below target"
          bullet={
            <BulletGraph
              value={d7.uptime}
              target={kpis.targetUptime}
              wide
              label={`7 day uptime ${uptime(d7.uptime)} against a ${uptime(kpis.targetUptime)} target`}
            />
          }
        />
        {max !== null ? (
          <Fact
            value={spread === null ? (spreadMark === 'fail' ? 'Not fillable' : '—') : bps(spread)}
            label={`spread at ${usd(kpis.spreadNotionalUsd)} ${when ?? 'now'}, ${markWord(spreadMark, 'above')} the ${bps(max)} KPI`}
            breached={spreadMark === 'fail'}
            breachedLabel="Above KPI"
            bullet={
              <BulletGraph
                value={spread}
                target={max}
                max={max * 1.5}
                wide
                label={`Spread ${bps(spread)} against the ${bps(max)} KPI`}
              />
            }
          />
        ) : null}
      </FactsRow>
    </Overlap>
  )
}
