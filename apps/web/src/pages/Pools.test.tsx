/**
 * Pools explorer (ia-v3 §4.2, docs/design/visual-v4.md §6.3) against the in-repo mock: the band
 * (title, filter-aware answer, DEX filter with each DEX's share, the square field and its filter
 * link), the ranked table sheet and its sorts, the URL state (`q`, `sort`, `dir`, `dex`, `cols`,
 * `page`, `rows`, replaced not pushed), Columns, Compare DEXes, the phone rows, sheets and paging,
 * and the empty and error states.
 */

import { healthGrade } from '@depthwatch/core'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { bps, NB, score, usd } from '../lib/format.js'
import { poolsAnswer } from './lists/poolsText.js'
import { manyPools, NOW, renderPage, unstubPhone } from './lists/testing.js'
import { Pools } from './Pools.js'

/** Longer than the search debounce (250 ms): long enough for any stale write-back to land. */
const SETTLE_MS = 400

afterEach(() => {
  cleanup()
  unstubPhone()
})

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/pools', <Pools />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const searchBox = () => screen.getByLabelText('Search pools') as HTMLInputElement
const table = () => screen.findByRole('table', { name: 'Pools' })
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1)
const answerText = () => document.getElementById('pools-answer')?.textContent
/** A cell's text exactly, no-break spaces included (the default matcher folds them). */
const cellText = (row: HTMLElement, text: string) =>
  [...row.querySelectorAll('td')].some((td) => td.textContent === text)

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
  })
}

describe('Pools: answer and caption', () => {
  it('states the scored pools, DEXes and depth from /api/stats', async () => {
    const h = renderAt('/pools')
    const stats = await h.client.stats()
    await waitFor(() => expect(answerText()).toBe(poolsAnswer(stats, '')))
    expect(answerText()).toBe(
      `18 pools on 4 DEXes hold ${usd(stats.totals.depth2Usd)} within 2${NB}% of the price.`,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('pools')
    await table()
    expect(screen.getByText('15 rated pools').getAttribute('aria-live')).toBe('polite')
  })

  it('words the answer per DEX and announces the filtered count', async () => {
    const h = renderAt('/pools')
    await table()
    fireEvent.click(await screen.findByRole('radio', { name: /^Uniswap v3,/ }))
    await waitFor(() => expect(last(h)).toBe('/pools?dex=uniswap-v3'))
    const stats = await h.client.stats()
    const v3 = stats.byDex.find((d) => d.dex === 'uniswap-v3')
    await waitFor(() =>
      expect(answerText()).toBe(
        `Uniswap v3: ${v3?.scored} pools, ${usd(v3?.depth2Usd)} within 2${NB}% of the price, median health ${score(v3?.medianHealth)} (${healthGrade(v3?.medianHealth ?? 0)}) across ${v3?.rated} rated.`,
      ),
    )
    await screen.findByText(`Showing ${v3?.rated} of ${stats.totals.rated} rated`)
    await waitFor(async () => expect(bodyRows(await table())).toHaveLength(v3?.rated ?? 0))
  })

  it('reads v2 links: sort, direction and DEX from the URL', async () => {
    renderAt('/pools?sort=volume&dir=asc&dex=aerodrome-v2')
    const t = await table()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(3))
    const header = within(t).getByRole('columnheader', { name: `24${NB}h volume` })
    expect(header.getAttribute('aria-sort')).toBe('ascending')
    const v2 = await screen.findByRole('radio', { name: /^Aerodrome v2,/ })
    expect(v2.getAttribute('aria-checked')).toBe('true')
  })
})

