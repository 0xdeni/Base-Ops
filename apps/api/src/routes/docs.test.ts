/**
 * docs/ARCHITECTURE.md ("API and dashboard") says which documents list the API routes. These
 * checks pin that pointer to the routes `createApp` really registers: a document the page says
 * lists every route must list each of them, and the per-layer pointers must hold for their layer.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Where each document that can be named as a route listing keeps its routes. */
const LISTINGS = [
  { name: 'README', file: 'README.md', heading: '## API' },
  { name: 'DESIGN.md', file: 'DESIGN.md', heading: '## API (apps/api)' },
  {
    name: '[design/scorecards.md](design/scorecards.md)',
    file: 'docs/design/scorecards.md',
    heading: '## 6. API (`apps/api`)',
  },
] as const

/** `METHOD /path` of every handler `createApp` registers (middleware entries are `ALL`). */
function registeredRoutes(): string[] {
  const db = openDatabase(IN_MEMORY)
  try {
    const routes = createApp(db)
      .routes.filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path}`)
    return [...new Set(routes)]
  } finally {
    db.close()
  }
}

/** The body under `heading` up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found`)
  const body = markdown.slice(start + heading.length + 2)
  const end = body.search(new RegExp(`\\n#{1,${heading.indexOf(' ')}} `))
  return end < 0 ? body : body.slice(0, end)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The routes `markdown` does not mention as `METHOD /path` (a longer path does not count). */
function unlisted(markdown: string, routes: readonly string[]): string[] {
  return routes.filter((route) => !new RegExp(`${escapeRegExp(route)}(?![\\w/:.-])`).test(markdown))
}

/** A listing's route section, by the name ARCHITECTURE.md gives the document. */
function listing(name: (typeof LISTINGS)[number]['name']): string {
  const doc = LISTINGS.find((l) => l.name === name)
  if (!doc) throw new Error(`unknown listing ${name}`)
  return section(read(doc.file), doc.heading)
}

const routes = registeredRoutes()
const scorecardRoutes = routes.filter((r) => / \/api\/mm(?:\/|$)/.test(r))
const layer1Routes = routes.filter((r) => !scorecardRoutes.includes(r))
const architecture = section(read('docs/ARCHITECTURE.md'), '## API and dashboard').replace(
  /\s+/g,
  ' ',
)

describe('ARCHITECTURE.md: the documents it names list the routes createApp registers', () => {
  it('sees both layers of routes', () => {
    expect(layer1Routes).toEqual(expect.arrayContaining(['GET /api/health', 'GET /api/pools/:id']))
    expect(scorecardRoutes).toEqual(
      expect.arrayContaining(['GET /api/mm/:id/badge.svg', 'POST /api/mm', 'DELETE /api/mm/:id']),
    )
  })

  it('every document named as listing all routes lists each of them', () => {
    const claim = architecture.match(/(?:Every route is|Routes are) listed in (.+?)[.;](?:\s|$)/)
    if (!claim?.[1]) throw new Error(`no route-listing pointer in:\n${architecture}`)
    const named = LISTINGS.filter((l) => claim[1]?.includes(l.name))
    expect(named.map((l) => l.name)).toContain('README')
    for (const doc of named) {
      expect({ doc: doc.name, missing: unlisted(listing(doc.name), routes) }).toEqual({
        doc: doc.name,
        missing: [],
      })
    }
  })

  it('DESIGN.md lists the layer-1 routes', () => {
    expect(architecture).toContain('DESIGN.md lists the layer-1 ones')
    expect(unlisted(listing('DESIGN.md'), layer1Routes)).toEqual([])
  })

  it('design/scorecards.md §6 lists the scorecard routes', () => {
    expect(architecture).toContain(
      '[design/scorecards.md](design/scorecards.md) §6 the scorecard ones',
    )
    expect(
      unlisted(listing('[design/scorecards.md](design/scorecards.md)'), scorecardRoutes),
    ).toEqual([])
  })
})
