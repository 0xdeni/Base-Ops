/**
 * The static app on a live-shaped bundle: `testing/liveShape.json` holds 60 pools cut from a
 * `depthwatch export` of Base mainnet (CONTRIBUTING.md says how to refresh it). Unlike the 18
 * tidy pools of the demo world, it has Uniswap v4 pools without a TVL, mostly unrated pools
 * (`thin` and `one-sided`), pools that share pair, DEX and fee, no measured top LP share and
 * prices from 1e-39 to 1e38. Every route boots on it, and what `<main>` says (its text, labels and
 * native tooltips) is swept for the number rules of docs/design/principles.md §8 (no NaN,
 * `undefined` or Infinity, no `$0.00`, no lowercase `k`, no exponent, no float written out in full
 * like `10.483274767849013`), for one name per link target and for a "—" that is never a tab stop.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, screen, waitFor } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { assertStaticBundle } from './api/static.js'
import type { PoolSummary } from './api/types.js'
import { startStatic } from './staticBoot.js'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'testing', 'liveShape.json')
const LIVE = assertStaticBundle(JSON.parse(readFileSync(FIXTURE, 'utf8')))

function pick(what: string, test: (p: PoolSummary) => boolean): PoolSummary {
  const found = LIVE.pools.find(test)
  if (!found) throw new Error(`liveShape.json has no ${what}`)
  return found
}

const byPrice = LIVE.pools
  .filter((p) => p.price !== null)
  .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
const twinKey = ({ pool }: PoolSummary) =>
  [pool.token0.symbol, pool.token1.symbol, pool.dex, pool.feePips].join(' ')
const groups = new Map<string, PoolSummary[]>()
for (const p of LIVE.pools) groups.set(twinKey(p), [...(groups.get(twinKey(p)) ?? []), p])
const twinGroups = [...groups.values()].filter((group) => group.length > 1)
const SHAPES = {
  rated: pick('rated pool', (p) => p.health.rated),
  v4WithoutTvl: pick(
    'Uniswap v4 pool without a TVL',
    (p) => p.pool.dex === 'uniswap-v4' && p.tvlUsd === null,
  ),
  thin: pick('thin pool', (p) => p.health.unratedReason === 'thin'),
  oneSided: pick('one-sided pool', (p) => p.health.unratedReason === 'one-sided'),
  twin: twinGroups[0]?.[0] ?? pick('pool sharing pair, DEX and fee', () => false),
  cheapest: byPrice[0] ?? pick('pool', () => false),
  dearest: byPrice.at(-1) ?? pick('pool', () => false),
}

const poolRoute = (p: PoolSummary) => `#/pools/${encodeURIComponent(p.pool.id)}`
const ROUTES = [
  ...new Set([
    '#/',
    '#/pools',
    '#/pools?unrated=1&cols=tvl,gap,top,price,updated',
    '#/pools?sort=spread',
    '#/gaps',
    '#/gaps?view=table',
    ...Object.values(SHAPES).map(poolRoute),
    ...Object.keys(LIVE.tokens).map((address) => `#/tokens/${address}`),
    '#/mm',
    '#/methodology',
  ]),
]

let mounted: { root: Root; container: HTMLElement } | null = null

async function boot(hash: string): Promise<void> {
  window.location.hash = hash
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted = { root, container }
  await act(async () => {
    await startStatic(root, async () => LIVE)
  })
}

afterEach(() => {
  if (mounted) {
    const { root, container } = mounted
    act(() => root.unmount())
    container.remove()
    mounted = null
  }
  window.location.hash = ''
})

/** Each text node, label and native tooltip of `main` on its own line, so cells never merge. */
function spoken(main: Element): string {
  const parts: string[] = []
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode())
    parts.push(node.nodeValue ?? '')
  for (const el of main.querySelectorAll('[aria-label], [title]'))
    parts.push(el.getAttribute('aria-label') ?? '', el.getAttribute('title') ?? '')
  return parts.filter((part) => part.trim() !== '').join('\n')
}

/** Addresses and pool ids, also shortened (`0x42d4…b76b`), are hex, not numbers. */
const HEX = /0x[0-9a-f]+(…[0-9a-f]+)?/gi
const NUMBER_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['NaN', /\bNaN\b/],
  ['undefined', /\bundefined\b/],
  ['Infinity', /Infinity/],
  ['$0.00', /\$0\.00(?!\d)/],
  ['lowercase k', /\d(\.\d+)?k\b/],
  ['.0 before a suffix', /\d\.0[KMB]\b/],
  ['exponent', /\d(\.\d+)?e[-+]?\d/i],
]

