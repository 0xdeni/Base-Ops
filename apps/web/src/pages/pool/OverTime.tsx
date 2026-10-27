/**
 * "Over time" (ia-v3 §4.3 section 4, docs/design/visual-v3.md §6.3): the 24 h / 7 d window control
 * with "Times in UTC", then the depth ±2 % and spread at $10K small multiples sharing one x axis.
 * The 7 d series is drawn under both windows, so 24 h is its tail and a window switch morphs the
 * same points (§4 row 9; instant from the keyboard). The window lives in the URL (`window`). The
 * takeaway reads persistence; Details holds the persistence table and the health, TVL and price
 * series (L2).
 */
import { type ReactNode, useState } from 'react'
import { usePoolHistory } from '../../api/hooks.js'
import type {
  HistoryPoint,
  HistoryWindow,
  PersistenceMetrics,
  PoolDetail,
} from '../../api/types.js'
import { type MultipleSeries, SmallMultiples } from '../../components/charts/SmallMultiples.js'
import { Section } from '../../components/ui/Section.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SectionError, Skeleton, useDelayedPending } from '../../components/ui/States.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { TextChange } from '../../components/ui/TextChange.js'
import { bps, count, NB, price, score, uptime, usd, usdTick } from '../../lib/format.js'
import { baseQuote } from '../../lib/orient.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { persistenceParts } from './poolText.js'

const DAY = 86_400
const WINDOW_LABEL: Readonly<Record<HistoryWindow, string>> = {
  '24h': '24 hours',
  '7d': '7 days',
}
const WINDOW_SHORT: Readonly<Record<HistoryWindow, string>> = {
  '24h': `24${NB}h`,
  '7d': `7${NB}d`,
}

const spreadTick = (v: number) => (v < 100 ? v.toFixed(1) : String(Math.round(v)))

function mainSeries(
  p: PersistenceMetrics | null,
  w: HistoryWindow,
): MultipleSeries<HistoryPoint>[] {
  const band =
    p && p.depthUsdP10 !== null && p.depthUsdMedian !== null
      ? ([p.depthUsdP10, p.depthUsdMedian] as const)
      : null
  return [
    {
      key: 'depth',
      label: `Depth ±2${NB}%`,
      height: 160,
      value: (pt) => pt.depth2Usd,
      format: usd,
      tick: usdTick,
      band,
      bandLabel: `p10 to median, ${WINDOW_SHORT[w]}`,
    },
    {
      key: 'spread',
      label: 'Spread at $10K',
      height: 120,
      value: (pt) => pt.spread10kBps,
      format: bps,
      tick: spreadTick,
      minSpan: 0.2,
    },
  ]
}

/** A tick of a series whose nice steps can be fractional: "2,450", "84.5", "0.795". */
const fineTick = (v: number) =>
  Number(v.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 6 })

function moreSeries(
  points: readonly HistoryPoint[],
  pool: PoolDetail['pool'],
  spot: number | null,
): MultipleSeries<HistoryPoint>[] {
  // The price reads from the pool's base token, as the title's price line does (N2).
  const { base, quote, inverted } = baseQuote(pool, spot)
  const out: MultipleSeries<HistoryPoint>[] = [
    {
      key: 'health',
      label: 'Health',
      height: 120,
      value: (pt) => pt.health,
      format: score,
      tick: fineTick,
      minSpan: 0.1,
    },
  ]
  if (points.some((pt) => pt.tvlUsd !== null))
    out.push({
      key: 'tvl',
      label: 'TVL',
      height: 120,
      value: (pt) => pt.tvlUsd,
      format: usd,
      tick: usdTick,
      minSpan: 0.05,
    })
  out.push({
    key: 'price',
    label: `Price, ${quote.symbol} per ${base.symbol}`,
    height: 120,
    value: (pt) => (inverted ? (pt.price > 0 ? 1 / pt.price : null) : pt.price),
    format: price,
    tick: fineTick,
    minSpan: 0.02,
  })
  return out
}