describe('Pools: the table (TB2–TB4)', () => {
  it('shows the five default columns, health sorted descending', async () => {
    renderAt('/pools')
    const t = await table()
    const headers = within(t).getAllByRole('columnheader')
    expect(headers.map((th) => th.textContent)).toEqual([
      'Pool',
      'Health',
      `Depth ±2${NB}%`,
      'Spread at $10K',
      `24${NB}h volume`,
    ])
    expect(headers[1]?.getAttribute('aria-sort')).toBe('descending')
    const first = bodyRows(t)[0] as HTMLElement
    const link = within(first).getAllByRole('link')
    expect(link).toHaveLength(1)
    expect(link[0]?.getAttribute('href')).toMatch(/^\/pools\/uniswap-v3%3A/)
    expect(within(first).getByRole('img', { name: 'Grade A' })).toBeTruthy()
  })

  it('sorts by a header click, flips on a second click and writes the URL', async () => {
    const h = renderAt('/pools')
    const t = await table()
    fireEvent.click(within(t).getByRole('button', { name: `Depth ±2${NB}%` }))
    await waitFor(() => expect(last(h)).toBe('/pools?sort=depth'))
    const deepest = (await h.client.pools({ sort: 'depth', limit: 1 })).items[0]
    await waitFor(() =>
      expect(within(bodyRows(t)[0] as HTMLElement).getByText(usd(deepest?.depth2Usd))).toBeTruthy(),
    )
    fireEvent.click(within(t).getByRole('button', { name: `Depth ±2${NB}%` }))
    await waitFor(() => expect(last(h)).toBe('/pools?sort=depth&dir=asc'))
  })

  it('sorts spread on the page, lowest first by default, nulls last', async () => {
    const h = renderAt('/pools')
    const t = await table()
    fireEvent.click(within(t).getByRole('button', { name: 'Spread at $10K' }))
    await waitFor(() => expect(last(h)).toBe('/pools?sort=spread'))
    const all = (await h.client.pools({ limit: 200 })).items
    const lowest = Math.min(...all.map((p) => p.spread10kBps ?? Number.POSITIVE_INFINITY))
    await waitFor(() => expect(cellText(bodyRows(t)[0] as HTMLElement, bps(lowest))).toBe(true))
    const header = within(t).getByRole('columnheader', { name: 'Spread at $10K' })
    expect(header.getAttribute('aria-sort')).toBe('ascending')
  })

  it('adds optional columns from the Columns popover (cols in the URL)', async () => {
    const h = renderAt('/pools')
    const t = await table()
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
    const pop = await screen.findByRole('dialog', { name: 'Columns' })
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'Top LP share' }))
    await waitFor(() => expect(last(h)).toBe('/pools?cols=top'))
    fireEvent.click(within(pop).getByRole('checkbox', { name: 'TVL' }))
    await waitFor(() => expect(last(h)).toBe('/pools?cols=tvl%2Ctop'))
    await waitFor(() => expect(within(t).getAllByRole('columnheader')).toHaveLength(7))
    // A pool kind without indexed owners shows "—" with its reason (D6).
    const dash = within(t).getAllByRole('button', { name: '—' })[0] as HTMLElement
    fireEvent.focus(dash)
    expect((await screen.findByRole('tooltip')).textContent).toContain('Owners are not indexed')
  })

  it('prices each pool from its base token in the Price column (N2, DV8)', async () => {
    renderAt('/pools?cols=price&q=cbbtc')
    const t = await table()
    await waitFor(() => expect(bodyRows(t)).toHaveLength(2))
    // USDC / cbBTC is stored as 0.00001015 cbBTC per USDC: the column reads cbBTC in USDC.
    const row = bodyRows(t).find((r) => r.textContent?.includes('Uniswap v3')) as HTMLElement
    const cell = row.querySelector('td:last-child [title]')
    expect(cell?.textContent).toBe(`98,522.17${NB}USDC`)
    expect(cell?.getAttribute('title')).toBe(`1${NB}cbBTC = 98,522.17${NB}USDC`)
    for (const r of bodyRows(t)) expect(r.textContent).not.toMatch(/0\.0000/)
  })

  it('keeps every byDex field behind Compare DEXes', async () => {
    const h = renderAt('/pools')
    await table()
    const trigger = screen.getByRole('button', { name: 'Compare DEXes' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    const dexes = await screen.findByRole('table', { name: 'Pools, depth and health per DEX' })
    const stats = await h.client.stats()
    const rows = within(dexes).getAllByRole('row')
    expect(rows).toHaveLength(stats.byDex.length + 2)
    const total = rows.at(-1) as HTMLElement
    expect(total.textContent).toContain('All DEXes')
    expect(total.textContent).toContain(String(stats.totals.pools.toLocaleString('en-US')))
    expect(total.textContent).toContain(usd(stats.totals.volume24hUsd))
  })
})

describe('Pools: search ↔ URL', () => {
  it('writes the typed query to the URL after the debounce, replacing the entry', async () => {
    const h = renderAt('/pools')
    await table()
    fireEvent.change(searchBox(), { target: { value: 'weth' } })
    await waitFor(() => expect(last(h)).toBe('/pools?q=weth'))
    expect(searchBox().getAttribute('placeholder')).toBe('Search by symbol or address')
    act(() => h.navigate?.(-1))
    await settle()
    // Replaced, not pushed: there is no earlier entry to go back to.
    expect(last(h)).toBe('/pools?q=weth')
  })

  it('lets the nav link clear the search instead of re-applying it', async () => {
    const h = renderAt('/pools')
    await table()
    fireEvent.change(searchBox(), { target: { value: 'weth' } })
    await waitFor(() => expect(last(h)).toBe('/pools?q=weth'))
    fireEvent.click(screen.getByRole('link', { name: 'Nav link' }))
    await waitFor(() => expect(last(h)).toBe('/pools'))
    await settle()
    expect(last(h)).toBe('/pools')
    expect(searchBox().value).toBe('')
  })

  it('seeds the input from the URL and follows the URL when it changes underneath', async () => {
    const h = renderAt('/pools?q=usdc')
    await table()
    expect(searchBox().value).toBe('usdc')
    act(() => h.navigate?.('/pools?q=aero'))
    await waitFor(() => expect(searchBox().value).toBe('aero'))
    await settle()
    expect(last(h)).toBe('/pools?q=aero')
  })

  it('says what is empty and clears the search (ST2)', async () => {
    const h = renderAt('/pools?q=zzz')
    await screen.findByText('No pools match “zzz”.')
    await screen.findByText('Showing 0 of 15 rated')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(last(h)).toBe('/pools'))
    await table()
    expect(searchBox().value).toBe('')
  })
})

describe('Pools: paging and failures', () => {
  it('shows pages of 50 and puts the page in the URL', async () => {
    const h = renderAt('/pools', manyPools(120))
    const t = await table()
    expect(bodyRows(t)).toHaveLength(50)
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 more pools' }))
    await waitFor(() => expect(last(h)).toBe('/pools?page=2'))
    await waitFor(() => expect(bodyRows(t)).toHaveLength(100))
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more pools' }))
    await waitFor(() => expect(bodyRows(t)).toHaveLength(120))
    expect(screen.queryByRole('button', { name: /more pools/ })).toBeNull()
  })

  it('keeps the page usable when pools fail to load (ST3)', async () => {
    const mock = createMockClient({ now: NOW })
    renderAt('/pools', { ...mock, pools: () => Promise.reject(new Error('down')) })
    await screen.findByText('Unable to load pools. Check that the API is running, then retry.')
    await screen.findByText(
      'Unable to load the square field. Check that the API is running, then retry.',
    )
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(2)
    expect(screen.getByLabelText('Search pools')).toBeTruthy()
    await screen.findByRole('button', { name: 'Compare DEXes' })
  })
})
