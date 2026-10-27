/**
 * Ships the documents for AI agents with the dashboard build. The text lives once, in
 * `apps/api/src/agentDocs/` (the API serves it at `/AGENTS.md`, `/llms.txt`, `/openapi.json`);
 * this plugin emits the same files at the root of `dist/` and, for the static build, of
 * `dist-static/`.
 *
 * The static site runs no API, so its copies get a note, generated here at build time from the
 * bundle it ships: the `/api` routes do not exist on that host, and `data/bundle.json` (demo or a
 * frozen live export, as its `source` says) is the only data there. The default build's copies are
 * byte-identical to the API's, because `depthwatch serve` answers those paths itself.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Where the API keeps the documents (`apps/api/src/agentDocs`). */
export const AGENT_DOCS_SOURCE_DIR = resolve(HERE, '..', '..', 'api', 'src', 'agentDocs')

/** The documents, by file name; the same list as the API's `AGENT_DOCS`. */
export const AGENT_DOC_FILES = ['AGENTS.md', 'llms.txt', 'openapi.json'] as const
export type AgentDocFile = (typeof AGENT_DOC_FILES)[number]

/** What the static site ships, read from its `data/bundle.json` envelope. */
export interface StaticSiteInfo {
  /** `demo` or `live`, the bundle's `source`. */
  source: string
  /** Unix seconds the bundle was exported at. */
  generatedAt: number
}

export interface EmittedDoc {
  fileName: AgentDocFile
  source: string
}

/** The envelope fields of a static bundle's JSON text. */
export function staticSiteInfo(bundleText: string): StaticSiteInfo {
  const parsed = JSON.parse(bundleText) as { source?: unknown; generatedAt?: unknown }
  if (typeof parsed.source !== 'string' || typeof parsed.generatedAt !== 'number') {
    throw new Error('static build: the bundle has no source / generatedAt envelope')
  }
  return { source: parsed.source, generatedAt: parsed.generatedAt }
}

/** The static-site note: one Markdown paragraph on one line (it reads the same in plain text). */
export function staticNote(info: StaticSiteInfo): string {
  const when = new Date(info.generatedAt * 1000).toISOString()
  const holds =
    info.source === 'demo'
      ? 'It holds the synthetic demo world (`source: "demo"`): made-up pools and numbers, not Base mainnet data.'
      : `It is a frozen export of a Depthwatch database (\`source: "${info.source}"\`) and does not update.`
  return [
    '**Static copy.** This file ships with a static build of the Depthwatch dashboard.',
    'A static site runs no API: the `/api/...` routes described here do not exist on this host.',
    `Its only data is \`data/bundle.json\`, the API's answers exported at \`generatedAt\` ${info.generatedAt} (${when}),`,
    'with keys `health`, `stats`, `pools`, `poolDetails`, `history`, `gaps`, `tokens`, `scorecards`,',
    '`scorecardDetails`, `samples` and `badges`, plus an optional `note` from the exporter.',
    holds,
    'For live data, query a server running `depthwatch serve`.',
  ].join(' ')
}

/**
 * `text` with `note` inserted after its lead: the `# Title` line and, when one follows, the
 * `> summary` blockquote (the llms.txt convention keeps title and summary first).
 */
export function insertAfterLead(text: string, note: string): string {
  const lines = text.split('\n')
  let end = lines[0]?.startsWith('# ') ? 1 : 0
  let next = end
  while (lines[next] === '') next++
  if (lines[next]?.startsWith('>')) {
    while (lines[next]?.startsWith('>')) next++
    end = next
  }
  const rest = lines.slice(end)
  while (rest[0] === '') rest.shift()
  return [...lines.slice(0, end), '', note, '', ...rest].join('\n')
}

function staticVariant(file: AgentDocFile, text: string, info: StaticSiteInfo): string {
  const note = staticNote(info)
  if (file !== 'openapi.json') return insertAfterLead(text, note)
  const doc = JSON.parse(text) as { info: { description: string } }
  doc.info.description = `${note}\n\n${doc.info.description}`
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** The files the build emits: the API's documents, plus the static note when `staticSite` is set. */
export function agentDocFiles(
  staticSite: StaticSiteInfo | null,
  read: (file: AgentDocFile) => string = (file) =>
    readFileSync(resolve(AGENT_DOCS_SOURCE_DIR, file), 'utf8'),
): EmittedDoc[] {
  return AGENT_DOC_FILES.map((fileName) => {
    const text = read(fileName)
    return { fileName, source: staticSite ? staticVariant(fileName, text, staticSite) : text }
  })
}

/** Vite plugin: emits `agentDocFiles(...)` as assets at the root of the build output. */
export function agentDocs(opts: { staticSite?: () => StaticSiteInfo } = {}): Plugin {
  return {
    name: 'depthwatch-agent-docs',
    generateBundle() {
      for (const doc of agentDocFiles(opts.staticSite?.() ?? null)) {
        this.emitFile({ type: 'asset', fileName: doc.fileName, source: doc.source })
      }
    },
  }
}
