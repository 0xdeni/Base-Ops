/**
 * The Token facts row (ia-v3 §4.7, D3): the USD price, the pools discovered (with the scored count
 * when fewer are scored), and where the price comes from: the route's first pool, from the stable
 * anchor, with the rest of the route in the label. An anchor reads "Anchor"; an unpriced token "—"
 * with the reason (D6).
 */
import { Link } from 'react-router-dom'
import type { PoolMetaDto, TokenDetail } from '../../api/types.js'
import { Fact, Facts } from '../../components/ui/Fact.js'
import { Unknown } from '../../components/ui/Unknown.js'
import { count, dexLabel, pairLabel, poolHref, price, shortAddress } from '../../lib/format.js'
import { type RouteStep, routeSteps, stepWords } from './tokenText.js'

function RouteFact({ steps, priced }: { steps: RouteStep[]; priced: boolean }) {
  const [first, ...rest] = steps
  if (!priced)
    return (
      <Fact
        value={<Unknown reason="No route from a stable anchor reaches this token yet." />}
        label="priced through"
      />
    )
  if (!first) return <Fact value="Anchor" label="a stable reference, not routed" />
  const then = rest.map((s) => `, then ${stepWords(s)}`).join('')
  if (first.pool) {
    return (
      <Fact
        value={
          <Link className="tlink touch-hit" to={poolHref(first.source)}>
            {pairLabel(first.pool.token0, first.pool.token1)}
          </Link>
        }
        label={`priced through this ${dexLabel(first.pool.dex)} pool${then}`}
      />
    )
  }
  if (first.words) return <Fact value={first.words} label={`priced through${then}`} />
  return (
    <Fact
      value={
        <Link className="tlink addr touch-hit" to={poolHref(first.source)} title={first.source}>
          {shortAddress(first.source.slice(first.source.indexOf(':') + 1))}
        </Link>
      }
      label={`priced through a pool not tracked here${then}`}
    />
  )
}

export function TokenFacts({
  detail,
  metas,
}: {
  detail: TokenDetail
  metas: ReadonlyMap<string, PoolMetaDto>
}) {
  const scored = detail.total
  const found = detail.poolCount
  const poolsLabel = `${found === 1 ? 'pool' : 'pools'} discovered${scored < found ? `, ${count(scored)} scored` : ''}`
  return (
    <Facts layout="pool" className="token-facts">
      <Fact
        value={
          detail.usd === null ? (
            <Unknown reason="No route from a stable anchor reaches this token yet." />
          ) : (
            `$${price(detail.usd)}`
          )
        }
        label="USD price"
      />
      <Fact value={count(found)} label={poolsLabel} />
      <RouteFact steps={routeSteps(detail.via, metas)} priced={detail.usd !== null} />
    </Facts>
  )
}
