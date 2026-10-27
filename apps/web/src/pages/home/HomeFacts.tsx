/**
 * Home's facts row (D3, ia-v3 §4.1): $28.2M "traded in 24 h", 82 with its grade "median health
 * across 105 rated pools" (only rated pools count; with none the value is "—"),
 * 51× "USDC / AERO, the biggest gap". Each label states its comparison; the terms are glossary
 * tooltips (D8). Without a meaningful gap the third fact is the highest turnover instead; with no
 * gap feed at all it is left out rather than shown empty.
 */
import { healthGrade } from '@depthwatch/core'
import type { GapItem, StatsResponse } from '../../api/types.js'
import { Fact, Facts } from '../../components/ui/Fact.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { count, NB, pairLabel, ratio, score, usd } from '../../lib/format.js'
import { GLOSS, isMeaningfulGap } from './copy.js'

export function HomeFacts({
  totals,
  top,
}: {
  totals: StatsResponse['totals']
  /** The top of the gap feed (the highest turnover), when the feed has one. */
  top: GapItem | undefined
}) {
  const median = totals.medianHealth
  const rated = totals.rated
  const pair = top ? pairLabel(top.pool.pool.token0, top.pool.pool.token1) : ''
  return (
    <Facts layout="home" className="home-facts">
      <Fact value={usd(totals.volume24hUsd)} label={`traded in 24${NB}h`} />
      <Fact
        value={
          median === null ? (
            <Unknown reason="No pool is deep enough to rate yet: both sides within 2 % must hold $5K." />
          ) : (
            score(median)
          )
        }
        grade={median === null ? null : healthGrade(median)}
        label={
          <>
            median{' '}
            <Glossary definition={GLOSS.health} anchor="health">
              health
            </Glossary>
            {median === null
              ? ', no pool rated yet'
              : ` across ${count(rated)} rated ${rated === 1 ? 'pool' : 'pools'}`}
          </>
        }
      />
      {top && top.gap.turnoverRatio !== null ? (
        <Fact
          value={ratio(top.gap.turnoverRatio)}
          label={
            isMeaningfulGap(top) ? (
              <>
                {pair}, the biggest{' '}
                <Glossary definition={GLOSS.gap} anchor="gaps">
                  gap
                </Glossary>
              </>
            ) : (
              <>
                {pair}, the highest{' '}
                <Glossary definition={GLOSS.turnover} anchor="gaps">
                  turnover
                </Glossary>
              </>
            )
          }
        />
      ) : null}
    </Facts>
  )
}
