/**
 * The last rows of the Scorecard's sections sheet and the Mandate panel (ia-v3 §4.6,
 * docs/design/visual-v4.md §5.11, §6.7):
 * - spread, with a spread KPI: the market-maker and whole-pool spread over the window; without
 *   one, the same series sit behind "Show measured spread" in the depth over time row.
 * - embed badge: the API's badge SVG unaltered, "Copy HTML" and "Copy Markdown" with the cache
 *   note, and the snippets behind "Show code". The static build has no server to embed from, so
 *   it shows the preview, one sentence, and the command and badge path behind "Show code".
 * - mandate (L3), a panel after the sheet: who, which pool, the addresses (mono, Basescan, copy),
 *   the KPIs, attribution, alerts and dates; a two-column list from 840 px, "Mandate details" on
 *   phones.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { badgePath } from '../../api/client.js'
import { useIsStatic } from '../../api/context.js'
import { useBadge } from '../../api/hooks.js'
import type { MmSampleDto, ScorecardDetail } from '../../api/types.js'
import { type MultipleSeries, SmallMultiples } from '../../components/charts/SmallMultiples.js'
import { CopyButton } from '../../components/ui/CopyButton.js'
import {
  BadgePreview,
  CodeBlocks,
  EmbedActions,
  EmbedCode,
} from '../../components/ui/EmbedBadge.js'
import { AboutSection, Section } from '../../components/ui/Section.js'
import { Skeleton } from '../../components/ui/States.js'
import { ago, bps, full, group, poolHref, shareOf, uptime, usd } from '../../lib/format.js'
import { badgeImgSnippet, badgeMarkdownSnippet, badgeUrl } from '../../lib/scorecard.js'
import {
  attributionWords,
  maxSpreadWords,
  midAddress,
  minDepthWords,
  poolWords,
  WINDOW_LABEL,
  windowDomain,
} from './mmText.js'
import type { SeriesProps } from './ScorecardSections.js'

const spreadTick = (v: number) => (v < 100 ? v.toFixed(1) : String(Math.round(v)))

/** The market-maker and whole-pool spread over the window, on one shared scale. */
export function SpreadMultiples({
  detail,
  points,
  to,
  win,
  instant,
}: { detail: ScorecardDetail; instant: boolean } & SeriesProps) {
  const { kpis } = detail.mandate
  const at = usd(kpis.spreadNotionalUsd)
  const series: MultipleSeries<MmSampleDto>[] = [
    {
      key: 'mm',
      label: `Market-maker spread at ${at}`,
      height: 120,
      value: (p) => p.attribution.spreadBps,
      format: bps,
      tick: spreadTick,
      minSpan: 0.2,
      reference:
        kpis.maxSpreadBps === null
          ? null
          : { value: kpis.maxSpreadBps, label: `KPI ${spreadTick(kpis.maxSpreadBps)}` },
    },
    {
      key: 'pool',
      label: `Whole-pool spread at ${at}`,
      height: 120,
      value: (p) => p.attribution.poolSpreadBps,
      format: bps,
      tick: spreadTick,
      minSpan: 0.2,
    },
  ]
  if (!points || to === undefined || !points.length)
    return <p className="takeaway">No samples in this window.</p>
  return (
    <>
      <SmallMultiples
        points={points}
        series={series}
        domain={windowDomain(to, win)}
        windowLabel={WINDOW_LABEL[win]}
        instant={instant}
        sharedY
      />
      <p className="cap">Times in UTC. Both plots share one scale.</p>
    </>
  )
}

/**
 * The spread row, for a mandate with a spread KPI. Without one the measured spread sits behind
 * "Show measured spread" in the depth over time row, and this row is left out (§6.7).
 */
export function SpreadSection(props: { detail: ScorecardDetail; instant: boolean } & SeriesProps) {
  const { kpis } = props.detail.mandate
  if (kpis.maxSpreadBps === null) return null
  return (
    <Section
      id="s-spread"
      title="spread"
      takeaway={`KPI: at most ${bps(kpis.maxSpreadBps)} at ${usd(kpis.spreadNotionalUsd)}.`}
    >
      <SpreadMultiples {...props} />
    </Section>
  )
}

const EMBED_TAKEAWAY = 'Show the live status on a project page. The badge is the API’s own SVG.'

