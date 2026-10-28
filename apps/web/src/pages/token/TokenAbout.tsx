/**
 * "about this token" (L3, ia-v3 §4.7 section 2, docs/design/visual-v4.md §6.8): a panel after the
 * pools sheet, the "About this token" disclosure on phones. The address (mono, Basescan, copy),
 * decimals, when the price was derived, and the full price route with each pool step linking to
 * its pool. The native ETH ↔ WETH edge reads "ETH to WETH"; a pool the observatory does not know
 * keeps its id. An anchor says it is taken at $1 by convention (docs/METRICS.md, USD prices).
 */
import { NATIVE_ETH } from '@depthwatch/core'
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { PoolMetaDto, TokenDetail } from '../../api/types.js'
import { CopyButton } from '../../components/ui/CopyButton.js'
import { AboutSection } from '../../components/ui/Section.js'
import { ago, dexLabel, pairLabel, poolHref, shortAddress } from '../../lib/format.js'
import { ChainId } from '../pool/PoolAbout.js'
import { type RouteStep, routeSteps } from './tokenText.js'

function Step({ step }: { step: RouteStep }) {
  if (step.pool) {
    return (
      <span>
        <Link className="plink" to={poolHref(step.source)}>
          {pairLabel(step.pool.token0, step.pool.token1)}
        </Link>{' '}
        on {dexLabel(step.pool.dex)}
      </span>
    )
  }
  if (step.words === undefined) {
    return (
      <Link className="plink addr" to={poolHref(step.source)} title={step.source}>
        {shortAddress(step.source.slice(step.source.indexOf(':') + 1))}
      </Link>
    )
  }
  return <span className={step.words === step.source ? 'addr' : undefined}>{step.words}</span>
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function TokenAbout({
  detail,
  metas,
  now,
}: {
  detail: TokenDetail
  metas: ReadonlyMap<string, PoolMetaDto>
  now: number
}) {
  const { token } = detail
  const native = token.address === NATIVE_ETH
  const steps = routeSteps(detail.via, metas)
  return (
    <AboutSection id="s-about" title="about this token" disclosureLabel="About this token">
      <dl className="about">
        <Row term="Address">
          {native ? (
            'Native ether, not a contract'
          ) : (
            <>
              <ChainId id={token.address} href={`https://basescan.org/token/${token.address}`} />
              <CopyButton iconOnly text={token.address} label="Copy address" />
            </>
          )}
        </Row>
        <Row term="Name">{token.name}</Row>
        <Row term="Decimals">{token.decimals}</Row>
        <Row term="Price updated">
          {detail.priceUpdatedAt === null ? 'Not priced yet' : ago(detail.priceUpdatedAt, now)}
        </Row>
        <div className="is-full">
          <dt>Price route</dt>
          <dd>
            {detail.usd === null
              ? 'No route from a stable anchor reaches this token yet.'
              : steps.length === 0
                ? 'Anchor: a stablecoin taken at $1 by convention, not read from its pools. Other tokens are priced through the pools from the anchors.'
                : steps.map((s, i) => (
                    <Fragment key={s.source}>
                      {i > 0 ? <span className="faint">then</span> : null}
                      <Step step={s} />
                    </Fragment>
                  ))}
          </dd>
        </div>
      </dl>
    </AboutSection>
  )
}
