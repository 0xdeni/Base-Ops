/**
 * The Pools band (docs/design/visual-v4.md §6.3, §5.4, §5.9.2) against the in-repo mock: the
 * eyebrow, the lowercase title and the answer; the DEX filter with each DEX's share of the depth;
 * the square field drawn from every scored pool, its squares dimmed outside the table's filter; and
 * the URL state of the phone pages (`rows`).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient, PoolSummary } from '../../api/types.js'
import { dexShareLabel, dexShares } from '../../components/ui/DexFilter.js'
import { NB } from '../../lib/format.js'
import { Pools } from '../Pools.js'
import { tableFilter } from './PoolsField.js'
import {
  PHONE_PAGE,
  readPoolsState,
  showAllRowsLabel,
  visibleRows,
  writePoolsState,
} from './poolsState.js'
import { NOW, renderPage, unstubPhone } from './testing.js'

afterEach(() => {
  cleanup()
  unstubPhone()
})

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/pools', <Pools />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const squares = () => [...document.querySelectorAll<HTMLAnchorElement>('.field a.sq')]
const idOf = (a: HTMLAnchorElement) =>
  decodeURIComponent(a.getAttribute('href')?.replace('/pools/', '') ?? '')
const allPools = async (client: ApiClient): Promise<PoolSummary[]> =>
  (await client.pools({ sort: 'depth', dir: 'desc', limit: 200 })).items

describe('Pools band: title, answer and DEX filter', () => {
  it('opens on the band with the eyebrow, the title "pools" and the answer', async () => {
    renderAt('/pools')
    const band = await screen.findByRole('region', { name: 'pools' })
    expect(band.classList.contains('band')).toBe(true)
    expect(within(band).getByRole('heading', { level: 1 }).textContent).toBe('pools')
    expect(band.querySelector('.eyebrow')?.textContent).toBe('PoolsUniswap and Aerodrome')
    await waitFor(() => expect(band.querySelector('#pools-answer')).toBeTruthy())
    // The table sheet stacks over the band's lower edge, plane 2.
    const sheet = document.querySelector('.lists-sheet')
    expect(sheet?.closest('.overlap')).toBeTruthy()
    expect(sheet?.hasAttribute('data-over')).toBe(true)
  })

  it('lists every DEX with its share of the depth, All DEXes first, and selects with arrow keys', async () => {
    const h = renderAt('/pools')
    const stats = await h.client.stats()
    const group = await screen.findByRole('radiogroup', { name: 'DEX' })
    const radios = within(group).getAllByRole('radio')
    const expected = dexShares(stats.byDex, stats.totals.depth2Usd).map(dexShareLabel)
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(expected)
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true')
    expect(expected[0]).toBe(`All DEXes, 100${NB}% of the depth within 2${NB}%`)
    fireEvent.keyDown(radios[0] as HTMLElement, { key: 'ArrowDown' })
    const deepest = dexShares(stats.byDex, stats.totals.depth2Usd)[1]?.dex
    await waitFor(() => expect(last(h)).toBe(`/pools?dex=${deepest}`))
    expect(document.activeElement).toBe(within(group).getAllByRole('radio')[1])
  })
})

describe('Pools band: the square field', () => {
  it('draws the scored pools with depth as squares and opens a pool from its square', async () => {
    const h = renderAt('/pools')
    const field = await screen.findByRole('group', { name: /^Where Base’s depth sits/ })
    const pools = await allPools(h.client)
    const withDepth = pools.filter((p) => (p.depth2Usd ?? 0) > 0)
    await waitFor(() => expect(squares().length).toBeGreaterThan(0))
    const merged = document.querySelectorAll('.field .sq.merged').length
    const drawn = new Set(squares().map(idOf))
    // Every pool with depth is a square of its own or one of the merged smallest.
    expect(drawn.size + (merged ? withDepth.length - drawn.size : 0)).toBe(withDepth.length)
    for (const id of drawn) expect(withDepth.some((p) => p.pool.id === id)).toBe(true)
    expect(field.getAttribute('tabindex')).toBe('0')
    const zero = pools.length - withDepth.length
    const caption = document.querySelector('.field-cap')?.textContent ?? ''
    if (zero > 0) expect(caption).toContain(`The ${zero} `)
    expect(caption).toContain('Solid: rated A to F. Outlined: not rated.')
  })

  it('dims the squares outside the table’s filter, so the field and the table agree', async () => {
    const h = renderAt('/pools')
    await waitFor(() => expect(squares().length).toBeGreaterThan(0))
    expect(document.querySelectorAll('.field .sq.dim')).toHaveLength(0)
    fireEvent.click(await screen.findByRole('radio', { name: /^Uniswap v3,/ }))
    await waitFor(() => expect(last(h)).toBe('/pools?dex=uniswap-v3'))
    const pools = await allPools(h.client)
    const dexOf = new Map(pools.map((p) => [p.pool.id, p.pool.dex]))
    await waitFor(() => {
      for (const a of squares())
        expect(a.classList.contains('dim'), idOf(a)).toBe(dexOf.get(idOf(a)) !== 'uniswap-v3')
    })
    fireEvent.click(screen.getByRole('radio', { name: /^All DEXes/ }))
    await waitFor(() => expect(document.querySelectorAll('.field .sq.dim')).toHaveLength(0))
  })

  it('reads a square with the arrow keys and clears it with Escape', async () => {
    renderAt('/pools')
    const field = await screen.findByRole('group', { name: /^Where Base’s depth sits/ })
    await waitFor(() => expect(squares().length).toBeGreaterThan(0))
    const lens = document.querySelector('.lens') as HTMLElement
    expect(lens.textContent).toBe('Point at, focus or tap a square to read its pool.')
    act(() => {
      fireEvent.keyDown(field, { key: 'ArrowRight' })
    })
    expect(lens.textContent).toMatch(/within 2.%: .* sell, .* buy/)
    act(() => {
      fireEvent.keyDown(field, { key: 'Escape' })
    })
    expect(lens.textContent).toBe('Point at, focus or tap a square to read its pool.')
  })
})

describe('tableFilter', () => {
  it('is null with no filter, and matches the DEX, the search and the rating together', async () => {
    const pools = await allPools(createMockClient({ now: NOW }))
    expect(tableFilter({ dex: '', q: ' ', ratedOnly: false })).toBeNull()
    const v3 = tableFilter({ dex: 'uniswap-v3', q: '', ratedOnly: false })
    expect(pools.filter((p) => v3?.(p)).every((p) => p.pool.dex === 'uniswap-v3')).toBe(true)
    const weth = tableFilter({ dex: '', q: 'WETH', ratedOnly: true })
    const hits = pools.filter((p) => weth?.(p))
    expect(hits.length).toBeGreaterThan(0)
    for (const p of hits) {
      expect(p.health.rated).toBe(true)
      expect(`${p.pool.token0.symbol}/${p.pool.token1.symbol}`).toMatch(/WETH/)
    }
  })
})

describe('phone pages in the URL (rows)', () => {
  it('reads and writes rows=all, and keeps it through a new order', () => {
    expect(readPoolsState(new URLSearchParams('rows=all')).allRows).toBe(true)
    expect(readPoolsState(new URLSearchParams('rows=some')).allRows).toBe(false)
    const on = writePoolsState(new URLSearchParams(), { allRows: true })
    expect(on.toString()).toBe('rows=all')
    expect(writePoolsState(on, { sort: 'depth' }).toString()).toBe('rows=all&sort=depth')
    expect(writePoolsState(on, { allRows: false }).toString()).toBe('')
  })

  it('shows 25 rows on a phone until every row is asked for or the unrated pools are open', () => {
    const rows = Array.from({ length: 50 }, (_, i) => i)
    const phone = { phone: true, allRows: false, unratedOpen: false }
    expect(visibleRows(rows, phone)).toHaveLength(PHONE_PAGE)
    expect(visibleRows(rows, { ...phone, allRows: true })).toHaveLength(50)
    expect(visibleRows(rows, { ...phone, unratedOpen: true })).toHaveLength(50)
    expect(visibleRows(rows, { ...phone, phone: false })).toHaveLength(50)
  })

  it('words the button by what it reveals', () => {
    expect(showAllRowsLabel(50, true)).toBe('Show all 50 rated pools')
    expect(showAllRowsLabel(50, false)).toBe('Show 25 more pools')
    expect(showAllRowsLabel(26, false)).toBe('Show 1 more pool')
  })
})
