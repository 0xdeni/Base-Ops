/**
 * Guards for the v3 stylesheets (docs/design/visual-v3.md §3, principles §17). jsdom computes no
 * layout, so these check the rules themselves: the token blocks, contrast of the token pairs, the
 * self-hosted fonts, the greps of the definition of done and no-motion-first CSS. Every rule holds
 * for every stylesheet under src (styles/, and the chart and page sheets their components import)
 * and every UI string of the app code.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))
const WEB = join(SRC, '..')
const STYLES = join(SRC, 'styles')
const read = (p: string) => readFileSync(p, 'utf8')

/** Every stylesheet under src: styles/, and any a component imports itself. */
const allCss = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.css'))
  .map((f) => read(join(SRC, f)))
  .join('\n')
const tokensCss = read(join(STYLES, 'tokens.css'))

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter(test)
    .map((f) => join(dir, f))
}
/** The app code (tests and test harnesses excluded). */
const sources = files(
  SRC,
  (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('testing'),
).map(read)
/**
 * The UI strings' source: the app code minus data that only mirrors the server, which are the
 * mock world (mandate names are data) and the badge, which copies the API's SVG text.
 */
const uiSources = files(
  SRC,
  (f) =>
    /\.tsx?$/.test(f) &&
    !/\.test\.tsx?$/.test(f) &&
    !f.startsWith('testing') &&
    !/^api\/mock/.test(f) &&
    f !== join('lib', 'badge.ts'),
).map(read)

/** The declarations block of the first rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`))
  if (!match?.[1]) throw new Error(`rule ${selector} not found`)
  return match[1]
}

/** `--name: value` pairs of a block, comments dropped and whitespace normalised. */
function decls(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const d of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [name, ...rest] = d.split(':')
    if (name?.trim().startsWith('--'))
      out.set(name.trim(), rest.join(':').replace(/\s+/g, ' ').trim())
  }
  return out
}

/** Removes every `@media <query> { … }` block whose query contains `query`. */
function stripMedia(css: string, query: string): string {
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

// OKLCH → sRGB (Ottosson) and the WCAG 2 contrast ratio.
function oklchToLinear(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ]
}
function luminance(value: string): number {
  const m = value.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/)
  if (!m) throw new Error(`not an oklch colour: ${value}`)
  const [r, g, b] = oklchToLinear(Number(m[1]), Number(m[2]), Number(m[3]))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const light = decls(block(tokensCss, ':root'))
const darkMedia = decls(block(tokensCss, ':root:not([data-theme="light"])'))
const darkForced = decls(block(tokensCss, ':root[data-theme="dark"]'))

