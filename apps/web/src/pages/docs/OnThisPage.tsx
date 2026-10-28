/**
 * "On this page" (ia-v3 §4.8, docs/design/visual-v4.md §6.9): from 1200 px a sticky list in the
 * left column with the current section in `--text-1` and a 4 px `--nav-ind` bar on the rail; below
 * 1200 px a disclosure above the sections. Links are real hrefs (they open in a new tab, and work in the hash
 * router) whose plain clicks `useAnchors` turns into instant in-page jumps.
 */
import { useHref, useLocation } from 'react-router-dom'
import { Disclosure } from '../../components/ui/Disclosure.js'
import { OUTLINE } from './content.js'
import { useCurrentSection } from './useAnchors.js'

const IDS = OUTLINE.map((o) => o.id)

/** The href of an in-page anchor in either router: "/methodology#depth" or "#/methodology#depth". */
export function useAnchorHref(): (id: string) => string {
  const base = useHref(useLocation().pathname)
  return (id) => `${base}#${id}`
}

function OutlineList({ current }: { current: string | null }) {
  const href = useAnchorHref()
  return (
    <ol className="doc-outline">
      {OUTLINE.map((o) => (
        <li key={o.id}>
          <a
            href={href(o.id)}
            data-anchor={o.id}
            aria-current={current === o.id ? 'location' : undefined}
          >
            {o.label}
          </a>
        </li>
      ))}
    </ol>
  )
}

/** The sticky left-column list (≥ 1200 px). */
export function OnThisPageAside() {
  const current = useCurrentSection(IDS)
  return (
    <nav className="doc-toc" aria-labelledby="doc-toc-h">
      <p className="meta doc-toc-h" id="doc-toc-h">
        On this page
      </p>
      <OutlineList current={current} />
    </nav>
  )
}

/** The disclosure above the sections (below 1200 px). */
export function OnThisPageDisclosure() {
  return (
    <Disclosure label="On this page" className="doc-toc-disc">
      <nav aria-label="On this page">
        <OutlineList current={null} />
      </nav>
    </Disclosure>
  )
}
