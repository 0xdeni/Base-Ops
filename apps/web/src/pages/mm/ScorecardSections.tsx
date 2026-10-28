/**
 * Three rows of the Scorecard's sections sheet (ia-v3 §4.6, docs/design/visual-v4.md §6.7):
 * - uptime: the strip for the selected window; the takeaway carries core's counts; Details holds
 *   all three windows, with unpriced samples counted separately.
 * - breaches: episode rows, newest first, three then "Show all N episodes"; the
 *   takeaway ends with when alerts fire, and "Show samples" reveals the raw breached samples with
 *   their blocks.
 * - worst moments (30 d), when there is history: the lowest depth per side (and the widest
 *   spread with a spread KPI) against the KPI, the block on hover and focus, and in Details.
 */
import type { ExcursionDto, MmSampleDto, SampleWindow, ScorecardDetail } from '../../api/types.js'
import { UptimeStrip } from '../../components/charts/UptimeStrip.js'
import { Disclosure } from '../../components/ui/Disclosure.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { Section } from '../../components/ui/Section.js'
import { SectionError } from '../../components/ui/States.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { abs, bps, count, full, group, NB, uptime, usd, when } from '../../lib/format.js'
import { type BreachEpisode, breachEpisodes, breachSides, sampleKeys } from '../../lib/scorecard.js'
import {
  alertsLine,
  capital,
  episodeLowest,
  episodesLine,
  episodeWhat,
  UPTIME_KEY,
  uptimeLine,
  WINDOW_SHORT,
  windowDomain,
  windowPoints,
} from './mmText.js'

const WINDOWS: readonly SampleWindow[] = ['24h', '7d', '30d']
/** Raw breached samples shown under "Show samples" (the v2 breach table showed ten). */
const SAMPLE_ROWS = 12

export interface SeriesProps {
  /** The 30 d samples, ascending; undefined while they load or after an error. */
  points: readonly MmSampleDto[] | undefined
  /** The samples response's `to` (the server clock). */
  to: number | undefined
  win: SampleWindow
}