describe('colour tokens (§3.1)', () => {
  it('repeats the dark block verbatim under :root[data-theme="dark"]', () => {
    expect([...darkForced.entries()]).toEqual([...darkMedia.entries()])
    expect(tokensCss).toMatch(/:root\[data-theme="dark"\] \{\s*color-scheme: dark;/)
  })

  it('gives every dark token a light value and carries the breach-mark and field tokens', () => {
    for (const name of darkMedia.keys()) expect(light.has(name), name).toBe(true)
    for (const name of ['--bad-mark', '--band-op', '--field-top', '--field-low', '--field-under'])
      expect(darkMedia.has(name) && light.has(name), name).toBe(true)
    expect(light.get('--ht-pitch')).toBe('3px')
  })

  it('meets the contrast tiers against the canvas in both themes (C6)', () => {
    for (const theme of [light, darkMedia]) {
      const canvas = theme.get('--canvas') ?? ''
      const tier = (name: string) => ratio(theme.get(name) ?? '', canvas)
      expect(tier('--text-1')).toBeGreaterThanOrEqual(15)
      expect(tier('--text-2')).toBeGreaterThanOrEqual(7)
      expect(tier('--text-3')).toBeGreaterThanOrEqual(4.5)
      for (const mark of ['--control', '--sell', '--buy', '--bad-mark', '--focus'])
        expect(tier(mark), mark).toBeGreaterThanOrEqual(3)
    }
  })

  it('maps text-3 to text-2 and borders to control under prefers-contrast: more (C8)', () => {
    expect(tokensCss).toMatch(
      /@media \(prefers-contrast: more\) \{\s*:root \{\s*--text-3: var\(--text-2\);\s*--border: var\(--control\);\s*--border-subtle: var\(--control\);/,
    )
  })
})

describe('type scale (§3.3, T4, T5)', () => {
  it('keeps each fluid size within 2.5 × its minimum', () => {
    for (const m of tokensCss.matchAll(/--t-[\w-]+: clamp\(([\d.]+)rem, [^,]+, ([\d.]+)rem\)/g))
      expect(Number(m[2]) / Number(m[1])).toBeLessThanOrEqual(2.5)
  })

  it('sets every font size from a token (or 1rem, the phone body and input size), never below 12 px', () => {
    for (const m of allCss.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = (m[1] ?? '').trim()
      expect(value, value).toMatch(/^(var\(--t-[\w-]+\)|1rem|inherit)$/)
    }
  })
})

describe('fonts (§3.2, T2)', () => {
  const fontsCss = read(join(STYLES, 'fonts.css'))
  const html = read(join(WEB, 'index.html'))

  it('self-hosts the three subsets with their licences beside them', () => {
    for (const file of [
      'hanken-grotesk-var.woff2',
      'ibm-plex-mono-400.woff2',
      'ibm-plex-mono-500.woff2',
      'OFL-HankenGrotesk.txt',
      'OFL-IBMPlexMono.txt',
    ])
      expect(existsSync(join(WEB, 'public', 'fonts', file)), file).toBe(true)
    expect(fontsCss.match(/@font-face/g)).toHaveLength(4)
    expect(fontsCss).toContain('url("/fonts/hanken-grotesk-var.woff2")')
    expect(fontsCss).toMatch(/font-family: "Hanken Fallback";[\s\S]*size-adjust: 101\.7%;/)
    expect(fontsCss.match(/font-display: swap;/g)).toHaveLength(3)
  })

  it('preloads the sans face only and requests no third-party font host', () => {
    expect(html.match(/rel="preload"/g)).toHaveLength(1)
    expect(html).toMatch(/href="\/fonts\/hanken-grotesk-var\.woff2"[\s\S]*as="font"/)
    const everything = [html, allCss, ...sources].join('\n')
    expect(everything).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
  })

  it('pins theme-color to the canvas of each scheme (C8)', () => {
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#f8f9fc"')
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#0e131c"')
  })
})

describe('definition-of-done greps (principles §17)', () => {
  it('has no uppercase, no transition: all and no ease-in anywhere in the stylesheets', () => {
    expect(allCss).not.toMatch(/text-transform:\s*uppercase/)
    expect(allCss).not.toMatch(/transition:\s*all/)
    expect(allCss).not.toMatch(/ease-in[^-]/)
  })

  it('keeps middle dots and arrows out of the UI strings (CP6, tell 3)', () => {
    const strings = uiSources.join('\n').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(strings).not.toMatch(/ · /)
    expect(strings).not.toMatch(/→|->\s*</)
  })

  it('uses the typographic apostrophe in UI strings (CP8)', () => {
    const strings = uiSources.join('\n').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const straight = strings.match(/[A-Za-z}]'(s|t|re|ll|ve|d|m)\b.{0,24}/g) ?? []
    expect(straight).toEqual([])
  })

  it('defines every custom property the stylesheets and components read', () => {
    const defined = new Set([...allCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
    for (const s of sources) for (const m of s.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(m[1])
    const used = [...`${allCss}\n${sources.join('\n')}`.matchAll(/var\((--[\w-]+)(\s*,)?/g)]
      .filter((m) => !m[2])
      .map((m) => m[1] ?? '')
    expect([...new Set(used)].filter((name) => !defined.has(name))).toEqual([])
  })
})

describe('motion is written no-motion first (§3.8, M9)', () => {
  const still = stripMedia(allCss, '(prefers-reduced-motion: no-preference)')

  it('moves nothing outside the no-preference block', () => {
    for (const m of still.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector = '', body = ''] = m
      if (/:active/.test(selector)) expect(body, selector).not.toMatch(/transform/)
      for (const anim of body.matchAll(/animation:\s*([\w-]+)/g))
        expect(['fade-in', 'none'], selector).toContain(anim[1])
    }
  })

  it('uses only the three easings of the tokens', () => {
    const curves = new Set(
      [...allCss.matchAll(/cubic-bezier\(([^)]*)\)/g)].map((m) =>
        (m[1] ?? '').replace(/\s+/g, ' ').trim(),
      ),
    )
    expect([...curves].sort()).toEqual([
      '0.23, 1, 0.32, 1',
      '0.32, 0.72, 0, 1',
      '0.77, 0, 0.175, 1',
    ])
  })
})

/** The contents of every `@media <query> { … }` block whose query contains `query`, joined. */
function inMedia(css: string, query: string): string {
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

describe('touch targets (A5, UX2-06)', () => {
  const coarse = inMedia(allCss, '(pointer: coarse)')

  it('gives a standalone link or trigger a hit area of at least 44 × 44 on touch', () => {
    expect(block(coarse, '.touch-hit')).toMatch(/position:\s*relative/)
    const hit = block(coarse, '.touch-hit::after')
    expect(hit).toMatch(/position:\s*absolute/)
    expect(hit).toMatch(/width:\s*max\(44px,/)
    expect(hit).toMatch(/height:\s*max\(44px,/)
    // The demo line's trigger reaches 44 px down from the top of the page.
    expect(block(coarse, '.demo-inner .touch-hit::after')).toMatch(/height:\s*44px/)
    expect(block(coarse, '.foot-links a')).toMatch(/min-height:\s*44px/)
    expect(block(coarse, '.foot-links a::after')).toMatch(/width:\s*max\(44px, 100%\)/)
  })

  it('uses it on the meta-line pool link, How the score works, About the demo, the Gap marker, the worst-moment times and the token route', () => {
    const at = (file: string) => read(join(SRC, file))
    expect(at('pages/mm/ScorecardTitle.tsx')).toMatch(/className="plink touch-hit"/)
    expect(at('pages/Gaps.tsx')).toMatch(/className="plink touch-hit"/)
    expect(at('components/shell/DemoLine.tsx')).toMatch(/triggerClassName="quiet-link touch-hit"/)
    expect(at('components/charts/DepthButterfly.tsx')).toMatch(/className="bf-gap-link touch-hit"/)
    expect(at('pages/mm/ScorecardSections.tsx')).toMatch(/className="touch-hit"/)
    expect(at('pages/token/TokenFacts.tsx').match(/touch-hit/g)).toHaveLength(2)
  })

  it('keeps the Not rated chip reachable above a row link, with the standalone-trigger hit area', () => {
    // The stretched row links (`.row-link::after`, `.rl-link::after`) paint over a non-positioned
    // button, so a hover or tap would navigate instead of opening the reason (as `.dash .gloss`).
    const stretched = block(allCss, '.ptable .row-link::after')
    expect(stretched).toMatch(/position:\s*absolute/)
    expect(stretched).toMatch(/inset:\s*0/)
    const above = block(allCss, '.grade.is-unrated .gloss')
    expect(above).toMatch(/position:\s*relative/)
    expect(above).toMatch(/z-index:\s*1\b/)
    expect(block(allCss, '.dash .gloss')).toMatch(/z-index:\s*1\b/)
    const chip = read(join(SRC, 'components/ui/GradeGlyph.tsx'))
    expect(chip).toMatch(/className="touch-hit"/)
  })
})

describe('layout guards (UX2-01, UX2-03)', () => {
  it('lets a loaded short page rest its footer at the viewport bottom, not below the fold', () => {
    expect(block(allCss, 'main')).not.toMatch(/min-height/)
    // Only a route skeleton or the route cross-fade holds <main> to the first viewport.
    expect(allCss).toMatch(
      /\nmain:is\(:has\(\.skel-stack\), :root:active-view-transition \*\) \{\s*min-height:/,
    )
  })

  it('keeps one- and two-word disclosure labels on one line', () => {
    expect(block(allCss, '.disc-label')).toMatch(/text-wrap:\s*pretty/)
    expect(block(allCss, '.disc-label.is-short')).toMatch(/text-wrap:\s*balance/)
    expect(block(allCss, '.doc-sec-head .disc-label')).toMatch(/white-space:\s*nowrap/)
  })
})
