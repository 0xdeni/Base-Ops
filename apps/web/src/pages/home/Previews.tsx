/**
 * The two previews below Home's facts (ia-v3 §4.1, docs/design/visual-v3.md §6.1): "Where
 * liquidity is thin" (at most 3 pools trading 3× their depth or more) and "Market makers on the
 * record" (at most 3 mandates). Each heading row carries its "See all" link (shortened to "See
 * all" on phones, with the full name kept as its accessible name), then one takeaway and a ruled
 * row list whose rows are links. The full feeds live on /gaps and /mm (P7).
 */
import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePoolMetas } from '../../api/hooks.js'
import type {
  GapItem,
  GapsResponse,
  PoolMetaDto,
  PoolSummary,
  ScorecardsResponse,
} from '../../api/types.js'
import { TurnoverGlyph } from '../../components/charts/index.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { MandateRow } from '../../components/ui/MandateRow.js'
import { SectionError } from '../../components/ui/States.js'
import { pairLabel, poolDesc, poolHref, ratio, shortAddress } from '../../lib/format.js'
import { splitPoolId } from '../../lib/scorecard.js'
import { GAPS_QUIET_LINE, GLOSS, gapsTakeaway, mandatesTakeaway, tradesLine } from './copy.js'

/** Rows in each preview (P7: previews hold at most 3 rows and link out). */
export const PREVIEW_ROWS = 3

function Preview({
  id,
  title,
  more,
  takeaway,
  children,
}: {
  id: string
  title: string
  /** The "See all" link: its full name ("See all gaps") and where it goes. */
  more?: { to: string; name: string; tail: string }
  takeaway: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="preview" aria-labelledby={id}>
      <div className="pv-head">
        <h2 className="h2" id={id}>
          {title}
        </h2>
        {more ? (
          <Link className="plink go" to={more.to} aria-label={more.name}>
            See all<span className="go-long"> {more.tail}</span>
          </Link>
        ) : null}
      </div>
      <p className="takeaway">{takeaway}</p>
      {children}
    </section>
  )
}

function GapRow({ item }: { item: GapItem }) {
  const pool = item.pool.pool
  return (
    <li>
      <div className="rl-row pv-row">
        <div className="cell-pool">
          <Link className="pp rl-link" to={poolHref(pool.id)}>
            {pairLabel(pool.token0, pool.token1)}
          </Link>
          <span className="pd">{poolDesc(pool)}</span>
          <span className="pd">{tradesLine(ratio(item.gap.turnoverRatio))}</span>
        </div>
        <TurnoverGlyph gapScore={item.gap.gapScore} />
      </div>
    </li>
  )
}

export function GapsPreview({
  gaps,
  meaningful,
  waiting,
}: {
  gaps: UseQueryResult<GapsResponse>
  /** The gap feed's pools trading 3× their depth or more, highest first. */
  meaningful: readonly GapItem[] | undefined
  /** Loading for under 300 ms: the skeleton holds its space unseen (M10). */
  waiting: boolean
}) {
  const more = { to: '/gaps', name: 'See all gaps', tail: 'gaps' }
  if (gaps.isError)
    return (
      <Preview id="home-gaps" title="Where liquidity is thin" more={more} takeaway={null}>
        <SectionError what="the gaps" onRetry={() => void gaps.refetch()} />
      </Preview>
    )
  if (!meaningful)
    return <PreviewSkeleton id="home-gaps" title="Where liquidity is thin" waiting={waiting} />
  const shown = meaningful.slice(0, PREVIEW_ROWS)
  return (
    <Preview
      id="home-gaps"
      title="Where liquidity is thin"
      more={more}
      takeaway={gapsTakeaway(meaningful.length)}
    >
      {shown.length > 0 ? (
        <ol className="rowlist is-ruled pv-rows">
          {shown.map((g) => (
            <GapRow key={g.pool.pool.id} item={g} />
          ))}
          {shown.length < PREVIEW_ROWS ? <li className="rl-quiet">{GAPS_QUIET_LINE}</li> : null}
        </ol>
      ) : null}
    </Preview>
  )
}

/** "USDC / AERO" from the observatory's pool, or the short address while it is unknown. */
function poolName(poolId: string, meta: PoolMetaDto | undefined): string {
  if (meta) return pairLabel(meta.token0, meta.token1)
  return shortAddress(splitPoolId(poolId).key)
}

export function MandatesPreview({
  scorecards,
  pools,
  waiting,
}: {
  scorecards: UseQueryResult<ScorecardsResponse>
  /** Every scored pool, for the mandated pools' names. */
  pools: readonly PoolSummary[] | undefined
  waiting: boolean
}) {
  const items = scorecards.data?.items
  const shown = items?.slice(0, PREVIEW_ROWS) ?? []
  const known = new Map(pools?.map((p) => [p.pool.id, p.pool]))
  // Mandated pools that are not scored are looked up one by one (they share the pool page's cache).
  const missing = pools ? shown.map((s) => s.mandate.poolId).filter((id) => !known.has(id)) : []
  const metas = usePoolMetas(missing)
  const title = 'Market makers on the record'
  const more = { to: '/mm', name: 'See all scorecards', tail: 'scorecards' }
  if (scorecards.isError)
    return (
      <Preview id="home-mm" title={title} more={more} takeaway={null}>
        <SectionError what="the scorecards" onRetry={() => void scorecards.refetch()} />
      </Preview>
    )
  if (!items) return <PreviewSkeleton id="home-mm" title={title} waiting={waiting} />
  if (items.length === 0)
    return (
      <Preview
        id="home-mm"
        title={title}
        takeaway={
          <>
            No market-maker mandates registered yet.{' '}
            <Link className="plink" to="/methodology#scorecards">
              How scorecards work
            </Link>
          </>
        }
      />
    )
  const words = mandatesTakeaway(items)
  return (
    <Preview
      id="home-mm"
      title={title}
      more={more}
      takeaway={
        <>
          {words.before}
          <Glossary definition={GLOSS.kpis} anchor="scorecards">
            KPIs
          </Glossary>
          {words.after}
        </>
      }
    >
      <ol className="rowlist is-ruled pv-rows">
        {shown.map((s) => (
          <MandateRow
            key={s.mandate.id}
            summary={s}
            where={poolName(
              s.mandate.poolId,
              known.get(s.mandate.poolId) ?? metas.get(s.mandate.poolId),
            )}
          />
        ))}
      </ol>
    </Preview>
  )
}

/** A preview's heading with static row blocks while its list loads (ST1). */
function PreviewSkeleton({ id, title, waiting }: { id: string; title: string; waiting: boolean }) {
  const cls = waiting ? ' is-waiting' : ''
  return (
    <Preview id={id} title={title} takeaway={<span className={`skel-text home-skel-take${cls}`} />}>
      <ol className={`rowlist is-ruled pv-rows${cls}`} aria-hidden="true">
        {[0, 1].map((i) => (
          <li key={i} className="pv-skel-row" />
        ))}
      </ol>
    </Preview>
  )
}
