/**
 * CONTRIBUTING.md tells people where to go, so every place it points at must exist. In particular
 * its "Reporting problems" section sends security reports away from public issues; the place it
 * sends them to (SECURITY.md) must exist and name a concrete private channel, or a reporter who
 * follows the instructions has nowhere to go.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const contributing = readFileSync(join(ROOT, 'CONTRIBUTING.md'), 'utf8')

/** The body of `heading` up to the next heading, with line wraps collapsed to single spaces. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found in CONTRIBUTING.md`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,6} /)
  return (end < 0 ? body : body.slice(0, end)).replace(/\s+/g, ' ')
}

/** The targets of the `[text](target)` links in `markdown`. */
function linkTargets(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? '')
}

/** GitHub's anchor for a heading: lowercased, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function headingSlugs(markdown: string): string[] {
  return [...markdown.matchAll(/^#{1,6} +(.+?)\s*$/gm)].map((m) => slug(m[1] ?? ''))
}

describe('CONTRIBUTING.md: every repository link resolves', () => {
  const targets = linkTargets(contributing).filter((t) => !/^[a-z][\w+.-]*:/i.test(t))

  it('has repository links to check', () => {
    expect(targets.length).toBeGreaterThan(0)
  })

  it.each(targets)('%s points at a file (and heading) that exists', (target) => {
    const [path = '', fragment] = target.split('#')
    expect(existsSync(join(ROOT, path))).toBe(true)
    if (fragment !== undefined) {
      expect(headingSlugs(readFileSync(join(ROOT, path), 'utf8'))).toContain(fragment)
    }
  })
})

describe('CONTRIBUTING.md: security reports have somewhere to go', () => {
  const reporting = section(contributing, '## Reporting problems')

  it('sends security issues to SECURITY.md rather than to an unnamed contact', () => {
    expect(reporting).toMatch(/security/i)
    expect(linkTargets(reporting)).toContain('SECURITY.md')
    expect(reporting).not.toMatch(/security contact/i)
  })

  it('SECURITY.md exists and names a private reporting channel', () => {
    const security = readFileSync(join(ROOT, 'SECURITY.md'), 'utf8')
    // GitHub's private vulnerability reporting form for this repository.
    expect(security).toMatch(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/security\/advisories\/new/)
    expect(security).toMatch(/do not open a public issue/i)
  })
})
