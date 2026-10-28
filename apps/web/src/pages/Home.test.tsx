/**
 * Home (ia-v3 §4.1, docs/design/visual-v4.md §6.2) against the in-repo mock: the band with its
 * answer, lead and actions, the parts the first view plays, and the focal butterfly with its
 * total row, Show data and the paging behind it. The facts, previews and states are in
 * home/HomeBlocks.test.tsx.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../api/mock.js'
import type { PoolSummary, PoolsQuery } from '../api/types.js'
import { FIRST_VIEW_MS, firstViewSteps, isSettled } from '../lib/firstView.js'
import { NB, poolHref, usd } from '../lib/format.js'
import { homeAnswer, homeLead, isMeaningfulGap } from './home/copy.js'
import { findFacts, NOW, renderHome, withClient } from './home/testing.js'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

/** Each side of Base as stored (token0's), the same values every page shows. */
const storedSum = (pools: readonly PoolSummary[], side: 'sell' | 'buy') =>
  pools.reduce((s, p) => s + ((side === 'sell' ? p.depth2DownUsd : p.depth2UpUsd) ?? 0), 0)

const figure = () => screen.findByRole('group', { name: /^Base: / })

describe('Home: the band', () => {
  it('opens on the answer as one heading: the figure and its sentence', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    const h1 = await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(h1.textContent).toBe(homeAnswer(totals.depth2Usd)))
    expect(h1.querySelector('.mega')?.textContent).toBe(usd(totals.depth2Usd))
    expect(h1.querySelector('.say')?.textContent).toBe(`sits within 2${NB}% of the price on Base.`)
    const band = h1.closest('section')
    expect(band?.classList.contains('band')).toBe(true)
    expect(band?.getAttribute('aria-labelledby')).toBe(h1.id)
    expect(band?.parentElement?.parentElement?.tagName).toBe('MAIN')
    expect(band?.querySelector('.eyebrow')?.textContent).toBe(
      `Base mainnetDepth within ±2${NB}% of the price`,
    )
  })

  it('has the lead and the two actions in the band, one filled button', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    expect(await screen.findByText(homeLead(totals.scored, totals.rated))).toBeTruthy()
    const browse = screen.getByRole('link', { name: 'Browse pools' })
    expect(browse.getAttribute('href')).toBe('/pools')
    expect(browse.classList.contains('btn')).toBe(true)
    expect(browse.closest('.band')).not.toBeNull()
    expect(document.querySelectorAll('main .btn')).toHaveLength(1)
    const how = screen.getByRole('link', { name: 'How it’s measured' })
    expect(how.getAttribute('href')).toBe('/methodology')
    expect(how.className).toContain('ulink')
  })

  it('marks its parts for the first view, which ends by 450 ms and only fades when reduced', async () => {
    renderHome()
    await figure()
    await findFacts()
    const main = document.querySelector('main') as HTMLElement
    await waitFor(() => expect(isSettled(main)).toBe(true))
    expect([...main.querySelectorAll('[data-rise]')].map((el) => el.className)).toEqual([
      'mega num',
      'say',
    ])
    expect(main.querySelectorAll('.home-band [data-in]')).toHaveLength(2)
    expect(main.querySelectorAll('.home-facts [data-over]')).toHaveLength(3)
    expect(main.querySelectorAll('.home-facts [data-over] [data-bar]').length).toBeGreaterThan(2)
    const steps = firstViewSteps(main, false)
    expect(Math.max(...steps.map((s) => s.delay + s.duration))).toBeLessThanOrEqual(FIRST_VIEW_MS)
    expect(steps.some((s) => s.el.classList.contains('band-ground'))).toBe(true)
    const reduced = firstViewSteps(main, true)
    for (const s of reduced)
      for (const k of s.keyframes) expect(Object.keys(k)).toEqual(['opacity'])
  })

  it('stays busy while the totals load, so the first view waits for the content', async () => {
    renderHome(withClient({ stats: () => new Promise(() => {}) }))
    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1.getAttribute('aria-busy')).toBe('true')
    expect(isSettled(document.querySelector('main') as HTMLElement)).toBe(false)
    expect(screen.getByRole('link', { name: 'Browse pools' })).toBeTruthy()
  })
})

