/**
 * Pools: the rated and unrated pools (ia-v3 §4.2, TB9, docs/design/visual-v4.md §6.3) against the
 * in-repo mock: the rated pools first, the unrated ones behind one toggle in the sheet's foot that
 * keeps focus, their pages, the live caption, the chips' reasons and "Rated only".
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient, PoolSummary } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import { Pools } from '../Pools.js'
import { NOW, renderPage, stubPhone, unstubPhone } from './testing.js'

afterEach(() => {
  cleanup()
  unstubPhone()
})

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/pools', <Pools />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const table = () => screen.findByRole('table', { name: 'Pools' })
const bodyRows = (t: HTMLElement) => within(t).getAllByRole('row').slice(1)

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
