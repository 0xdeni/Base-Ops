/**
 * Footer (ia-v3 §3.3, docs/design/visual-v3.md §5.1): the wordmark and the promise, the links
 * Methodology, API and GitHub, and the data source named once (D7). A two-column grid on phones.
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
  demo: 'Data: synthetic demo world',
  mock: 'Data: in-repo mock',
  live: 'Data: Base mainnet',
  snapshot: 'Data: Base mainnet snapshot',
}

export function Footer({ source }: { source: DataSourceKind }) {
  return (
    <footer className="foot">
      <div className="wrap foot-inner">
        <div className="foot-a">
          <Link className="brand" to="/" aria-label="Depthwatch home">
            <Wordmark />
          </Link>
          <p>Open source and read-only. No token, no custody.</p>
        </div>
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
        <p className="foot-data">{DATA_LINE[source]}</p>
      </div>
    </footer>
  )
}