/** The lines of `text` that break a number rule, each prefixed with the rule. */
function numberRuleBreaks(text: string): string[] {
  const breaks: string[] = []
  for (const line of text.split('\n')) {
    const plain = line.replace(HEX, '0x')
    for (const [rule, pattern] of NUMBER_RULES)
      if (pattern.test(plain)) breaks.push(`${rule}: ${line.trim()}`)
    // A float written out as is (`10.483274767849013`): more than 10 significant digits.
    for (const [number] of plain.matchAll(/\d+(\.\d+)?/g))
      if (number.replace('.', '').replace(/^0+|0+$/g, '').length > 10)
        breaks.push(`long number: ${line.trim()}`)
  }
  return breaks
}

function linkName(link: Element): string {
  const label = link.getAttribute('aria-label')
  if (label) return label.trim()
  const ids = link.getAttribute('aria-labelledby')
  const text = ids
    ? ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    : (link.textContent ?? '')
  return text.replace(/\s+/g, ' ').trim()
}

/** Hidden from assistive technology: outside the links list and the tab order. */
const hidden = (el: Element) => el.closest('[aria-hidden="true"], [hidden], [inert]') !== null

/** Link names in `main` that lead to more than one place. */
function duplicateLinkNames(main: Element): string[] {
  const targets = new Map<string, Set<string>>()
  for (const link of main.querySelectorAll('a[href]')) {
    if (hidden(link)) continue
    const name = linkName(link)
    const hrefs = targets.get(name) ?? new Set<string>()
    hrefs.add(link.getAttribute('href') ?? '')
    targets.set(name, hrefs)
  }
  return [...targets].filter(([, hrefs]) => hrefs.size > 1).map(([name, h]) => `${name} ×${h.size}`)
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]'

/** Tab stops in `main` that only say "—" (D6: an unknown value is never a control). */
function focusableDashes(main: Element): string[] {
  return [...main.querySelectorAll(FOCUSABLE)]
    .filter((el) => el.getAttribute('tabindex') !== '-1' && !el.hasAttribute('disabled'))
    .filter((el) => !hidden(el))
    .filter((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === '—')
    .map((el) => el.outerHTML.slice(0, 160))
}

describe('the live-shaped fixture', () => {
  it('holds the shapes the demo world lacks', () => {
    expect(LIVE.source).toBe('live')
    expect(LIVE.pools.length).toBeGreaterThanOrEqual(50)
    expect(
      LIVE.pools.filter((p) => p.pool.dex === 'uniswap-v4' && p.tvlUsd === null).length,
    ).toBeGreaterThan(1)
    expect(LIVE.pools.filter((p) => !p.health.rated).length).toBeGreaterThan(LIVE.pools.length / 3)
    expect(twinGroups.length).toBeGreaterThanOrEqual(3)
    expect(LIVE.pools.some((p) => p.ownerTop1Share === null)).toBe(true)
    expect(SHAPES.cheapest.price).toBeLessThan(1e-6)
    expect(SHAPES.dearest.price).toBeGreaterThan(1e6)
    expect(LIVE.pools.some((p) => p.depth2Usd !== null && p.depth2Usd < 1)).toBe(true)
    expect(LIVE.gaps.length).toBeGreaterThan(0)
    for (const { pool } of LIVE.pools) {
      expect(LIVE.poolDetails[pool.id]).toBeDefined()
      expect(LIVE.history[pool.id]).toBeDefined()
    }
  })
})

describe('the sweep', () => {
  it('flags what the number rules forbid and passes what they allow', () => {
    const bad = [
      'NaN',
      'undefined',
      'Infinity',
      '$0.00',
      '$10k',
      '$1.0K',
      '3.87e-6',
      '10.483274767849013 bps',
    ]
    expect(bad.map((text) => numberRuleBreaks(text).length > 0)).toEqual(bad.map(() => true))
    const good = ['$0.0008999', '<$0.01', '0.00000387', '52,950,000', '$31.5K', '1.6×']
    good.push('0x4200000000000000000000000000000000000006', '0x42d4…b76b')
    expect(good.flatMap(numberRuleBreaks)).toEqual([])
  })
})

describe('every route on live-shaped data', () => {
  it.each(ROUTES)('%s keeps the number, link-name and unknown-value rules', async (route) => {
    await boot(route)
    const heading = await screen.findByRole('heading', { level: 1 })
    const busy = () => document.querySelector('main .skel, main [aria-busy="true"]')
    await waitFor(() => expect(busy()).toBeNull())
    expect(heading.textContent).not.toMatch(/not found/)
    const main = document.querySelector('main')
    if (!main) throw new Error(`${route} has no main`)
    // Every section drew its data: no "Unable to load …" and no route-level failure.
    expect(main.querySelector('[role="alert"]')).toBeNull()
    expect(numberRuleBreaks(spoken(main))).toEqual([])
    expect(duplicateLinkNames(main)).toEqual([])
    expect(focusableDashes(main)).toEqual([])
  })
})
