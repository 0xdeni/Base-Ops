/**
 * The stylesheets and app sources as text, and the rule parsers the style tests share
 * (styles.test.ts, styles/rules.test.ts). jsdom computes no layout, so the tests check the rules.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
export const WEB = join(SRC, '..')
export const STYLES = join(SRC, 'styles')
export const read = (p: string) => readFileSync(p, 'utf8')
export const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

export function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(test)
    .map((f) => join(dir, f))
}
/** Every stylesheet under src: styles/, and any a component imports itself. */
export const cssFiles = files(SRC, (f) => f.endsWith('.css'))
export const allCss = cssFiles.map(read).join('\n')
/** The shared stylesheets only (styles/). */
export const sharedCss = files(STYLES, (f) => f.endsWith('.css'))
  .map(read)
  .join('\n')
export const tokensCss = read(join(STYLES, 'tokens.css'))

/** The app code (tests and test harnesses excluded). */
export const sources = files(
  SRC,
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('testing'),
).map(read)
/**
 * The UI strings' source: the app code minus data that only mirrors the server, which are the
 * mock world (mandate names are data) and the badge, which copies the API's SVG text.
 */
export const uiSources = files(
  SRC,
  (f) =>
    /\.tsx?$/.test(f) &&
    !/\.test\.tsx?$/.test(f) &&
    !f.startsWith('testing') &&
    !/^api\/mock/.test(f) &&
    f !== join('lib', 'badge.ts'),
).map(read)

/** The declarations block of the first rule whose selector is exactly `selector`. */
export function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`rule ${selector} not found`)
  return match[1]
}

/** `--name: value` pairs of a block, comments dropped and whitespace normalised. */
export function decls(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const d of stripComments(body).split(';')) {
    const [name, ...rest] = d.split(':')
    if (name?.trim().startsWith('--'))
      out.set(name.trim(), rest.join(':').replace(/\s+/g, ' ').trim())
  }
  return out
}

/** The contents of every `@media <query> { … }` block whose query contains `query`, joined. */
export function inMedia(css: string, query: string): string {
  const parts: string[] = []
  let from = 0
  for (;;) {
    const at = css.indexOf(`@media ${query}`, from)
    if (at < 0) return parts.join('\n')
    let depth = 0
    const open = css.indexOf('{', at)
    let i = open
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    parts.push(css.slice(open + 1, i))
    from = i + 1
  }
}

/** Removes every `@media <query> { … }` block whose query contains `query`. */
export function stripMedia(css: string, query: string): string {
  let out = css
  for (;;) {
    const at = out.indexOf(`@media ${query}`)
    if (at < 0) return out
    let depth = 0
    let i = out.indexOf('{', at)
    for (; i < out.length; i++) {
      if (out[i] === '{') depth++
      else if (out[i] === '}' && --depth === 0) break
    }
    out = out.slice(0, at) + out.slice(i + 1)
  }
}
