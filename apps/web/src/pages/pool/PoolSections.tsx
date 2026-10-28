/**
 * The Pool sections that read the latest snapshot and score (ia-v3 §4.3, docs/design/visual-v4.md
 * §5.7, §6.4): health, cost to trade and who provides it, rows of the sections sheet. Each is one
 * lowercase heading, one finding, one visual and a Details trigger in the head (K10) whose panel,
 * under the visual, holds the numbers behind it (L2).
 */
import { HEALTH_MAX } from '@depthwatch/core'
import { Link } from 'react-router-dom'
import type { PoolDetail } from '../../api/types.js'
import { HEALTH_PARTS, HealthBar } from '../../components/charts/HealthBar.js'
import { ShareBar } from '../../components/charts/ShareBar.js'
import { SpreadLollipop } from '../../components/charts/SpreadLollipop.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { Section } from '../../components/ui/Section.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { count, NB, price, scoreExact, shareOf, usd } from '../../lib/format.js'
import { unratedDetail } from '../../lib/rating.js'
import { costTakeaway, healthTakeaway, spreadCellText, whoTakeaway } from './poolText.js'

const HHI_DEFINITION =
  'Herfindahl index: 1 means one holder or one range has everything; near 0 means it is spread out.'

export function HealthSection({ detail }: { detail: PoolDetail }) {
  const { score: health } = detail
  if (!health) {
    return (
      <Section id="s-health" title="health" takeaway="Not scored yet.">
        <p className="muted">Health is graded once the pool is snapshotted and scored.</p>
      </Section>
    )
  }
  return (
    <Section
      id="s-health"
      title="health"
      takeaway={healthTakeaway(health, detail.latest?.concentration ?? null, detail.pool.kind)}
      details={{
        content: (
          <>
            <TableScroll>
              <table className="tbl dense">
                <caption className="sr-only">Health components</caption>
                <thead>
                  <tr>
                    <th scope="col">Component</th>
                    <th scope="col" className="r">
                      Score
                    </th>
                    <th scope="col" className="r">
                      Weight
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {HEALTH_PARTS.map(({ key, label }) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td className="r num">{scoreExact(health.components[key])}</td>
                      <td className="r num">{HEALTH_MAX[key]}</td>
                    </tr>
                  ))}
                  <tr className="tot-row">
                    <td>{health.rated ? `Total, grade ${health.grade}` : 'Total, not rated'}</td>
                    <td className="r num">{scoreExact(health.total)}</td>
                    <td className="r num">100</td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
            {health.rated ? null : (
              <p className="tbl-note">{unratedDetail(health.unratedReason)}</p>
            )}
            {health.notes.length ? (
              <p className="tbl-note">Scoring notes: {health.notes.join('; ')}.</p>
            ) : null}
            <p className="tbl-note">
              <Link className="plink" to="/methodology#health">
                How health is graded
              </Link>
            </p>
          </>
        ),
      }}
    >
      <HealthBar components={health.components} />
    </Section>
  )
}

export function CostSection({ detail }: { detail: PoolDetail }) {
  const spreads = [...(detail.latest?.spreads ?? [])].sort((a, b) => a.notionalUsd - b.notionalUsd)
  const { token0, token1 } = detail.pool
  if (!spreads.length) {
    return (
      <Section id="s-cost" title="cost to trade" takeaway={costTakeaway(spreads)}>
        <p className="muted">Spreads appear after the first snapshot.</p>
      </Section>
    )
  }
  return (
    <Section
      id="s-cost"
      title="cost to trade"
      takeaway={costTakeaway(spreads)}
      details={{
        content: (
          <TableScroll>
            <table className="tbl dense">
              <caption className="sr-only">Round-trip spread per notional</caption>
              <thead>
                <tr>
                  <th scope="col">Round trip</th>
                  <th scope="col" className="r">
                    Spread
                  </th>
                  <th scope="col" className="r">
                    Buy average
                  </th>
                  <th scope="col" className="r">
                    Sell average
                  </th>
                </tr>
              </thead>
              <tbody>
                {spreads.map((s) => (
                  <tr key={s.notionalUsd}>
                    <td>{usd(s.notionalUsd)}</td>
                    <td className="r num">{spreadCellText(s)}</td>
                    <td className="r num">{price(s.buyAvgPrice)}</td>
                    <td className="r num">{price(s.sellAvgPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tbl-note">
              Average prices in {token1.symbol} per {token0.symbol}, fees included.
            </p>
          </TableScroll>
        ),
      }}
    >
      <SpreadLollipop spreads={spreads} />
    </Section>
  )
}

export function WhoSection({ detail }: { detail: PoolDetail }) {
  const c = detail.latest?.concentration ?? null
  const fullRange = detail.pool.kind !== 'concentrated'
  const visual = !c ? (
    <p className="muted">Concentration appears after the first snapshot.</p>
  ) : c.owners ? (
    <ShareBar
      top1Share={c.owners.top1Share}
      top3Share={c.owners.top3Share}
      owners={c.owners.count}
      bandPct={c.bandPct}
    />
  ) : (
    <ShareBar activeShare={c.activeRangeShare} bandPct={c.bandPct} />
  )
  return (
    <Section
      id="s-who"
      title="who provides it"
      takeaway={whoTakeaway(c, detail.pool.kind)}
      details={
        c
          ? {
              content: (
                <>
                  <dl className="about is-one-col">
                    <div>
                      <dt>Band</dt>
                      <dd>
                        ±{c.bandPct}
                        {NB}% of the price
                      </dd>
                    </div>
                    <div>
                      <dt>
                        Range{' '}
                        <Glossary definition={HHI_DEFINITION} anchor="concentration">
                          HHI
                        </Glossary>
                      </dt>
                      <dd className="num">{c.rangeHhi.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt>Active range share</dt>
                      <dd className="num">{shareOf(c.activeRangeShare)}</dd>
                    </div>
                    {c.owners ? (
                      <>
                        <div>
                          <dt>Top LP</dt>
                          <dd className="num">{shareOf(c.owners.top1Share)}</dd>
                        </div>
                        <div>
                          <dt>Top 3 LPs</dt>
                          <dd className="num">{shareOf(c.owners.top3Share)}</dd>
                        </div>
                        <div>
                          <dt>Owner HHI</dt>
                          <dd className="num">{c.owners.hhi.toFixed(2)}</dd>
                        </div>
                        <div>
                          <dt>Owners in band</dt>
                          <dd className="num">{count(c.owners.count)}</dd>
                        </div>
                      </>
                    ) : null}
                  </dl>
                  {fullRange ? (
                    <p className="tbl-note">
                      A full-range pool: all its liquidity is one range by construction.
                    </p>
                  ) : null}
                  {c.owners ? null : (
                    <p className="tbl-note">
                      Owners are not indexed for this pool, so health uses the range HHI.
                    </p>
                  )}
                </>
              ),
            }
          : undefined
      }
    >
      {visual}
    </Section>
  )
}