export function EmbedSection({ detail }: { detail: ScorecardDetail }) {
  const staticBuild = useIsStatic()
  const { id, name } = detail.mandate
  const badge = useBadge(id)
  const preview = badge.data ? (
    <BadgePreview svg={badge.data} alt={`Depthwatch scorecard: ${name}`} />
  ) : badge.isError ? (
    <p className="small t2">Badge unavailable.</p>
  ) : (
    <Skeleton height={52} width={180} />
  )
  if (staticBuild) {
    return (
      <Section
        id="s-embed"
        title="embed badge"
        takeaway={EMBED_TAKEAWAY}
        details={{
          label: 'Show code',
          content: (
            <CodeBlocks
              blocks={[
                ['Serve the API', 'depthwatch serve'],
                ['Badge path on that server', `/api${badgePath(id)}`],
              ]}
            />
          ),
        }}
      >
        <div className="badge-row">{preview}</div>
        <p className="cap sc-embed-note" data-testid="embed-static-note">
          Badge links need a running Depthwatch API; this static copy shows the preview only.
        </p>
      </Section>
    )
  }
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const html = badgeImgSnippet(origin, id, name)
  const markdown = badgeMarkdownSnippet(origin, id, name)
  return (
    <Section
      id="s-embed"
      title="embed badge"
      takeaway={EMBED_TAKEAWAY}
      details={{
        label: 'Show code',
        content: <EmbedCode html={html} markdown={markdown} url={badgeUrl(origin, id)} />,
      }}
    >
      {preview}
      <div className="badge-row sc-copy">
        <EmbedActions html={html} markdown={markdown} />
      </div>
    </Section>
  )
}

function Row({ k, children, wide }: { k: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'is-full' : undefined}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function MandateAbout({ detail, now }: { detail: ScorecardDetail; now: number }) {
  const { mandate, latest } = detail
  const { kpis } = mandate
  const a = latest?.attribution ?? null
  const words = poolWords(mandate.poolId, detail.pool?.pool)
  return (
    <AboutSection id="s-mandate" title="mandate" disclosureLabel="Mandate details">
      <dl className="about">
        <Row k="Market maker">{mandate.marketMaker}</Row>
        <Row k="Pool">
          <Link className="plink" to={poolHref(mandate.poolId)}>
            {words.pair}
          </Link>
        </Row>
        <Row k="Addresses">
          {mandate.addresses.map((address) => (
            <span key={address} className="sc-addr">
              <a
                className="mono plink"
                href={`https://basescan.org/address/${address}`}
                target="_blank"
                rel="noreferrer"
                title={address}
              >
                {midAddress(address)}
              </a>
              <CopyButton iconOnly text={address} label={`Copy address ${address}`} />
            </span>
          ))}
        </Row>
        <Row k="Minimum depth">{minDepthWords(kpis)}</Row>
        <Row k="Maximum spread">{maxSpreadWords(kpis)}</Row>
        <Row k="Target uptime">{uptime(kpis.targetUptime)}</Row>
        <Row k="Attribution">{attributionWords(a)}</Row>
        <Row k="Share of in-band liquidity">{shareOf(a?.shareOfPool)}</Row>
        <Row k="Whole-pool depth now">
          {a ? `${usd(a.poolDepthDownUsd)} sell side, ${usd(a.poolDepthUpUsd)} buy side` : '—'}
        </Row>
        <Row k="Alerts">
          After {mandate.alertAfterSamples} breached samples,{' '}
          {mandate.alertWebhookConfigured ? 'webhook on' : 'no webhook'}
        </Row>
        <Row k="Registered">
          {full(mandate.createdAt)}, {mandate.active ? 'active' : 'now inactive'}
        </Row>
        <Row k="Latest sample">
          {latest ? (
            <span>
              <span title={full(latest.timestamp)}>{ago(latest.timestamp, now)}</span>, block{' '}
              <span className="mono">{group(latest.blockNumber)}</span>
            </span>
          ) : (
            'No samples yet'
          )}
        </Row>
        <Row k="Notes" wide>
          <span className={mandate.notes ? undefined : 't2'}>{mandate.notes || '—'}</span>
        </Row>
      </dl>
    </AboutSection>
  )
}
