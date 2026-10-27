import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import type { ApiClient, PoolSummary, TokenDetail } from '../api/types.js'
import { NB, poolHref } from '../lib/format.js'
import { readTableState, writeTableState } from './token/tokenSort.js'
import { orientPools, tokenAnswer } from './token/tokenText.js'

const WETH = '0x4200000000000000000000000000000000000006'
const V3_WETH_USDC = 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224'
const V4_ETH_USDC = 'uniswap-v4:0x3f0e1c7b8d2a9f4e6b1c5d8a7e9f2b4c6d8e0f1a2b3c4d5e6f708192a3b4c5d6'
/** The synthetic native ETH ↔ WETH edge the pipeline adds to price routes (not a pool id). */
const WRAP_EDGE = 'wrap:weth'

afterEach(cleanup)

let search = ''
function LocationProbe() {
  search = useLocation().search
  return null
}

/** Renders the WETH token page; `via` replaces the mock's price route when given. */
function renderToken({ via, query = '' }: { via?: string[]; query?: string } = {}) {
  const base = createMockClient({ now: 1_760_000_000 })
  const client: ApiClient = {
    ...base,
    async token(address, q) {
      const detail = await base.token(address, q)
      return via ? { ...detail, via } : detail
    },
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[`/tokens/${WETH}${query}`]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  )
}

const loaded = () => screen.findByRole('heading', { level: 1, name: 'WETH' })
const facts = () => {
  const el = document.querySelector('.token-facts')
  if (!(el instanceof HTMLElement)) throw new Error('facts missing')
  return el
}
const routeRow = () => {
  const dt = [...document.querySelectorAll('.about dt')].find(
    (d) => d.textContent === 'Price route',
  )
  const dd = dt?.nextElementSibling
  if (!(dd instanceof HTMLElement)) throw new Error('price route missing')
  return dd
}

describe('Token page: the first view (ia-v3 §4.7)', () => {
  it('answers with the depth around the price across the scored pools', async () => {
    renderToken()
    await loaded()
    expect(document.querySelector('a.back')?.getAttribute('href')).toBe('/pools')
    expect(document.querySelector('.answer')?.textContent).toMatch(
      /^\$[\d.]+[KMB]? sits within 2\s% of the price (across WETH’s \d+ scored pools|in WETH’s one scored pool)\.$/,
    )
  })

  it('draws the butterfly of its pools, closed by "All of WETH", with the numbers behind Show data', async () => {
    renderToken()
    await loaded()
    const figure = screen.getByRole('group', { name: /^WETH: / })
    expect(within(figure).getByText('All of WETH')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }), { detail: 0 })
    const table = await screen.findByRole('table', { name: `Depth within 2${NB}% by pool` })
    expect(within(table).getByText('All of WETH')).toBeTruthy()
    expect(screen.getByText(/Sides are WETH’s/)).toBeTruthy()
  })

  it('states the USD price, the pools discovered and where the price comes from', async () => {
    renderToken({ via: [V3_WETH_USDC] })
    await loaded()
    const labels = [...facts().querySelectorAll('dt')].map((d) => d.textContent)
    expect(labels[0]).toBe('USD price')
    expect(labels[1]).toMatch(/^pools? discovered/)
    expect(labels[2]).toMatch(/^priced through this Uniswap v3 pool$/)
    const link = within(facts()).getByRole('link', { name: 'WETH / USDC' })
    expect(link.getAttribute('href')).toBe(poolHref(V3_WETH_USDC))
  })
})

describe('Token page: the price route', () => {
  it('links every pool of the route to its pool page, in order, joined by "then"', async () => {
    renderToken({ via: [V4_ETH_USDC, V3_WETH_USDC] })
    await loaded()
    const row = routeRow()
    const hrefs = within(row)
      .getAllByRole('link', { hidden: true })
      .map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([poolHref(V4_ETH_USDC), poolHref(V3_WETH_USDC)])
    expect(row.textContent).toContain('then')
    expect(row.textContent).not.toContain('→')
  })

  it('reads the ETH ↔ WETH wrap edge as words, never as a (dead) pool link', async () => {
    renderToken({ via: [V3_WETH_USDC, WRAP_EDGE] })
    await loaded()
    const row = routeRow()
    const hrefs = within(row)
      .getAllByRole('link', { hidden: true })
      .map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual([poolHref(V3_WETH_USDC)])
    expect(row.textContent).toContain('ETH to WETH')
    expect(facts().textContent).toContain('then ETH to WETH')
  })

  it('keeps the id of a pool it does not know, and an unknown source verbatim', async () => {
    const unknown = 'uniswap-v3:0x00000000000000000000000000000000000000aa'
    renderToken({ via: [unknown, 'oracle:chainlink'] })
    await loaded()
    const row = routeRow()
    expect(within(row).getByTitle(unknown).getAttribute('href')).toBe(poolHref(unknown))
    expect(row.textContent).toContain('oracle:chainlink')
  })

  it('says an anchor is not routed', async () => {
    renderToken({ via: [] })
    await loaded()
    expect(within(facts()).getByText('Anchor')).toBeTruthy()
    expect(routeRow().textContent).toMatch(/^Anchor/)
  })
})

