/**
 * The Scorecard focal and facts (ia-v3 §4.6, docs/design/visual-v3.md §5.9 "Market-maker chart",
 * §6.6): market-maker depth per side against the KPI, with the "Whole-pool depth"
 * checkbox and the 24 h / 7 d / 30 d control in its head row and "Show data" in its foot row; then
 * the facts. Scrubbing the chart rewrites the facts to that sample ("sell side then, below the $50K
 * KPI") with their triangles, and the chart's caption carries the status and the UTC time (CH2).
 * The 30 d series serves every window, so a window switch morphs the same points (§4 row 10).
 */
import { type ReactNode, useState } from 'react'
import type {
  MmSampleDto,
  SamplesResponse,
  SampleWindow,
  ScorecardDetail,
} from '../../api/types.js'
import { BulletGraph, depthBullet } from '../../components/charts/BulletGraph.js'
import { MarketMakerTable } from '../../components/charts/ChartTables.js'
import { MarketMakerChart } from '../../components/charts/MarketMakerChart.js'
import { Fact, Facts } from '../../components/ui/Fact.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { Checkbox } from '../../components/ui/Inputs.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import {
  EmptyState,
  SectionError,
  Skeleton,
  useDelayedPending,
} from '../../components/ui/States.js'
import { bps, NB, uptime, usd } from '../../lib/format.js'
import { sampleMark } from '../../lib/scorecard.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { markWord, uptimeLabel, WINDOW_LABEL, WINDOW_SHORT, windowDomain } from './mmText.js'

const WINDOWS: readonly SampleWindow[] = ['24h', '7d', '30d']

export interface SamplesState {
  data: SamplesResponse | undefined
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

interface Scrub {
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
  const v = sample
    ? side === 'sell'
      ? sample.attribution.depthDownUsd
      : sample.attribution.depthUpUsd
    : null
  const mark = sampleMark(sample, side === 'sell' ? 'depthDown' : 'depthUp')
  const lead = `${side} side ${when ?? 'now'}, ${markWord(mark)} the ${usd(kpi)}`
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

/** The facts row: both sides now (or at the scrubbed sample), 7 d uptime, and spread with a KPI. */
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
  const d7 = detail.uptime.d7.uptime
  const max = kpis.maxSpreadBps
  const spreadMark = sampleMark(sample, 'spread')
  const spread = sample?.attribution.spreadBps ?? null
  return (
    <Facts layout="scorecard" className="sc-facts" label="Mandate now">
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
        value={uptime(d7)}
        label={uptimeLabel(detail.uptime.d7, kpis.targetUptime)}
        breached={d7 !== null && d7 < kpis.targetUptime}
        breachedLabel="Below target"
        bullet={
          <BulletGraph
            value={d7}
            target={kpis.targetUptime}
            wide
            label={`7 day uptime ${uptime(d7)} against a ${uptime(kpis.targetUptime)} target`}
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
    </Facts>
  )
}

/** The reserved focal while samples load: nothing for 300 ms, then a static block (CLS 0). */
function FocalSkeleton({ pending }: { pending: boolean }) {
  const phone = useIsPhone()
  const shown = useDelayedPending(pending)
  const h = phone ? 240 : 340
  return (
    <div className="sc-fig-skel" style={{ height: h + 92 }} aria-busy="true">
      {shown ? <Skeleton height={h} className="sc-fig-skel-plot" /> : null}
    </div>
  )
}

export function ScorecardFocal({
  detail,
  samples,
  win,
  instant,
  onWindow,
  onInstant,
}: {
  detail: ScorecardDetail
  samples: SamplesState
  win: SampleWindow
  /** The latest window or context change came from the keyboard: no morph (M2). */
  instant: boolean
  onWindow: (w: SampleWindow, keyboard: boolean) => void
  onInstant: (keyboard: boolean) => void
}) {
  const [scrub, setScrub] = useState<Scrub | null>(null)
  const [wholePool, setWholePool] = useState(false)
  const { mandate } = detail
  const data = samples.data
  let figure: ReactNode
  if (data?.points.length) {
    const dom = windowDomain(data.to, win)
    figure = (
      <MarketMakerChart
        points={data.points}
        kpi={mandate.kpis.minDepthUsd}
        registeredAt={mandate.createdAt}
        domain={dom}
        windowLabel={WINDOW_LABEL[win]}
        wholePool={wholePool}
        instant={instant}
        onScrub={(p, latest) => setScrub(p ? { p, latest } : null)}
        controls={
          <>
            <Checkbox
              checked={wholePool}
              onChange={(on, { keyboard }) => {
                onInstant(keyboard)
                setWholePool(on)
              }}
            >
              Whole-pool depth
            </Checkbox>
            <SegmentedControl
              label="Time window"
              options={WINDOWS.map((w) => ({ value: w, label: WINDOW_SHORT[w] }))}
              value={win}
              onChange={(w, { keyboard }) => onWindow(w, keyboard)}
            />
          </>
        }
      >
        <MarketMakerTable points={data.points} window={win} from={dom[0]} />
      </MarketMakerChart>
    )
  } else if (data) {
    figure = <EmptyState>No samples in the last 30 days.</EmptyState>
  } else if (samples.isError) {
    figure = <SectionError what="samples" onRetry={() => void samples.refetch()} />
  } else {
    figure = <FocalSkeleton pending={samples.isPending} />
  }
  return (
    <>
      <div className="sc-fig">{figure}</div>
      <ScorecardFacts detail={detail} scrub={scrub} />
    </>
  )
}
