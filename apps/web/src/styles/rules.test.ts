/**
 * Guards for the stylesheets (docs/design/visual-v4.md §3.8, §4, §5, §8), part two: the greps of
 * the definition of done, no-motion-first CSS and the three easings, and the touch and layout
 * guards. Every rule holds for every stylesheet under src and every UI string of the app code.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EASE } from '../lib/motion.js'
import {
  allCss,
  block,
  decls,
  inMedia,
  read,
  SRC,
  sharedCss,
  sources,
  stripComments,
  stripMedia,
  tokensCss,
  uiSources,
} from './cssRules.js'

describe('definition-of-done greps', () => {
  it('has no transition: all and no ease-in anywhere in the stylesheets', () => {
    expect(allCss).not.toMatch(/transition:\s*all/)
    expect(allCss).not.toMatch(/ease-in[^-]/)
  })

  it('keeps middle dots and arrows out of the UI strings', () => {
    const strings = uiSources.join('\n').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    expect(strings).not.toMatch(/ · /)
    expect(strings).not.toMatch(/→|->\s*</)
  })

  it('uses the typographic apostrophe in UI strings', () => {
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

describe('motion is written no-motion first (§3.8, §4)', () => {
  const still = stripMedia(allCss, '(prefers-reduced-motion: no-preference)')

  it('moves nothing outside the no-preference block, and nothing loops', () => {
    for (const m of still.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector = '', body = ''] = m
      if (/:active/.test(selector)) expect(body, selector).not.toMatch(/transform/)
      for (const anim of body.matchAll(/animation:\s*([\w-]+)/g))
        expect(['fade-in', 'none'], selector).toContain(anim[1])
    }
    expect(allCss).not.toMatch(/infinite/)
  })

  it('uses only the three v4 easings, in CSS and in the Web Animations code alike', () => {
    const curves = new Set(
      [...allCss.matchAll(/cubic-bezier\(([^)]*)\)/g)].map((m) =>
        (m[1] ?? '').replace(/\s+/g, ' ').trim(),
      ),
    )
    expect([...curves].sort()).toEqual(['0.16, 1, 0.3, 1', '0.32, 0.72, 0, 1', '0.65, 0, 0.35, 1'])
    const token = (name: string) => decls(tokensCss.replace(/[{}]/g, ';')).get(name)
    expect(EASE).toEqual({
      out: token('--ease-out'),
      inOut: token('--ease-in-out'),
      drawer: token('--ease-drawer'),
    })
  })

  it('cross-fades <main> 100 ms out and 180 ms in, and never the root', () => {
    const allowed = inMedia(allCss, '(prefers-reduced-motion: no-preference)')
    expect(block(allowed, '::view-transition-old(main)')).toMatch(/var\(--d-route-out\)/)
    expect(block(allowed, '::view-transition-new(main)')).toMatch(/var\(--d-route-in\)/)
    const tokens = decls(tokensCss.replace(/[{}]/g, ';'))
    expect([tokens.get('--d-route-out'), tokens.get('--d-route-in')]).toEqual(['100ms', '180ms'])
    expect(allCss).toMatch(/::view-transition-new\(root\) \{\s*animation: none;/)
  })
})

describe('touch targets and layering (A5, §5.5)', () => {
  const coarse = inMedia(allCss, '(pointer: coarse)')

  it('gives a standalone link or trigger a hit area of at least 44 × 44 on touch', () => {
    expect(block(coarse, '.touch-hit')).toMatch(/position:\s*relative/)
    const hit = block(coarse, '.touch-hit::after')
    expect(hit).toMatch(/position:\s*absolute/)
    expect(hit).toMatch(/width:\s*max\(44px,/)
    expect(hit).toMatch(/height:\s*max\(44px,/)
    // The snapshot or demo line's trigger reaches 44 px down from the top of the page.
    expect(block(coarse, '.demo-inner .touch-hit::after')).toMatch(/height:\s*44px/)
    expect(block(sharedCss, '.foot-links a')).toMatch(/min-height:\s*44px/)
    for (const sel of ['.seg-item', '.icon-btn', '.disc-btn', '.back', '.check'])
      expect(block(coarse, sel), sel).toMatch(/(height|min-height|width):\s*44px/)
    const at = (file: string) => read(join(SRC, file))
    expect(at('components/shell/DemoLine.tsx')).toMatch(/triggerClassName="quiet-link touch-hit"/)
    expect(at('components/ui/GradeGlyph.tsx')).toMatch(/className="touch-hit"/)
  })

  it('keeps the Not rated chip reachable above a row link', () => {
    const stretched = block(allCss, '.ptable .row-link::after')
    expect(stretched).toMatch(/position:\s*absolute/)
    expect(stretched).toMatch(/inset:\s*0/)
    const chip = block(allCss, '.grade.is-unrated')
    expect(chip).toMatch(/position:\s*relative/)
    expect(chip).toMatch(/z-index:\s*2\b/)
    expect(block(allCss, '.dash .gloss')).toMatch(/z-index:\s*1\b/)
  })

  it('draws the freshness dot as a circle, never a square', () => {
    expect(block(sharedCss, '.fresh-dot')).toMatch(/border-radius:\s*50%/)
  })
})

describe('layout guards (§5.1, §8.11)', () => {
  it('lets a loaded short page rest its footer at the viewport bottom, not below the fold', () => {
    expect(block(allCss, 'main')).not.toMatch(/min-height/)
    expect(allCss).toMatch(
      /\nmain:is\(:has\(\.skel-stack\), :root:active-view-transition \*\) \{\s*min-height:/,
    )
  })

  it('pins nothing to the bottom of the viewport outside an installed app', () => {
    const outside = stripMedia(stripComments(sharedCss), '(max-width: 52.49em) and (display-mode')
    const pinned = [...outside.matchAll(/([^{}]+)\{[^{}]*position:\s*(?:sticky|fixed)[^{}]*\}/g)]
      .filter((m) => /\bbottom:\s*0/.test(m[0]))
      .map((m) => (m[1] ?? '').trim())
    expect(pinned).toEqual([])
    const standalone = inMedia(sharedCss, '(max-width: 52.49em) and (display-mode: standalone)')
    expect(block(standalone, '.dock')).toMatch(/position:\s*sticky;[\s\S]*bottom:\s*0/)
  })

  it('keeps one- and two-word disclosure labels on one line', () => {
    expect(block(allCss, '.disc-label')).toMatch(/text-wrap:\s*pretty/)
    expect(block(allCss, '.disc-label.is-short')).toMatch(/text-wrap:\s*balance/)
    expect(block(allCss, '.disc-tail')).toMatch(/white-space:\s*nowrap/)
  })
})