describe('Token page: the pools table', () => {
  it('sorts by depth first, and keeps a header sort in the URL', async () => {
    renderToken()
    await loaded()
    const table = screen.getByRole('table', { name: 'Pools containing WETH' })
    const depth = within(table).getByRole('columnheader', { name: /^Depth ±2/ })
    expect(depth.getAttribute('aria-sort')).toBe('descending')
    act(() => {
      fireEvent.click(within(table).getByRole('button', { name: /^Health/ }))
    })
    expect(search).toBe('?sort=health')
    act(() => {
      fireEvent.click(within(table).getByRole('button', { name: /^Health/ }))
    })
    expect(search).toBe('?sort=health&dir=asc')
    expect(
      within(table)
        .getByRole('columnheader', { name: /^Health/ })
        .getAttribute('aria-sort'),
    ).toBe('ascending')
  })

  it('marks a pool with no grade "Not rated" and keeps it last when sorting by health', async () => {
    for (const query of ['?sort=health', '?sort=health&dir=asc']) {
      renderToken({ query })
      await loaded()
      const table = screen.getByRole('table', { name: 'Pools containing WETH' })
      // WETH / TOSHI: TOSHI has no USD price. The others keep their grade glyph.
      const chip = within(table).getByRole('button', { name: 'Not rated' })
      const rows = within(table).getAllByRole('row').slice(1)
      expect(rows.at(-1)?.contains(chip)).toBe(true)
      expect(within(rows.at(-1) as HTMLElement).queryByRole('img', { name: /^Grade/ })).toBeNull()
      expect(
        within(rows[0] as HTMLElement).getByRole('img', { name: /^Grade [A-F]$/ }),
      ).toBeTruthy()
      fireEvent.focus(chip)
      expect((await screen.findByRole('tooltip')).textContent).toContain('No USD price')
      cleanup()
    }
  })

  it('starts from the URL, and adds optional columns from the Columns menu', async () => {
    renderToken({ query: '?sort=volume' })
    await loaded()
    const table = screen.getByRole('table', { name: 'Pools containing WETH' })
    const vol = within(table).getByRole('columnheader', { name: `24${NB}h volume` })
    expect(vol.getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }), { detail: 0 })
    const dialog = await screen.findByRole('dialog', { name: 'Columns' })
    act(() => {
      fireEvent.click(within(dialog).getByRole('checkbox', { name: 'TVL' }))
    })
    expect(search).toBe('?sort=volume&cols=tvl')
    expect(within(table).getByRole('columnheader', { name: 'TVL' })).toBeTruthy()
  })
})

describe('Token page: states', () => {
  it('says the token was not found, with the address', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const missing = '0x00000000000000000000000000000000000000ab'
    render(
      <Providers client={createMockClient({ now: 1_760_000_000 })} mock queryClient={queryClient}>
        <MemoryRouter initialEntries={[`/tokens/${missing}`]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'Token not found' })).toBeTruthy()
    expect(screen.getByText(missing)).toBeTruthy()
  })
})

describe('token helpers', () => {
  const pool = (id: string, t0: string, t1: string, up: number, down: number) =>
    ({
      pool: { id, token0: { address: t0, symbol: 'A' }, token1: { address: t1, symbol: 'B' } },
      depth2Usd: up + down,
      depth2UpUsd: up,
      depth2DownUsd: down,
    }) as unknown as PoolSummary

  it('sees each pool from the token: where it is token1, the stored sides swap', () => {
    const [asToken0, asToken1] = orientPools(
      [pool('a', '0xaa', '0xbb', 6, 5), pool('b', '0xcc', '0xaa', 3, 2)],
      '0xAA',
    )
    expect([asToken0?.depth2DownUsd, asToken0?.depth2UpUsd]).toEqual([5, 6])
    expect([asToken1?.depth2DownUsd, asToken1?.depth2UpUsd]).toEqual([3, 2])
    expect(asToken1?.depth2Usd).toBe(5)
  })

  it('words the unpriced and the single-pool answers', () => {
    const detail = (over: Partial<TokenDetail>) =>
      ({
        token: { symbol: 'WETH' },
        usd: 2460,
        pools: [pool('a', '0xaa', '0xbb', 6_079_641, 5_102_004)],
        total: 1,
        ...over,
      }) as unknown as TokenDetail
    expect(tokenAnswer(detail({}))).toBe(
      `$11.2M sits within 2${NB}% of the price in WETH’s one scored pool.`,
    )
    expect(tokenAnswer(detail({ usd: null }))).toBe(
      'WETH has no USD price yet, so depth is shown in pool terms only.',
    )
  })

  it('keeps defaults out of the URL and drops unknown values', () => {
    const state = readTableState(new URLSearchParams('sort=spread&cols=gap,bogus,tvl'))
    expect(state).toEqual({ sort: 'spread', dir: 'asc', cols: ['gap', 'tvl'] })
    expect(writeTableState(new URLSearchParams(), state).toString()).toBe(
      'sort=spread&cols=tvl%2Cgap',
    )
    expect(
      writeTableState(new URLSearchParams('x=1'), {
        sort: 'depth',
        dir: 'desc',
        cols: [],
      }).toString(),
    ).toBe('x=1')
  })
})