function PersistenceTable({ detail }: { detail: PoolDetail }) {
  const rows: [string, PersistenceMetrics | null][] = [
    [WINDOW_SHORT['24h'], detail.persistence24h],
    [WINDOW_SHORT['7d'], detail.persistence7d],
  ]
  const thin = rows.every(([, p]) => (p?.samples ?? 0) < 3)
  const short = !thin && rows.every(([, p]) => p === null || p.stability === null)
  return (
    <>
      <TableScroll>
        <table className="tbl dense">
          <caption className="sr-only">Persistence of depth ±2{NB}% per window</caption>
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col" className="r">
                Samples
              </th>
              <th scope="col" className="r">
                Median
              </th>
              <th scope="col" className="r">
                p10
              </th>
              <th scope="col" className="r">
                Min
              </th>
              <th scope="col" className="r">
                Stability
              </th>
              <th scope="col" className="r">
                Uptime
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, p]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="r num">{count(p?.samples)}</td>
                <td className="r num">{usd(p?.depthUsdMedian)}</td>
                <td className="r num">{usd(p?.depthUsdP10)}</td>
                <td className="r num">{usd(p?.depthUsdMin)}</td>
                <td className="r num">{uptime(p?.stability)}</td>
                <td className="r num">{uptime(p?.uptime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="tbl-note">
        {thin
          ? 'Fewer than 3 snapshots: persistence is scored neutral until more arrive.'
          : short
            ? 'The snapshots span under a quarter of each window: persistence is scored neutral until they cover it.'
            : 'Stability is p10 over the median; uptime is the share of snapshots at or above half the median.'}
      </p>
    </>
  )
}

export function OverTime({
  detail,
  window: win,
  onWindow,
}: {
  detail: PoolDetail
  window: HistoryWindow
  onWindow: (w: HistoryWindow) => void
}) {
  const history = usePoolHistory(detail.pool.id, '7d')
  const [keyboard, setKeyboard] = useState(false)
  const loading = useDelayedPending(history.isPending)
  const phone = useIsPhone()
  const p = win === '7d' ? detail.persistence7d : detail.persistence24h
  const parts = persistenceParts(p)
  const data = history.data
  const domain: readonly [number, number] | null = data
    ? win === '7d'
      ? [data.from, data.to]
      : [data.to - DAY, data.to]
    : null
  const takeaway = parts ? (
    <>
      Depth stayed above half its median in <TextChange value={parts.uptime} animate={!keyboard} />{' '}
      of <TextChange value={parts.samples} animate={!keyboard} /> snapshots.
    </>
  ) : (p?.samples ?? 0) >= 3 ? (
    'Snapshots cover too little of the window to judge how steady the depth is.'
  ) : (
    'Too few snapshots yet to judge how steady the depth is.'
  )
  let body: ReactNode
  if (history.isError && !data) {
    body = <SectionError what="history" onRetry={() => void history.refetch()} />
  } else if (!data || !domain) {
    const h = phone ? 280 : 372
    body = loading ? <Skeleton height={h} /> : <div style={{ height: h }} />
  } else if (data.points.length < 2) {
    body = <p className="muted">Not enough snapshots yet to draw a series.</p>
  } else {
    body = (
      <SmallMultiples
        points={data.points}
        series={mainSeries(p, win)}
        domain={domain}
        windowLabel={WINDOW_LABEL[win]}
        instant={keyboard}
      />
    )
  }
  return (
    <Section
      id="s-time"
      title="Over time"
      takeaway={takeaway}
      details={{
        content: (
          <>
            <PersistenceTable detail={detail} />
            {data && domain && data.points.length >= 2 ? (
              <div className="pool-more-series">
                <SmallMultiples
                  points={data.points}
                  series={moreSeries(data.points, detail.pool, detail.latest?.price ?? null)}
                  domain={domain}
                  windowLabel={WINDOW_LABEL[win]}
                  instant={keyboard}
                />
              </div>
            ) : null}
          </>
        ),
      }}
    >
      <div className="pool-ts-head">
        <SegmentedControl
          label="Time window"
          options={[
            { value: '24h', label: WINDOW_SHORT['24h'] },
            { value: '7d', label: WINDOW_SHORT['7d'] },
          ]}
          value={win}
          onChange={(w, meta) => {
            setKeyboard(meta.keyboard)
            onWindow(w)
          }}
        />
        <span className="small faint">Times in UTC</span>
      </div>
      {body}
    </Section>
  )
}
