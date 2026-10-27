/**
 * The Pool facts row (ia-v3 §4.3, D3): health with its grade, spread at $10K, 24 h volume and TVL,
 * value first and label second; a 2 × 2 grid on phones. When the pool trades 3× its depth a day or
 * more, a quiet gap callout follows (TB9). Unknown values are "—" with the reason on hover, focus
 * or tap (D6).
 */
import { Link } from 'react-router-dom'
import type { PoolDetail } from '../../api/types.js'
import { MEANINGFUL_GAP_TURNOVER } from '../../components/charts/TurnoverGlyph.js'
import { Fact, Facts } from '../../components/ui/Fact.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { NotRatedChip } from '../../components/ui/GradeGlyph.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { bps, cantAbsorb, NB, ratio, score, usd } from '../../lib/format.js'
import { tvlReason } from '../../lib/poolsTable.js'
import { spreadAt } from './poolText.js'

export function PoolFacts({ detail }: { detail: PoolDetail }) {
  const { score: health, latest, pool, gap } = detail
  const spread10k = latest ? spreadAt(latest.spreads, 10_000) : null
  // No spread on a priced pool: it "can't absorb" the trade (null, or more than a trade can pay).
  const spreadUnabsorbed =
    latest !== null && health?.unratedReason !== 'unpriced' && spread10k === null
  const gapOn = gap?.turnoverRatio != null && gap.turnoverRatio >= MEANINGFUL_GAP_TURNOVER
  return (
    <>
      <Facts layout="pool" className="pool-facts">
        <Fact
          value={
            health ? (
              health.rated ? (
                score(health.total)
              ) : (
                <NotRatedChip reason={health.unratedReason} size="fact" />
              )
            ) : (
              <Unknown reason="Not scored yet: scores appear after the pool’s first snapshots." />
            )
          }
          grade={health?.rated ? health.grade : null}
          label={
            <Glossary
              definition="One score from 0 to 100, built from depth, spread, concentration and persistence."
              anchor="health"
            >
              health
            </Glossary>
          }
        />
        <Fact
          value={
            spreadUnabsorbed ? (
              <span className="fv-words">{cantAbsorb(10_000)}</span>
            ) : spread10k === null ? (
              <Unknown reason="No spread: a token in this pool has no USD price." />
            ) : (
              bps(spread10k)
            )
          }
          label="spread at $10K"
        />
        <Fact
          value={
            detail.volume24hUsd === null ? (
              <Unknown reason="No priced swaps were indexed in the last 24 hours." />
            ) : (
              usd(detail.volume24hUsd)
            )
          }
          label={`traded in 24${NB}h`}
        />
        <Fact
          value={
            latest?.tvlUsd == null ? <Unknown reason={tvlReason(pool.dex)} /> : usd(latest.tvlUsd)
          }
          label="TVL"
        />
      </Facts>
      {gapOn ? (
        <p className="pool-gap-callout">
          <Link className="plink" to="/gaps">
            Liquidity gap
          </Link>
          : trades {ratio(gap?.turnoverRatio)} its depth daily.
        </p>
      ) : null}
    </>
  )
}