describe('Home: the focal butterfly (CH4)', () => {
  it('lists the 7 deepest pools plus the gap pool, with the Gap marker linking to /gaps', async () => {
    const client = renderHome()
    const fig = await figure()
    const pools = (await client.pools({ sort: 'depth', limit: 200 })).items
    const gapPool = (await client.gaps({ limit: 200 })).items.filter(isMeaningfulGap)[0]?.pool
    const deepest = pools[0]
    if (!gapPool || !deepest) throw new Error('mock has no gap')
    const links = [...fig.querySelectorAll('.bf-pools a.bf-link')].map((a) =>
      a.getAttribute('href'),
    )
    expect(links).toHaveLength(8)
    expect(links[0]).toBe(poolHref(deepest.pool.id))
    expect(links).toContain(poolHref(gapPool.pool.id))
    const gap = within(fig).getByRole('link', { name: /^Liquidity gap: / })
    expect(gap.getAttribute('href')).toBe('/gaps')
  })

  it('heads the figure with both sides of all of Base and the rest of the pools', async () => {
    const client = renderHome()
    const fig = await figure()
    const pools = (await client.pools({ sort: 'depth', limit: 200 })).items
    const totals = [...fig.querySelectorAll('.bf-tot')].map((el) => el.textContent)
    expect(totals).toEqual([usd(storedSum(pools, 'sell')), usd(storedSum(pools, 'buy'))])
    expect(within(fig).getByText('All of Base')).toBeTruthy()
    expect(fig.querySelector('.bf-foot')?.textContent).toContain(
      `The other ${pools.length - 7} pools.`,
    )
  })

  it('opens Show data: every row with both sides, its share and the total', async () => {
    renderHome()
    await figure()
    const show = screen.getByRole('button', { name: 'Show data' })
    fireEvent.click(show)
    expect(show.getAttribute('aria-expanded')).toBe('true')
    const table = screen.getByRole('table', { name: `Depth within 2${NB}% by pool` })
    const header = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(header).toEqual(['Pool', `Sell ±2${NB}%`, `Buy ±2${NB}%`, 'Share of Base'])
    const body = within(table).getAllByRole('row').slice(1)
    // 8 listed pools, the other 10 as one row, and the total.
    expect(body).toHaveLength(10)
    expect(body.at(-1)?.textContent).toContain('All of Base')
    expect(body.at(-2)?.textContent).toContain('Every other pool')
  })

  it('pages through /api/pools so the total sums all of them', async () => {
    const seed = (await createMockClient({ now: NOW }).pools({ limit: 200 })).items
    const many: PoolSummary[] = Array.from({ length: 450 }, (_, i) => {
      const p = seed[i % seed.length] as PoolSummary
      return { ...p, pool: { ...p.pool, id: `${p.pool.id}-${i}` } }
    }).sort((a, b) => (b.depth2Usd ?? 0) - (a.depth2Usd ?? 0))
    const offsets: number[] = []
    renderHome(
      withClient({
        pools: async (q: PoolsQuery = {}) => {
          const offset = q.offset ?? 0
          offsets.push(offset)
          return { items: many.slice(offset, offset + (q.limit ?? 50)), total: many.length }
        },
      }),
    )
    const fig = await figure()
    expect(offsets.sort((a, b) => a - b)).toEqual([0, 200, 400])
    const totals = [...fig.querySelectorAll('.bf-tot')].map((el) => el.textContent)
    expect(totals).toEqual([usd(storedSum(many, 'sell')), usd(storedSum(many, 'buy'))])
  })
})
