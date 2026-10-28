/**
 * Methodology (`/methodology`, ia-v3 §4.8, docs/design/visual-v4.md §6.9): "How was this
 * computed?" The title section (the eyebrow, the lowercase title "method" and the provenance
 * answer at its right); the band with one lead; seven metric blocks, the first three stacked over
 * the band's lower edge, each a lowercase heading and one plain line that jumps to its section
 * (`#index` holds them). Then the conventions, and the sections `#depth` … `#scorecards` in prose
 * at 66ch, each with a schematic where it explains faster than words and its exact formula behind
 * "Show formula" (L2), then "Reproduce any number". From 1200 px a sticky "On this page" list holds
 * the left column; below 1200 px it is a disclosure above the sections.
 */
import { useRef } from 'react'
import { REPO_URL } from '../components/Layout.js'
import { Band } from '../components/ui/Band.js'
import { blockClass } from '../components/ui/Block.js'
import { DisclosurePanel, DisclosureTrigger, useDisclosure } from '../components/ui/Disclosure.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { type MetricSection, REPRODUCE, SECTIONS } from './docs/content.js'
import { OnThisPageAside, OnThisPageDisclosure, useAnchorHref } from './docs/OnThisPage.js'
import { useAnchors } from './docs/useAnchors.js'
import './docs/docs.css'

export { SECTIONS } from './docs/content.js'

/** The sticky "On this page" column applies from 75em (1200 px, §3.5). */
export const WIDE_QUERY = '(min-width: 75em)'

export const METRICS_DOC = `${REPO_URL}/blob/main/docs/METRICS.md`
export const SCORECARDS_DOC = `${REPO_URL}/blob/main/docs/SCORECARDS.md`

export const METHODOLOGY_ANSWER =
  'Every number comes from public pool state, using each contract’s own swap math, and can be reproduced from the repository.'

/** The metric blocks stacked over the band (§6.9). */
const OVER = 3

function MetricIndex() {
  const href = useAnchorHref()
  return (
    <section id="index" className="wrap overlap doc-index" aria-label="Metric index">
      <ul className="grid">
        {SECTIONS.map((s, i) => (
          <li key={s.id} className={i < SECTIONS.length - 1 ? 'c4' : 'c12'}>
            <a
              className={blockClass({ over: i < OVER, dest: true, className: 'doc-metric' })}
              href={href(s.id)}
              data-anchor={s.id}
              data-jump-focus
              data-over={i < OVER ? '' : undefined}
            >
              <h2 className="h2">{s.short.toLowerCase()}</h2>
              <span className="take">{s.definition}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Section({ section }: { section: MetricSection }) {
  const formula = useDisclosure()
  const h = `${section.id}-h`
  return (
    <section id={section.id} className="doc-sec" aria-labelledby={h}>
      <div className="doc-sec-head">
        <h2 className="h2" id={h} tabIndex={-1} data-jump-focus>
          {section.title}
        </h2>
        <DisclosureTrigger state={formula} label="Show formula" />
      </div>
      <div className="doc-prose">{section.body}</div>
      {section.figure ?? null}
      <DisclosurePanel state={formula}>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling code block must be reachable by keyboard */}
        <pre className="codeblock doc-formula" tabIndex={0}>
          <code>{section.formula}</code>
        </pre>
      </DisclosurePanel>
    </section>
  )
}

function Reproduce() {
  const h = `${REPRODUCE.id}-h`
  return (
    <section id={REPRODUCE.id} className="doc-sec" aria-labelledby={h}>
      <div className="doc-sec-head">
        <h2 className="h2" id={h} tabIndex={-1} data-jump-focus>
          {REPRODUCE.title}
        </h2>
      </div>
      <div className="doc-prose">
        <p>
          Every reading is computed from public data with open-source code, so any number can be
          reproduced with a Base RPC endpoint and the{' '}
          <a className="plink" href={REPO_URL} target="_blank" rel="noreferrer">
            repository
          </a>
          . The exact definitions, each with a worked example, are in{' '}
          <a className="plink" href={METRICS_DOC} target="_blank" rel="noreferrer">
            METRICS.md
          </a>{' '}
          and{' '}
          <a className="plink" href={SCORECARDS_DOC} target="_blank" rel="noreferrer">
            SCORECARDS.md
          </a>
          .
        </p>
      </div>
    </section>
  )
}

export function Methodology() {
  const root = useRef<HTMLDivElement | null>(null)
  const wide = useMediaQuery(WIDE_QUERY)
  useAnchors(root)
  return (
    <div ref={root} className="doc">
      <title>Methodology – Depthwatch</title>
      <section className="wrap ttl" aria-labelledby="doc-title">
        <p className="eyebrow eb-row" data-in="">
          <span>Methodology</span>
        </p>
        <div className="ttl-grid">
          <h1 className="title" id="doc-title" data-rise="">
            method
          </h1>
          <p className="answer" data-rise="">
            {METHODOLOGY_ANSWER}
          </p>
        </div>
      </section>
      <Band label="Metrics" className="doc-band">
        <p className="lead" data-in="">
          Seven metrics, each defined once in{' '}
          <a className="plink" href={METRICS_DOC} target="_blank" rel="noreferrer">
            docs/METRICS.md
          </a>{' '}
          and computed once in packages/core.
        </p>
      </Band>
      <MetricIndex />
      <div className="wrap doc-rest">
        <p className="prose doc-conv">
          Read every number the same way: a price is the second token per first token, the buy side
          lifts it and the sell side pushes it down, on every page. A price under 1 is written the
          other way round, from the second token, and its sides stay as they are; a missing value
          means unknown, never zero. Nothing is estimated.
        </p>
        {wide ? null : <OnThisPageDisclosure />}
        <div className={`doc-body${wide ? ' is-wide' : ''}`}>
          {wide ? <OnThisPageAside /> : null}
          <div className="doc-secs">
            {SECTIONS.map((s) => (
              <Section key={s.id} section={s} />
            ))}
            <Reproduce />
          </div>
        </div>
      </div>
    </div>
  )
}
