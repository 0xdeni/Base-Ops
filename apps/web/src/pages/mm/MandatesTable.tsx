/**
 * The Scorecards table view (L2, ia-v3 §4.5, `?view=table`): every v2 column. Scorecard and
 * market maker, pool, status, uptime over 24 h, 7 d and 30 d, the market maker's depth per side
 * against the KPI, spread against its KPI (or "No KPI"), the current streak and the last sample.
 * Marks read the latest sample's stored evaluation (`sampleMark`), so a cell never contradicts the
 * status. A dense table that scrolls inside its own wrapper on phones, with the status and the 7 d
 * uptime right after the sticky scorecard column there (TB7).
 */
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PoolMetaDto, ScorecardSummaryDto } from '../../api/types.js'
import { BreachMark, StatusWord } from '../../components/ui/StatusWord.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { bps, count, full, NB, poolHref, uptime, usd, when } from '../../lib/format.js'
import { type KpiMark, mmHref, sampleMark } from '../../lib/scorecard.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { poolDexFee, poolWords } from './mmText.js'

function KpiCell({
  value,
  mark,
  under,
  markLabel = 'Below KPI',
}: {
  value: ReactNode
  mark: KpiMark
  under: string
  markLabel?: string
}) {
  return (
    <span className="mmt-kpi">
      <span className="mmt-v num">
        {value}
        {mark === 'fail' ? <BreachMark label={markLabel} /> : null}
      </span>
      <span className="faint small">{under}</span>
    </span>
  )
}

function streakWords(streak: ScorecardSummaryDto['streak']): string {
  if (streak.samples === 0) return '—'
  return `${count(streak.samples)} ${streak.breached ? 'breached' : 'within KPI'}`
}

function SpreadCell({ s }: { s: ScorecardSummaryDto }) {
  const v = s.latest?.attribution.spreadBps ?? null
  const max = s.mandate.kpis.maxSpreadBps
  if (max === null) return <KpiCell value={bps(v)} mark="n/a" under="No KPI" />
  const mark = sampleMark(s.latest, 'spread')
  const text = v === null && mark === 'fail' ? 'Not fillable' : bps(v)
  return <KpiCell value={text} mark={mark} under={`KPI ${bps(max)}`} markLabel="Above KPI" />
}

type Col =
  | 'name'
  | 'pool'
  | 'status'
  | 'h24'
  | 'd7'
  | 'd30'
  | 'sell'
  | 'buy'
  | 'spread'
  | 'streak'
  | 'last'

const DESKTOP: readonly Col[] = [
  'name',
  'pool',
  'status',
  'h24',
  'd7',
  'd30',
  'sell',
  'buy',
  'spread',
  'streak',
  'last',
]
/** Phones see the reason to open this view first, beside the sticky scorecard column (TB7). */
const PHONE: readonly Col[] = [
  'name',
  'status',
  'd7',
  'pool',
  'h24',
  'd30',
  'sell',
  'buy',
  'spread',
  'streak',
  'last',
]

function head(c: Col, first: Col): ReactNode {
  // The first uptime column on screen carries the word "Uptime".
  const up = (w: string) => (c === first ? `Uptime ${w}` : w)
  switch (c) {
    case 'name':
      return <th scope="col">Scorecard</th>
    case 'pool':
      return <th scope="col">Pool</th>
    case 'status':
      return <th scope="col">Status</th>
    case 'h24':
      return (
        <th scope="col" className="r">
          {up(`24${NB}h`)}
        </th>
      )
    case 'd7':
      return (
        <th scope="col" className="r">
          {up(`7${NB}d`)}
        </th>
      )
    case 'd30':
      return (
        <th scope="col" className="r">
          {up(`30${NB}d`)}
        </th>
      )
    case 'sell':
      return (
        <th scope="col" className="r">
          Sell side
        </th>
      )
    case 'buy':
      return (
        <th scope="col" className="r">
          Buy side
        </th>
      )
    case 'spread':
      return (
        <th scope="col" className="r">
          Spread
        </th>
      )
    case 'streak':
      return (
        <th scope="col" className="r">
          Streak
        </th>
      )
    case 'last':
      return (
        <th scope="col" className="r">
          Last sample
        </th>
      )
  }
}

function cell(
  c: Col,
  s: ScorecardSummaryDto,
  meta: PoolMetaDto | undefined,
  now: number,
): ReactNode {
  const { mandate, latest, uptime: u } = s
  const kpi = `KPI ${usd(mandate.kpis.minDepthUsd)}`
  switch (c) {
    case 'name':
      return (
        <td>
          <span className="mmt-name">
            <Link className="tlink" to={mmHref(mandate.id)}>
              {mandate.name}
            </Link>
            <span className="muted small">{mandate.marketMaker}</span>
          </span>
        </td>
      )
    case 'pool': {
      const words = poolWords(mandate.poolId, meta)
      return (
        <td>
          <span className="mmt-name">
            <Link className="tlink" to={poolHref(mandate.poolId)}>
              {words.pair}
            </Link>
            <span className="muted small nowrap">{meta ? poolDexFee(meta) : words.dex}</span>
          </span>
        </td>
      )
    }
    case 'status':
      return (
        <td>
          <StatusWord status={s.status} />
        </td>
      )
    case 'h24':
      return <td className="r num">{uptime(u.h24.uptime)}</td>
    case 'd7':
      return <td className="r num">{uptime(u.d7.uptime)}</td>
    case 'd30':
      return <td className="r num">{uptime(u.d30.uptime)}</td>
    case 'sell':
      return (
        <td className="r">
          <KpiCell
            value={usd(latest?.attribution.depthDownUsd)}
            mark={sampleMark(latest, 'depthDown')}
            under={kpi}
          />
        </td>
      )
    case 'buy':
      return (
        <td className="r">
          <KpiCell
            value={usd(latest?.attribution.depthUpUsd)}
            mark={sampleMark(latest, 'depthUp')}
            under={kpi}
          />
        </td>
      )
    case 'spread':
      return (
        <td className="r">
          <SpreadCell s={s} />
        </td>
      )
    case 'streak':
      return <td className="r nowrap">{streakWords(s.streak)}</td>
    case 'last':
      return (
        <td className="r nowrap muted" title={latest ? full(latest.timestamp) : undefined}>
          {latest ? when(latest.timestamp, now) : '—'}
        </td>
      )
  }
}

export function MandatesTable({
  items,
  pools,
  now,
}: {
  items: readonly ScorecardSummaryDto[]
  pools: ReadonlyMap<string, PoolMetaDto>
  now: number
}) {
  const cols = useIsPhone() ? PHONE : DESKTOP
  const firstUptime = cols.find((c) => c === 'h24' || c === 'd7' || c === 'd30') ?? 'h24'
  return (
    <TableScroll className="mmt-wrap">
      <table className="tbl dense mmt">
        <caption className="sr-only">Market-maker scorecards</caption>
        <thead>
          <tr>
            {cols.map((c) => (
              <Fragment key={c}>{head(c, firstUptime)}</Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.mandate.id}>
              {cols.map((c) => (
                <Fragment key={c}>{cell(c, s, pools.get(s.mandate.poolId), now)}</Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  )
}
