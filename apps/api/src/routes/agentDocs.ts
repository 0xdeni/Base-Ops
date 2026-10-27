/**
 * The documents for AI agents served at the root of every Depthwatch server: `GET /AGENTS.md`
 * (how to use the API), `GET /llms.txt` (the llms.txt index) and `GET /openapi.json` (OpenAPI 3.1
 * of the GET routes). Their text lives once, in `src/agentDocs/`; the dashboard build copies the
 * same files into `apps/web/dist` and, with a static-site note, into `apps/web/dist-static`.
 *
 * `createApp` registers these before the static dashboard, so the SPA fallback never answers for
 * them, even when the built dashboard carries copies of the same files.
 */
import { readFileSync } from 'node:fs'
import { Hono } from 'hono'

export interface AgentDoc {
  /** Path the server answers on. */
  path: `/${string}`
  /** File name in `src/agentDocs/` (also the file name the web build emits). */
  file: string
  contentType: string
}

export const AGENT_DOCS: readonly AgentDoc[] = Object.freeze([
  { path: '/AGENTS.md', file: 'AGENTS.md', contentType: 'text/markdown; charset=utf-8' },
  { path: '/llms.txt', file: 'llms.txt', contentType: 'text/plain; charset=utf-8' },
  { path: '/openapi.json', file: 'openapi.json', contentType: 'application/json' },
])

/** `src/agentDocs/`, resolved from this file so it works from any working directory. */
export const AGENT_DOCS_DIR = new URL('../agentDocs/', import.meta.url)

const texts = new Map<string, string>()

/** The text of one agent document, read on first use and kept for the process lifetime. */
export function readAgentDoc(file: string): string {
  let text = texts.get(file)
  if (text === undefined) {
    text = readFileSync(new URL(file, AGENT_DOCS_DIR), 'utf8')
    texts.set(file, text)
  }
  return text
}

/** `GET` (and `HEAD`) for every entry of `AGENT_DOCS`, mounted at the root. */
export function agentDocsRoutes(): Hono {
  const app = new Hono()
  for (const doc of AGENT_DOCS) {
    app.get(doc.path, (c) =>
      c.body(readAgentDoc(doc.file), 200, { 'Content-Type': doc.contentType }),
    )
  }
  return app
}
