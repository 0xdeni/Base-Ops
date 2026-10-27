/**
 * Scorecard (`/mm/:id`, ia-v3 §4.6, docs/design/visual-v3.md §6.6): "Is this market maker meeting
 * its mandate right now, and how reliably?" The back link, the mandate name with its status chip
 * and the meta line; the answer (the current streak and since when); the market-maker chart with
 * the window control (`?window=`, 7 d by default) and Show data; three facts (four with a spread
 * KPI) that scrubbing rewrites; then Uptime, Breaches, Worst moments, Spread, Embed badge and
 * Mandate. One 30 d samples request serves every window. Every number is read as core stored it.
 */
import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useDataNow } from '../api/context.js'
import { isNotFound } from '../api/errors.js'
import { useScorecard, useScorecardSamples } from '../api/hooks.js'
import type { SamplesResponse, SampleWindow, ScorecardDetail } from '../api/types.js'
import { BackLink } from '../components/ui/BackLink.js'
import { NotFoundState, SectionError, useDelayedPending } from '../components/ui/States.js'
import { cachedScorecard } from '../routeData.js'
import { readWindow, scorecardAnswer } from './mm/mmText.js'
import { type SamplesState, ScorecardFocal } from './mm/ScorecardFocal.js'
import { EmbedSection, MandateAbout, SpreadSection } from './mm/ScorecardMore.js'
import { BreachesSection, UptimeSection, WorstSection } from './mm/ScorecardSections.js'
import { ScorecardSkeleton } from './mm/ScorecardSkeleton.js'
import { ScorecardTitle } from './mm/ScorecardTitle.js'
import './mm/mm.css'

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function ScorecardView({
  detail,
  samples,
  win,
  onWindow,
}: {
  detail: ScorecardDetail
  samples: SamplesState
  win: SampleWindow
  onWindow: (w: SampleWindow) => void
}) {
  const now = useDataNow()
  const [instant, setInstant] = useState(false)
  const data: SamplesResponse | undefined = samples.data
  const series = { points: data?.points, to: data?.to, win }
  // With a fourth (spread) fact the answer drops its "since …" clause (ia-v3 §4.6 budget).
  const withSince = detail.mandate.kpis.maxSpreadBps === null
  return (
    <div className="wrap page sc-page">
      <title>{`${detail.mandate.name} – Depthwatch`}</title>
      <ScorecardTitle detail={detail} />
      <p className="answer answer-block">{scorecardAnswer(detail, now, withSince)}</p>
      <ScorecardFocal
        detail={detail}
        samples={samples}
        win={win}
        instant={instant}
        onInstant={setInstant}
        onWindow={(w, keyboard) => {
          setInstant(keyboard)
          onWindow(w)
        }}
      />
      <div className="secs">
        <UptimeSection detail={detail} {...series} />
        <BreachesSection
          {...series}
          now={now}
          onRetry={samples.isError ? () => void samples.refetch() : undefined}
        />
        <WorstSection detail={detail} now={now} />
        <SpreadSection detail={detail} instant={instant} {...series} />
        <EmbedSection detail={detail} />
        <MandateAbout detail={detail} now={now} />
      </div>
    </div>
  )
}

export function Scorecard() {
  const { id: rawId = '' } = useParams()
  const id = decodeId(rawId)
  const scorecard = useScorecard(id)
  const samples = useScorecardSamples(id, '30d')
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const win = readWindow(params.get('window'))
  const showSkeleton = useDelayedPending(scorecard.isPending)

  const onWindow = (w: SampleWindow) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (w === '7d') next.delete('window')
        else next.set('window', w)
        return next
      },
      { replace: true },
    )

  let content: ReactNode
  if (scorecard.data) {
    content = (
      <ScorecardView detail={scorecard.data} samples={samples} win={win} onWindow={onWindow} />
    )
  } else if (scorecard.isError && isNotFound(scorecard.error)) {
    content = (
      <NotFoundState
        title="Scorecard not found"
        message="No market-maker mandate is registered under this id, or the link is wrong."
        id={id}
        links={{
          primary: { to: '/mm', label: 'Browse scorecards' },
          secondary: { to: '/methodology#scorecards', label: 'How scorecards work' },
        }}
      />
    )
  } else if (scorecard.isError) {
    content = (
      <div className="wrap page sc-page">
        <div className="title-block">
          <BackLink to="/mm" label="Scorecards" />
        </div>
        <div className="answer-block">
          <SectionError what="this scorecard" onRetry={() => void scorecard.refetch()} />
        </div>
      </div>
    )
  } else {
    // The title block from the scorecards list and the pool's summary, so it never waits (ST1).
    content = <ScorecardSkeleton visible={showSkeleton} cached={cachedScorecard(qc, id)} />
  }
  return content
}