function UptimeTable({
  detail,
  points,
  to,
}: { detail: ScorecardDetail } & Omit<SeriesProps, 'win'>) {
  return (
    <TableScroll>
      <table className="tbl dense">
        <caption className="sr-only">Uptime per window</caption>
        <thead>
          <tr>
            <th scope="col">Window</th>
            <th scope="col" className="r">
              Samples
            </th>
            <th scope="col" className="r">
              Within KPI
            </th>
            <th scope="col" className="r">
              Uptime
            </th>
            <th scope="col" className="r">
              Not evaluable
            </th>
          </tr>
        </thead>
        <tbody>
          {WINDOWS.map((w) => {
            const u = detail.uptime[UPTIME_KEY[w]]
            const unpriced =
              points && to !== undefined
                ? windowPoints(points, windowDomain(to, w)).filter((p) => p.withinKpi === null)
                    .length
                : null
            return (
              <tr key={w}>
                <td>{WINDOW_SHORT[w]}</td>
                <td className="r num">{count(u.samples)}</td>
                <td className="r num">{count(u.withinKpi)}</td>
                <td className="r num">{uptime(u.uptime)}</td>
                <td className="r num">{count(unpriced)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </TableScroll>
  )
}

export function UptimeSection({
  detail,
  points,
  to,
  win,
}: { detail: ScorecardDetail } & SeriesProps) {
  const u = detail.uptime[UPTIME_KEY[win]]
  const strip = points && to !== undefined ? windowPoints(points, windowDomain(to, win)) : undefined
  return (
    <Section
      id="s-up"
      title="uptime"
      takeaway={uptimeLine(u, win, detail.mandate.kpis.targetUptime)}
      details={{ content: <UptimeTable detail={detail} points={points} to={to} /> }}
    >
      {strip ? (
        <UptimeStrip points={strip} unchecked="Not checkable: no USD price" />
      ) : (
        <div className="sc-strip-space" />
      )}
    </Section>
  )
}

function EpisodeRow({ ep, now }: { ep: BreachEpisode; now: number }) {
  return (
    <li>
      <div className="rl-row sc-ep-row">
        <span className="sc-ep-when" title={full(ep.start)}>
          {when(ep.start, now)}
        </span>
        <span className="sc-ep-what">{episodeWhat(ep)}</span>
        <span className="sc-ep-worst num">
          {usd(episodeLowest(ep))} <span className="faint small">lowest</span>
        </span>
      </div>
    </li>
  )
}

function SampleTable({ rows }: { rows: readonly MmSampleDto[] }) {
  if (!rows.length) return <p className="small faint">No breached samples in this window.</p>
  const shown = rows.slice(0, SAMPLE_ROWS)
  // Two samples can share a block and a timestamp (a `mm sample` and a `snapshot`).
  const keys = sampleKeys(shown)
  return (
    <>
      <TableScroll>
        <table className="tbl dense">
          <caption className="sr-only">Breached samples, newest first</caption>
          <thead>
            <tr>
              <th scope="col">Time (UTC)</th>
              <th scope="col">Sides</th>
              <th scope="col" className="r">
                Buy side
              </th>
              <th scope="col" className="r">
                Sell side
              </th>
              <th scope="col" className="r">
                Spread
              </th>
              <th scope="col" className="r">
                Block
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={keys[i]}>
                <td className="nowrap">{abs(p.timestamp)}</td>
                <td className="nowrap">{capital(breachSides(p.breaches))}</td>
                <td className="r num">{usd(p.attribution.depthUpUsd)}</td>
                <td className="r num">{usd(p.attribution.depthDownUsd)}</td>
                <td className="r num">{bps(p.attribution.spreadBps)}</td>
                <td className="r mono">{group(p.blockNumber)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {rows.length > shown.length ? (
        <p className="tbl-note">
          The {count(shown.length)} newest of {count(rows.length)} breached samples.
        </p>
      ) : null}
    </>
  )
}

export function BreachesSection({
  points,
  to,
  win,
  now,
  alertAfter,
  onRetry,
}: SeriesProps & { now: number; alertAfter: number; onRetry?: () => void }) {
  if (!points || to === undefined) {
    return (
      <Section id="s-br" title="breaches">
        {onRetry ? (
          <SectionError what="samples" onRetry={onRetry} />
        ) : (
          <div className="sc-eps-space" />
        )}
      </Section>
    )
  }
  const pts = windowPoints(points, windowDomain(to, win))
  const eps = breachEpisodes(pts)
  const rows = [...eps].reverse()
  const n = 3
  const rest = rows.slice(n)
  const breached = pts.filter((p) => p.withinKpi === false).reverse()
  return (
    <Section
      id="s-br"
      title="breaches"
      takeaway={
        eps.length ? `${episodesLine(eps, win)} ${alertsLine(alertAfter)}` : episodesLine(eps, win)
      }
      details={
        breached.length
          ? { label: 'Show samples', content: <SampleTable rows={breached} /> }
          : undefined
      }
    >
      {rows.length ? (
        <ol className="rowlist is-ruled">
          {rows.slice(0, n).map((ep) => (
            <EpisodeRow key={ep.start} ep={ep} now={now} />
          ))}
        </ol>
      ) : null}
      {rest.length ? (
        <Disclosure
          label={`Show all ${count(rows.length)} episodes`}
          openLabel="Show fewer"
          className="sc-eps-more"
        >
          <ol className="rowlist">
            {rest.map((ep) => (
              <EpisodeRow key={ep.start} ep={ep} now={now} />
            ))}
          </ol>
        </Disclosure>
      ) : null}
    </Section>
  )
}

interface WorstRow {
  label: string
  e: ExcursionDto
  fmt: (v: number | null) => string
}

export function WorstSection({ detail, now }: { detail: ScorecardDetail; now: number }) {
  const { worst } = detail
  const kpi = detail.mandate.kpis.minDepthUsd
  const rows: WorstRow[] = []
  if (worst.minDepthUpUsd)
    rows.push({ label: 'Lowest buy-side depth', e: worst.minDepthUpUsd, fmt: usd })
  if (worst.minDepthDownUsd)
    rows.push({ label: 'Lowest sell-side depth', e: worst.minDepthDownUsd, fmt: usd })
  if (worst.maxSpreadBps) rows.push({ label: 'Widest spread', e: worst.maxSpreadBps, fmt: bps })
  // Without history there is no worst moment to show; the row is left out (§6.7).
  if (!rows.length) return null
  return (
    <Section
      id="s-worst"
      title="worst moments"
      takeaway={`The lowest depth seen in 30${NB}d, against the ${usd(kpi)} KPI.`}
      details={{
        content: (
          <TableScroll>
            <table className="tbl dense">
              <caption className="sr-only">Worst moments in 30 days</caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  <th scope="col" className="r">
                    Value
                  </th>
                  <th scope="col" className="r">
                    KPI
                  </th>
                  <th scope="col">Time (UTC)</th>
                  <th scope="col" className="r">
                    Block
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ label, e, fmt }) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="r num">{fmt(e.value)}</td>
                    <td className="r num">{fmt(e.threshold)}</td>
                    <td className="nowrap">{abs(e.timestamp)}</td>
                    <td className="r mono">{group(e.blockNumber)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        ),
      }}
    >
      <ol className="rowlist is-ruled">
        {rows.map(({ label, e, fmt }) => (
          <li key={label}>
            <div className="rl-row sc-worst-row">
              <span className="sc-w-k">{label}</span>
              <span className="sc-w-v num">
                {fmt(e.value)} <span className="faint">KPI {fmt(e.threshold)}</span>
              </span>
              <span className="sc-w-t">
                <Glossary
                  definition={`Block ${group(e.blockNumber)}, ${full(e.timestamp)}`}
                  className="touch-hit"
                >
                  {when(e.timestamp, now)}
                </Glossary>
              </span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  )
}
