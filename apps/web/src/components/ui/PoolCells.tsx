/**
 * The pools table's cells (docs/design/visual-v4.md §5.8), shared by Pools, Token and the Gaps
 * table: health is the grade glyph plus the truncated score in a 2ch column (N6), depth the 84 × 20
 * row glyph plus the value 16 px apart (and the "Stale price" chip for a stale quote), and an
 * unknown value is "—" with its reason (D6). Formatting only: every value comes from the API.
 */
import type { PoolSummary } from '../../api/types.js'
import {
  ago,
  bps,
  cantAbsorb,
  price,
  SPREAD_UNABSORBED_BPS,
  score,
  shareOf,
  usd,
} from '../../lib/format.js'
import { basePrice } from '../../lib/orient.js'
import { type PoolsSortKey, tvlReason, UNKNOWN_REASON } from '../../lib/poolsTable.js'
import { unratedDetail, unratedShort } from '../../lib/rating.js'
import { STALE_PRICE, staleQuoteDetail } from '../../lib/staleQuote.js'
import { RowDepthGlyph } from '../charts/RowDepthGlyph.js'
import { Glossary } from './Glossary.js'
import { NotRatedChip, RatingGlyph } from './GradeGlyph.js'
import { Unknown } from './Unknown.js'

/**
 * The chip of a stale quote (docs/METRICS.md, "Stale quotes"): neutral, "Stale price", and how far
 * the pool's price is from the market on hover, focus or tap.
 */
export function StaleQuoteChip({ deviationBps }: { deviationBps: number | null }) {
  return (
    <span className="grade tone-none is-stale">
      <Glossary definition={staleQuoteDetail(deviationBps)} anchor="depth">
        {STALE_PRICE}
      </Glossary>
    </span>
  )
}

/** Why a depth or spread is unknown: a hooked pool is not modelled, otherwise a price is missing. */
function unknownReason(p: PoolSummary, fallback: string): string {
  return p.health.unratedReason === 'hooked' ? unratedDetail('hooked') : fallback
}

/**
 * Health: the grade glyph and the truncated score, or for a pool with no grade the "Not rated" chip
 * alone: its total is not a grade, so the row does not show it as one.
 */
export function HealthCell({ health }: { health: PoolSummary['health'] }) {
  if (!health.rated || health.grade === null) {
    return (
      <span className="td-health">
        <NotRatedChip reason={health.unratedReason} />
      </span>
    )
  }
  return (
    <span className="td-health">
      <RatingGlyph health={health} />
      <span className="n">{score(health.total)}</span>
    </span>
  )
}

export function DepthCell({ pool, max }: { pool: PoolSummary; max: number }) {
  return (
    <span className="td-depth">
      <RowDepthGlyph sell={pool.depth2DownUsd} buy={pool.depth2UpUsd} max={max} />
      <span>{metricCell(pool, 'depth')}</span>
      {pool.staleQuote ? <StaleQuoteChip deviationBps={pool.priceDeviationBps} /> : null}
    </span>
  )
}

/** The $10K spread of a pool: basis points, or where it would be, "Can’t absorb $10K". */
function spreadCell(p: PoolSummary) {
  const v = p.spread10kBps
  if (v !== null && Math.round(Math.abs(v)) < SPREAD_UNABSORBED_BPS) return bps(v)
  const reason = p.health.unratedReason
  if (v === null && (reason === 'unpriced' || reason === 'hooked'))
    return <Unknown reason={unknownReason(p, UNKNOWN_REASON.spread)} />
  return cantAbsorb(10_000)
}

/** The value of one metric of a pool, as its column (and the phone row) shows it. */
export function metricCell(p: PoolSummary, key: PoolsSortKey | 'price' | 'updated', now = 0) {
  switch (key) {
    case 'health':
      // The total of a pool with no grade is not a grade: the chip beside it says so.
      return p.health.rated ? (
        score(p.health.total)
      ) : (
        <Unknown reason={unratedShort(p.health.unratedReason)} />
      )
    case 'depth':
      return p.depth2Usd === null ? (
        <Unknown reason={unknownReason(p, UNKNOWN_REASON.depth)} />
      ) : (
        usd(p.depth2Usd)
      )
    case 'spread':
      return spreadCell(p)
    case 'volume':
      return p.volume24hUsd === null ? (
        <Unknown reason={UNKNOWN_REASON.volume} />
      ) : (
        usd(p.volume24hUsd)
      )
    case 'gap':
      return p.gapScore === null ? <Unknown reason={UNKNOWN_REASON.gap} /> : score(p.gapScore)
    case 'tvl':
      return p.tvlUsd === null ? <Unknown reason={tvlReason(p.pool.dex)} /> : usd(p.tvlUsd)
    case 'top':
      return p.ownerTop1Share === null ? (
        <Unknown reason={UNKNOWN_REASON.top} />
      ) : (
        shareOf(p.ownerTop1Share)
      )
    case 'price':
      // From the pool's base token (N2): cbBTC / USDC's 0.00001522 reads 65,712.95.
      return p.price === null ? (
        <Unknown reason={UNKNOWN_REASON.price} />
      ) : (
        price(basePrice(p.price))
      )
    case 'updated':
      return p.updatedAt === null ? (
        <Unknown reason={UNKNOWN_REASON.updated} />
      ) : (
        ago(p.updatedAt, now)
      )
  }
}
