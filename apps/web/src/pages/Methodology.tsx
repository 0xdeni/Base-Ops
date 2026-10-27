/**
 * Methodology (`/methodology`, ia-v3 §4.8, docs/design/visual-v3.md §6.8): "How was this
 * computed?" The h1, the provenance answer, then the focal metric index (`#index`): seven terms,
 * one plain line each, each linking to its section. Below it, the sections `#depth` … `#scorecards`
 * in prose at 66ch, each with a schematic where it explains faster than words and its exact
 * formula behind "Show formula" (L2), then "Reproduce any number". From 1200 px a sticky "On this
 * page" list holds the left column; below 1200 px it is a disclosure under the answer.
 */
import { useRef } from 'react'
import { REPO_URL } from '../components/Layout.js'
import { DisclosurePanel, DisclosureTrigger, useDisclosure } from '../components/ui/Disclosure.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { type MetricSection, REPRODUCE, SECTIONS } from './docs/content.js'
import { OnThisPageAside, OnThisPageDisclosure, useAnchorHref } from './docs/OnThisPage.js'
import { useAnchors } from './docs/useAnchors.js'
import './docs/docs.css'

export { SECTIONS } from './docs/content.js'

/** The sticky "On this page" column applies from 75em (1200 px, §3.4). */
export const WIDE_QUERY = '(min-width: 75em)'

export const METRICS_DOC = `${REPO_URL}/blob/main/docs/METRICS.md`
export const SCORECARDS_DOC = `${REPO_URL}/blob/main/docs/SCORECARDS.md`

export const METHODOLOGY_ANSWER =
  'Every number comes from public pool state, using each contract’s own swap math, and can be reproduced from the repository.'

function MetricIndex() {
  const href = useAnchorHref()
  return (
    <section id="index" className="doc-index" aria-label="Metric index">
      <dl>
        {SECTIONS.map((s) => (
          <div key={s.id}>
            <dt>
              <a
                className="tlink doc-term touch-hit"
                href={href(s.id)}
                data-anchor={s.id}
                data-jump-focus
              >
                {s.short}
              </a>
            </dt>
            <dd>{s.definition}</dd>
          </div>
        ))}
      </dl>
      <p className="doc-conv">
        Read every number the same way: a price is the second token per first token, the buy side
        lifts it and the sell side pushes it down, on every page. A price under 1 is written the
        other way round, from the second token, and its sides stay as they are; a missing value
        means unknown, never zero. Nothing is estimated.
      </p>
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
          {REPRODUCE.short}
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
    <div ref={root} className="wrap page doc-page">
      <title>Methodology – Depthwatch</title>
      <div className="title-block">
        <h1 className="h1">Methodology</h1>
      </div>
      <p className="answer answer-block">{METHODOLOGY_ANSWER}</p>
      {wide ? null : <OnThisPageDisclosure />}
      <MetricIndex />
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
  )
}
