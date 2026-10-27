/**
 * The dashboard's dependency on `@depthwatch/core` is a runtime one (`DEXES`, `healthGrade`,
 * `computeHealthScore`, …), not a type-only one. The packages tables in docs/ARCHITECTURE.md and
 * DESIGN.md must say so; this pins them to the imports that actually exist under `src`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SRC, '..', '..', '..')

/** Source files (tests excluded) that import at least one runtime value from core. */
function valueImportersOfCore(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
    const source = readFileSync(join(SRC, entry), 'utf8')
    // `import type { … }` never matches (`type` sits between `import` and `{`); inline `type X`
    // specifiers are filtered below, so what remains is a value import.
    for (const match of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*'@depthwatch\/core'/g)) {
      const specifiers = (match[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (specifiers.some((s) => !s.startsWith('type '))) {
        out.push(entry)
        break
      }
    }
  }
  return out.sort()
}

/** The cells of the markdown table row whose first cell is `firstCell`. */
function tableRow(markdown: string, firstCell: string): string[] {
  const line = markdown.split('\n').find((l) => l.startsWith(`| ${firstCell} `))
  if (!line) throw new Error(`no table row starting with ${firstCell}`)
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

describe('packages tables: web depends on core at runtime', () => {
  it('the dashboard imports runtime values from core', () => {
    expect(valueImportersOfCore()).toEqual(
      expect.arrayContaining(['pages/lists/poolsState.ts', 'pages/lists/poolsText.ts']),
    )
  })

  it('ARCHITECTURE.md and DESIGN.md list core as a plain dependency, not types only', () => {
    const architecture = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')
    const dependsOn = tableRow(architecture, '`@depthwatch/web`')[1]
    expect(dependsOn).toMatch(/^core, /)
    expect(dependsOn).not.toMatch(/types/)

    const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8')
    const mayImport = tableRow(design, '`apps/web`')[3]
    expect(mayImport).toMatch(/^core, /)
    expect(mayImport).not.toMatch(/types/)
  })
})
