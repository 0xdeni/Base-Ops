/**
 * Pools on a phone (docs/design/visual-v4.md §5.8, §5.10, §6.3, TB7, PH4) against the in-repo mock:
 * rows of the pool, the sort metric and the grade; the Filter and Sort sheets on the band; 25
 * rated rows, then "Show all 50 rated pools" (`rows=all`); the unrated toggle once every rated row
 * is on screen.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient, PoolSummary } from '../../api/types.js'
import { NB, share } from '../../lib/format.js'
import { Pools } from '../Pools.js'
import { manyPools, NOW, renderPage, stubPhone, unstubPhone } from './testing.js'

afterEach(() => {
  cleanup()
  unstubPhone()
})

const renderAt = (path: string, client?: ApiClient) => renderPage(path, '/pools', <Pools />, client)
const last = (h: { log: string[] }) => h.log.at(-1)
const rows = () => within(screen.getByRole('list', { name: 'Pools' })).getAllByRole('listitem')

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

  it('offers the top LP share only when some pool has it, after the sorts in the sheet’s order', async () => {
    stubPhone()
    const base = manyPools(30)
    const client: ApiClient = {
      ...base,
      pools: async (query = {}) => {
        const page = await base.pools(query)
        return { ...page, items: page.items.map((p) => ({ ...p, ownerTop1Share: null })) }
      },
    }
    renderAt('/pools', client)
    await screen.findByRole('list', { name: 'Pools' })
    fireEvent.click(screen.getByRole('button', { name: 'Sort: health' }))
    const sheet = await screen.findByRole('dialog', { name: 'Sort pools' })
    const names = within(within(sheet).getByRole('radiogroup', { name: 'Sort by' }))
      .getAllByRole('radio')
      .map((r) => r.textContent)
    expect(names).toEqual([
      'Health',
      `Depth ±2${NB}%`,
      'Spread at $10K',
      `24${NB}h volume`,
      'TVL',
      'Gap score',
    ])
  })

  it('heads the Filter sheet’s two groups, DEX and Rating', async () => {
    stubPhone()
    renderAt('/pools')
    await screen.findByRole('list', { name: 'Pools' })
    fireEvent.click(screen.getByRole('button', { name: 'All DEXes' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filter pools' })
    const heads = within(sheet).getAllByRole('heading', { level: 3 })
    expect(heads.map((h) => h.textContent)).toEqual(['DEX', 'Rating'])
    const rating = within(sheet).getByRole('radiogroup', { name: 'Rating' })
    expect(rating.getAttribute('aria-labelledby')).toBe(heads[1]?.id)
    expect(
      within(rating)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['All pools', 'Rated only'])
    expect(within(sheet).getByRole('radiogroup', { name: 'DEX' })).toBeTruthy()
  })

  it('filters by DEX from the Filter sheet and closes it', async () => {
    stubPhone()
    const h = renderAt('/pools')
    await screen.findByRole('list', { name: 'Pools' })
    fireEvent.click(screen.getByRole('button', { name: 'All DEXes' }))
    const sheet = await screen.findByRole('dialog', { name: 'Filter pools' })
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Aerodrome Slipstream,/ }))
    await waitFor(() => expect(last(h)).toBe('/pools?dex=aerodrome-slipstream'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Slipstream' })).toBeTruthy()
  })
})

describe('Pools: phone pages (§5.8)', () => {
  it('shows 25 rated rows, then every loaded one behind "Show all", in the URL', async () => {
    stubPhone()
    const h = renderAt('/pools', manyPools(40))
    await screen.findByRole('list', { name: 'Pools' })
    expect(rows()).toHaveLength(25)
    // the caption still counts every rated pool
    expect(screen.getByText('40 rated pools')).toBeTruthy()
    const all = screen.getByRole('button', { name: 'Show all 40 rated pools' })
    fireEvent.click(all)
    await waitFor(() => expect(last(h)).toBe('/pools?rows=all'))
    await waitFor(() => expect(rows()).toHaveLength(40))
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('reveals the loaded page first, then pages of 50, when more are rated than one page holds', async () => {
    stubPhone()
    const h = renderAt('/pools', manyPools(70))
    await screen.findByRole('list', { name: 'Pools' })
    expect(rows()).toHaveLength(25)
    fireEvent.click(screen.getByRole('button', { name: 'Show 25 more pools' }))
    await waitFor(() => expect(last(h)).toBe('/pools?rows=all'))
    await waitFor(() => expect(rows()).toHaveLength(50))
    fireEvent.click(screen.getByRole('button', { name: 'Show 20 more pools' }))
    await waitFor(() => expect(last(h)).toBe('/pools?rows=all&page=2'))
    await waitFor(() => expect(rows()).toHaveLength(70))
  })

  it('opens on every rated row from a shared rows=all link, and shows no button for 25 or fewer', async () => {
    stubPhone()
    renderAt('/pools?rows=all', manyPools(40))
    await screen.findByRole('list', { name: 'Pools' })
    await waitFor(() => expect(rows()).toHaveLength(40))
    cleanup()
    renderAt('/pools')
    await screen.findByRole('list', { name: 'Pools' })
    expect(rows()).toHaveLength(15)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('keeps the unrated pools after the last rated row when a link opens them', async () => {
    stubPhone()
    const base = manyPools(30)
    const mock = createMockClient({ now: NOW })
    const client: ApiClient = {
      ...base,
      pools: (query = {}) => (query.rated === false ? mock.pools(query) : base.pools(query)),
    }
    renderAt('/pools?unrated=1', client)
    await screen.findByRole('list', { name: 'Pools' })
    await waitFor(() => expect(rows()).toHaveLength(30 + 1 + 3))
    expect(rows()[30]?.textContent).toBe('Unrated pools')
  })
})
