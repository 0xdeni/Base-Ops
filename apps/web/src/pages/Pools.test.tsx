/**
 * Pools explorer (ia-v3 §4.2, docs/design/visual-v3.md §6.2) against the in-repo mock: the
 * filter-aware answer, the ranked table and its sorts, the URL state (`q`, `sort`, `dir`, `dex`,
 * `cols`, `page`, replaced not pushed), Columns, Compare DEXes, the phone rows and sheets, paging,
 * and the empty and error states.
 */

import { healthGrade } from '@depthwatch/core'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { ApiClient, PoolSummary } from '../api/types.js'
import { bps, NB, score, share, usd } from '../lib/format.js'
import { poolsAnswer } from './lists/poolsText.js'
import { NOW, renderPage, stubPhone, unstubPhone } from './lists/testing.js'
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
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pools')
    await table()
    expect(screen.getByText('15 rated pools').getAttribute('aria-live')).toBe('polite')
  })

  it('words the answer per DEX and announces the filtered count', async () => {
    const h = renderAt('/pools')
    await table()
    fireEvent.click(screen.getByRole('radio', { name: 'Uniswap v3' }))
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
    expect(screen.getByRole('radio', { name: 'Aerodrome v2' }).getAttribute('aria-checked')).toBe(
      'true',
    )
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

describe('Pools: phone (TB7, PH4)', () => {
  it('shows the pool, the sort metric and the grade per row', async () => {
    stubPhone()
    renderAt('/pools')
    const list = await screen.findByRole('list', { name: 'Pools' })
    expect(screen.queryByRole('table', { name: 'Pools' })).toBeNull()
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(15)
    expect(items[0]?.querySelector('.metric')?.textContent).toBe('95')
    expect(screen.getByRole('button', { name: 'All DEXes' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'DEX' })).toBeNull()
  })

  it('sorts from the Sort sheet, which is also the column picker', async () => {
    stubPhone()
    const h = renderAt('/pools')
    await screen.findByRole('list', { name: 'Pools' })
    fireEvent.click(screen.getByRole('button', { name: 'Sort: health' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sort pools' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Top LP share' }))
    await waitFor(() => expect(last(h)).toBe('/pools?sort=top'))
    const all: PoolSummary[] = (await h.client.pools({ limit: 200 })).items
    const top = Math.max(...all.map((p) => p.ownerTop1Share ?? 0))
    const list = screen.getByRole('list', { name: 'Pools' })
    await waitFor(() =>
      expect(within(list).getAllByRole('listitem')[0]?.querySelector('.metric')?.textContent).toBe(
        share(top),
      ),
    )
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Lowest first' }))
    await waitFor(() => expect(last(h)).toBe('/pools?sort=top&dir=asc'))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sort pools' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Sort: top LP' })).toBeTruthy()
  })

  it('filters by DEX from the Filter sheet and closes it', async () => {
    stubPhone()
    const h = renderAt('/pools')
    await screen.findByRole('list', { name: 'Pools' })
    fireEvent.click(screen.getByRole('button', { name: 'All DEXes' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filter pools' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Aerodrome Slipstream' }))
    await waitFor(() => expect(last(h)).toBe('/pools?dex=aerodrome-slipstream'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Slipstream' })).toBeTruthy()
  })
})

describe('Pools: rated and unrated pools', () => {
  const chips = (root: HTMLElement) => within(root).queryAllByRole('button', { name: 'Not rated' })

  it('lists the rated pools and keeps the unrated ones behind one row', async () => {
    const h = renderAt('/pools')
    const t = await table()
    expect(bodyRows(t)).toHaveLength(15)
    expect(chips(t)).toHaveLength(0)
    expect(within(t).getAllByRole('img', { name: /^Grade [ABCDF]$/ })).toHaveLength(15)
    const show = await screen.findByRole('button', { name: 'Show 3 unrated pools' })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    expect(last(h)).toBe('/pools')
    show.focus()
    fireEvent.click(show)
    await waitFor(() => expect(last(h)).toBe('/pools?unrated=1'))
    await waitFor(() => expect(chips(t)).toHaveLength(3))
    // the rated pools, one heading row, the unrated pools
    const rows = bodyRows(t)
    expect(rows).toHaveLength(15 + 1 + 3)
    expect(rows[15]?.textContent).toBe('Unrated pools')
    // the same button, still focused: it says it is open and what it does next
    expect(show.isConnected).toBe(true)
    expect(document.activeElement).toBe(show)
    expect(show.getAttribute('aria-expanded')).toBe('true')
    expect(show.textContent).toBe('Hide unrated pools')
    expect(screen.queryByRole('button', { name: /Show \d+ unrated pools/ })).toBeNull()
    // the live caption keeps counting the rated pools and says the unrated ones were added
    const caption = screen.getByText('15 rated pools, plus 3 unrated')
    expect(caption.getAttribute('aria-live')).toBe('polite')
    // a chip says why, in plain words, on focus
    const reasons: string[] = []
    for (const chip of chips(t)) {
      fireEvent.focus(chip)
      reasons.push((await screen.findByRole('tooltip')).textContent ?? '')
      fireEvent.blur(chip)
    }
    expect(reasons.map((r) => r.split(':')[0]).sort()).toEqual([
      'No USD price',
      'Too thin on one side',
      'Too thin to rate',
    ])
    expect(reasons.find((r) => r.startsWith('Too thin to rate'))).toContain(`$5K within 2${NB}%`)
  })

  it('puts the unrated pools after the rated ones in both directions of the health sort', async () => {
    for (const dir of ['desc', 'asc']) {
      renderAt(`/pools?unrated=1&sort=health&dir=${dir}`)
      const t = await table()
      await waitFor(() => expect(chips(t)).toHaveLength(3))
      const rows = bodyRows(t)
      const flags = rows
        .filter((r) => !r.classList.contains('group-row'))
        .map((r) => chips(r).length)
      expect(flags.slice(0, 15).every((n) => n === 0)).toBe(true)
      expect(flags.slice(15)).toEqual([1, 1, 1])
      cleanup()
    }
  })

  it('hides them again, and "Rated only" leaves the row out', async () => {
    const h = renderAt('/pools?unrated=1')
    const t = await table()
    await waitFor(() => expect(chips(t)).toHaveLength(3))
    const hide = screen.getByRole('button', { name: 'Hide unrated pools' })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    hide.focus()
    fireEvent.click(hide)
    await waitFor(() => expect(last(h)).toBe('/pools'))
    await waitFor(() => expect(chips(t)).toHaveLength(0))
    // the same button, still focused, closed again; the caption drops the unrated count
    expect(screen.getByRole('button', { name: 'Show 3 unrated pools' })).toBe(hide)
    expect(document.activeElement).toBe(hide)
    expect(hide.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('15 rated pools').getAttribute('aria-live')).toBe('polite')
    fireEvent.click(screen.getByRole('radio', { name: 'Rated only' }))
    await waitFor(() => expect(last(h)).toBe('/pools?rated=1'))
    await waitFor(() => expect(screen.queryByRole('button', { name: /unrated pools/ })).toBeNull())
    expect(bodyRows(await table())).toHaveLength(15)
    expect(screen.getByRole('radio', { name: 'Rated only' }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'All pools' }))
    await waitFor(() => expect(last(h)).toBe('/pools'))
    await screen.findByRole('button', { name: 'Show 3 unrated pools' })
  })

  it('pages the unrated pools beside the toggle, which keeps focus, and counts them in the caption', async () => {
    const mock = createMockClient({ now: NOW })
    const seen = (await mock.pools({ rated: false, limit: 3 })).items
    // 120 unrated pools: three real rows repeated under distinct ids
    const all = Array.from({ length: 120 }, (_, i) => {
      const base = seen[i % seen.length] as PoolSummary
      return { ...base, pool: { ...base.pool, id: `${base.pool.id}-${i}` } }
    })
    const many: ApiClient = {
      ...mock,
      pools: async (query = {}) => {
        if (query.rated !== false) return mock.pools(query)
        const from = query.offset ?? 0
        return { items: all.slice(from, from + (query.limit ?? 50)), total: all.length }
      },
    }
    const h = renderAt('/pools', many)
    await table()
    const toggle = await screen.findByRole('button', { name: 'Show 120 unrated pools' })
    toggle.focus()
    fireEvent.click(toggle)
    await waitFor(() => expect(last(h)).toBe('/pools?unrated=1'))
    await screen.findByText('15 rated pools, plus 50 of 120 unrated')
    // "Show 50 more" sits beside the toggle, which is the same button and still has focus
    const more = await screen.findByRole('button', { name: 'Show 50 more unrated pools' })
    expect(document.activeElement).toBe(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(more)
    await waitFor(() => expect(last(h)).toBe('/pools?unrated=2'))
    await screen.findByText('15 rated pools, plus 100 of 120 unrated')
    fireEvent.click(await screen.findByRole('button', { name: 'Show 20 more unrated pools' }))
    await screen.findByText('15 rated pools, plus 120 unrated')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /more unrated pools/ })).toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Hide unrated pools' })).toBe(toggle)
    // hiding takes all of them out at once
    fireEvent.click(toggle)
    await waitFor(() => expect(last(h)).toBe('/pools'))
    await screen.findByText('15 rated pools')
    expect(toggle.textContent).toBe('Show 120 unrated pools')
  })

  it('counts the unrated pools that match the filters', async () => {
    renderAt('/pools?dex=uniswap-v3')
    await table()
    // two of the three are on Uniswap v3: BRETT / DEGEN and WETH / TOSHI
    await screen.findByRole('button', { name: 'Show 2 unrated pools' })
    cleanup()
    renderAt('/pools?q=toshi')
    await screen.findByRole('button', { name: 'Show 1 unrated pool' })
    // the only match has no grade: no rated pool matches, which is not "no pools match"
    expect(screen.getByText('No rated pools match “toshi”.')).toBeTruthy()
  })

  it('says so when no pool is rated yet and still offers the unrated ones', async () => {
    const mock = createMockClient({ now: NOW })
    const stats = await mock.stats()
    const unratedOnly: ApiClient = {
      ...mock,
      stats: async () => ({
        ...stats,
        totals: { ...stats.totals, rated: 0, medianHealth: null },
      }),
      pools: async (query = {}) =>
        query.rated === true ? { items: [], total: 0 } : mock.pools({ ...query, rated: false }),
    }
    renderAt('/pools', unratedOnly)
    await screen.findByText('No pool is deep enough to rate yet.')
    fireEvent.click(await screen.findByRole('button', { name: 'Show 3 unrated pools' }))
    const t = await table()
    await waitFor(() => expect(chips(t)).toHaveLength(3))
  })

  it('shows the Not rated chip in the phone rows and a Rating choice in the filter sheet', async () => {
    stubPhone()
    const h = renderAt('/pools?unrated=1')
    const list = await screen.findByRole('list', { name: 'Pools' })
    await waitFor(() => expect(chips(list)).toHaveLength(3))
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(15 + 1 + 3)
    expect(items[15]?.textContent).toBe('Unrated pools')
    // a pool with no grade has no score to show: the sort value is "—" and the chip says why
    expect(items[16]?.querySelector('.metric')?.textContent).toBe('—')
    fireEvent.click(screen.getByRole('button', { name: 'All DEXes' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filter pools' })
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Rated only' }))
    await waitFor(() => expect(last(h)).toBe('/pools?rated=1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(chips(list)).toHaveLength(0))
  })
})

describe('Pools: paging and failures', () => {
  function manyPools(n: number): ApiClient {
    const mock = createMockClient({ now: NOW })
    return {
      ...mock,
      async pools(query = {}) {
        const seed = (await mock.pools({ limit: 1 })).items[0] as PoolSummary
        const all = Array.from({ length: n }, (_, i) => ({
          ...seed,
          pool: { ...seed.pool, id: `uniswap-v3:0x${i.toString(16).padStart(40, '0')}` },
        }))
        // These are all rated pools: none is left for `rated=false`.
        if (query.rated === false) return { items: [], total: 0 }
        const offset = query.offset ?? 0
        return { items: all.slice(offset, offset + (query.limit ?? 50)), total: n }
      },
    }
  }

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
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByLabelText('Search pools')).toBeTruthy()
    await screen.findByRole('button', { name: 'Compare DEXes' })
  })
})
