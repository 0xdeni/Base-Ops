/**
 * The footer (docs/design/visual-v4.md §5.1): the ink block in both themes. From 1024 px one row of
 * three columns: the wordmark at 28 px; the promise, "Built on Base" in plain text and the data
 * source named once (D7), in `--on-ink-2`; the links Methodology, API and GitHub as 44 px targets.
 * Phones stack them in that order.
 */
import { Link } from 'react-router-dom'
import { Wordmark } from './Logo.js'

export const REPO_URL = 'https://github.com/0xdeni/Base-Ops'

/**
 * The API documentation the build ships next to index.html (AGENTS.md, from apps/api's agent
 * documents): `/AGENTS.md` on a server, `./AGENTS.md` beside a static copy.
 */
export const API_DOCS_HREF = `${import.meta.env.BASE_URL}AGENTS.md`

/** `snapshot`: the static build of a `live` bundle, a dated copy that does not update. */
export type DataSourceKind = 'demo' | 'mock' | 'live' | 'snapshot'

const DATA_LINE: Readonly<Record<DataSourceKind, string>> = {
  demo: 'Data: a synthetic demo world',
  mock: 'Data: the in-repo mock',
  live: 'Data: Base mainnet',
  snapshot: 'Data: a Base mainnet snapshot',
}

export const FOOTER_PROMISE =
  'Open source and read-only. No token, no custody. Built on Base: it indexes Uniswap and Aerodrome pools on Base mainnet.'

export function Footer({ source }: { source: DataSourceKind }) {
  return (
    <footer className="foot">
      <div className="wrap foot-inner">
        <Link className="brand" to="/" aria-label="Depthwatch home">
          <Wordmark size={28} />
        </Link>
        <p className="foot-say">
          {FOOTER_PROMISE} <span className="foot-data">{DATA_LINE[source]}</span>.
        </p>
        <ul className="foot-links">
          <li>
            <Link to="/methodology">Methodology</Link>
          </li>
          <li>
            <a href={API_DOCS_HREF}>API</a>
          </li>
          <li>
            <a href={REPO_URL} rel="noopener">
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </footer>
  )
}
