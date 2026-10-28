/**
 * "depth over time", the first row of the Scorecard's sections sheet (docs/design/visual-v4.md
 * §5.9.5, §6.7): the market maker's depth per side over the window, buy above the zero line and
 * sell below it on one symmetric scale, the KPI dashed on each side and breaches as Red bands.
 * The finding is core's streak ("Within KPI for 58 consecutive samples, since 4 Oct, 14:53 UTC").
 * The head row of the chart holds the "Whole-pool depth" toggle and the 24 h / 7 d / 30 d control
 * (`?window=`, which every section follows); "Show data" opens the samples under it, and, for a
 * mandate with no spread KPI, "Show measured spread" opens the spread series. Scrubbing,
 * by pointer or arrow keys, reports the sample so the facts read it. One 30 d series serves every
 * window, so a window switch morphs the same points (§4.3); from the keyboard it is instant.
 */
import { type ReactNode, useState } from 'react'
import type { SamplesResponse, SampleWindow, ScorecardDetail } from '../../api/types.js'
import { MarketMakerTable } from '../../components/charts/ChartTables.js'
import { MarketMakerChart } from '../../components/charts/MarketMakerChart.js'
import { Checkbox } from '../../components/ui/Inputs.js'
import { Section } from '../../components/ui/Section.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SectionError, Skeleton, useDelayedPending } from '../../components/ui/States.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { streakLine, WINDOW_LABEL, WINDOW_SHORT, windowDomain } from './mmText.js'
import type { Scrub } from './ScorecardFacts.js'
import { SpreadMultiples } from './ScorecardMore.js'

const WINDOWS: readonly SampleWindow[] = ['24h', '7d', '30d']

export interface SamplesState {
  data: SamplesResponse | undefined
  isPending: boolean
  isError: boolean
  refetch: () => unknown
}

/** The chart's reserved space while the samples load: nothing for 300 ms, then a static block. */
function ChartSkeleton({ pending }: { pending: boolean }) {
  const phone = useIsPhone()
  const shown = useDelayedPending(pending)
  return (
    <div className="sc-time-skel" style={{ height: (phone ? 240 : 300) + 88 }}>
      {shown ? <Skeleton height={phone ? 240 : 300} className="sc-time-skel-plot" /> : null}
    </div>
  )
}

export function TimeSection({
  detail,
  samples,
  win,
  now,
  instant,
  onWindow,
  onInstant,
  onScrub,
}: {
  detail: ScorecardDetail
  samples: SamplesState
  win: SampleWindow
  now: number
  /** The latest window or context change came from the keyboard: no morph (M2). */
  instant: boolean
  onWindow: (w: SampleWindow, keyboard: boolean) => void
  onInstant: (keyboard: boolean) => void
  onScrub: (scrub: Scrub | null) => void
}) {
  const [wholePool, setWholePool] = useState(false)
  const noSpreadKpi = detail.mandate.kpis.maxSpreadBps === null
  const { mandate } = detail
  const data = samples.data
  let body: ReactNode
  if (data?.points.length) {
    const dom = windowDomain(data.to, win)
    body = (
      <MarketMakerChart
        points={data.points}
        kpi={mandate.kpis.minDepthUsd}
        registeredAt={mandate.createdAt}
        domain={dom}
        windowLabel={WINDOW_LABEL[win]}
        wholePool={wholePool}
        instant={instant}
        onScrub={(p, latest) => onScrub(p ? { p, latest } : null)}
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
    body = <p className="takeaway">No samples in the last 30 days.</p>
  } else if (samples.isError) {
    body = <SectionError what="samples" onRetry={() => void samples.refetch()} />
  } else {
    body = <ChartSkeleton pending={samples.isPending} />
  }
  return (
    <Section
      id="s-time"
      className="sc-time"
      title="depth over time"
      takeaway={streakLine(detail, now)}
      details={
        noSpreadKpi && data?.points.length
          ? {
              label: 'Show measured spread',
              openLabel: 'Hide measured spread',
              content: (
                <>
                  <p className="takeaway">This mandate has no spread KPI.</p>
                  <SpreadMultiples
                    detail={detail}
                    points={data.points}
                    to={data.to}
                    win={win}
                    instant={instant}
                  />
                </>
              ),
            }
          : undefined
      }
    >
      {body}
    </Section>
  )
}
