import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENT_DOC_FILES,
  AGENT_DOCS_SOURCE_DIR,
  type AgentDocFile,
  agentDocFiles,
  agentDocs,
  type EmittedDoc,
  insertAfterLead,
  staticNote,
  staticSiteInfo,
} from './agentDocs.js'

const source = (file: AgentDocFile): string =>
  readFileSync(resolve(AGENT_DOCS_SOURCE_DIR, file), 'utf8')

const DEMO = { source: 'demo', generatedAt: 1_792_713_600 }

function emitted(docs: EmittedDoc[], file: AgentDocFile): string {
  const doc = docs.find((d) => d.fileName === file)
  if (!doc) throw new Error(`${file} not emitted`)
  return doc.source
}

describe('agent documents in the web build', () => {
  it('copies every file of apps/api/src/agentDocs', () => {
    expect([...AGENT_DOC_FILES].sort()).toEqual(readdirSync(AGENT_DOCS_SOURCE_DIR).sort())
  })

  it('default build: byte-identical copies of the API documents', () => {
    const docs = agentDocFiles(null)
    expect(docs.map((d) => d.fileName)).toEqual([...AGENT_DOC_FILES])
    for (const file of AGENT_DOC_FILES) expect(emitted(docs, file)).toBe(source(file))
  })

  it('the plugin emits them as assets at the root of the output', () => {
    const files: Array<{ fileName: string; source: string }> = []
    const plugin = agentDocs()
    const generate = plugin.generateBundle as unknown as (this: {
      emitFile: (file: { type: string; fileName: string; source: string }) => void
    }) => void
    generate.call({ emitFile: (file) => files.push(file) })
    expect(files.map((f) => f.fileName)).toEqual([...AGENT_DOC_FILES])
    expect(files[0]?.source).toBe(source('AGENTS.md'))
  })

  describe('static build', () => {
    const docs = agentDocFiles(DEMO)
    const note = staticNote(DEMO)

    it('the note says the static site has no API and names the bundle it ships', () => {
      const flat = note.replace(/\s+/g, ' ')
      expect(flat).toContain('runs no API')
      expect(flat).toContain('`data/bundle.json`')
      expect(flat).toContain('2026-10-23T00:00:00.000Z')
      expect(flat).toContain('synthetic demo world')
      expect(staticNote({ source: 'live', generatedAt: 0 }).replace(/\s+/g, ' ')).toContain(
        'frozen export',
      )
    })

    it('AGENTS.md: the note right under the title, the rest unchanged', () => {
      const text = emitted(docs, 'AGENTS.md')
      const original = source('AGENTS.md')
      const [title] = original.split('\n')
      expect(text.startsWith(`${title}\n\n${note}\n\n`)).toBe(true)
      expect(text.replace(`\n${note}\n`, '')).toBe(original)
    })

    it('llms.txt: title and summary stay first, the note follows them', () => {
      const lines = emitted(docs, 'llms.txt').split('\n')
      expect(lines[0]).toBe('# Depthwatch')
      expect(lines[2]).toMatch(/^> /)
      expect(lines[3]).toBe('')
      expect(lines.slice(4).join('\n').startsWith(note)).toBe(true)
    })

    it('openapi.json: valid JSON, the note leads info.description, paths unchanged', () => {
      const doc = JSON.parse(emitted(docs, 'openapi.json')) as Record<string, unknown> & {
        info: { description: string }
      }
      const original = JSON.parse(source('openapi.json')) as typeof doc
      expect(doc.info.description.startsWith('**Static copy.**')).toBe(true)
      expect(doc.info.description.endsWith(original.info.description)).toBe(true)
      expect(doc.paths).toEqual(original.paths)
      expect(doc.components).toEqual(original.components)
    })
  })

  it('insertAfterLead without a title or summary puts the note first', () => {
    expect(insertAfterLead('plain\ntext', 'NOTE')).toBe('\nNOTE\n\nplain\ntext')
    expect(insertAfterLead('# T\n\nbody', 'NOTE')).toBe('# T\n\nNOTE\n\nbody')
  })

  it('staticSiteInfo reads the bundle envelope and rejects anything else', () => {
    expect(staticSiteInfo(JSON.stringify({ v: 1, source: 'demo', generatedAt: 5 }))).toEqual({
      source: 'demo',
      generatedAt: 5,
    })
    expect(() => staticSiteInfo('{"v":1}')).toThrow(/envelope/)
  })
})
