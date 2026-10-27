import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient, MOCK_MM_OK_ID, MOCK_MM_OK_POOL } from '../api/mock.js'
import type { ApiClient, PoolDetail, PoolMetaDto } from '../api/types.js'
import { NB, usd } from '../lib/format.js'
import { mmHref } from '../lib/scorecard.js'
import { poolAnswer } from './pool/poolText.js'

const V3_ADDRESS = '0xd0b53d9277642d899df5c87a3966a349a798f224'
const V3_WETH_USDC = `uniswap-v3:${V3_ADDRESS}`
const V4_POOL_ID = '0x3f0e1c7b8d2a9f4e6b1c5d8a7e9f2b4c6d8e0f1a2b3c4d5e6f708192a3b4c5d6'
const V4_ETH_USDC = `uniswap-v4:${V4_POOL_ID}`
/** What the v4 adapter stores as `hooks` for pools without hooks (`address(0)`). */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** Mock pools stored as USDC per … with a price below 1 (token1 per token0). */
const USDC_AERO = 'aerodrome-v2:0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d'
const USDC_CBBTC = 'uniswap-v3:0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef'
const HOOKS = '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c40'

afterEach(cleanup)

let search = ''
function LocationProbe() {
  search = useLocation().search
  return null
}

/** Renders `/pools/:id` (plus `query`), with `patch` applied to the mock's detail. */
function renderPool(
  id: string,
  {
    patch = {},
    meta = {},
    query = '',
  }: { patch?: Partial<PoolDetail>; meta?: Partial<PoolMetaDto>; query?: string } = {},
) {
  const base = createMockClient({ now: 1_760_000_000 })
  const client: ApiClient = {
    ...base,
    async pool(poolId) {
      const detail = await base.pool(poolId)
      return { ...detail, ...patch, pool: { ...detail.pool, ...meta } }
    },
  }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(id)}${query}`]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  )
}

async function loaded() {
  return screen.findByRole('heading', { level: 1, name: /WETH \/ USDC|ETH \/ USDC/ })
}

describe('Pool page: the first view (ia-v3 §4.3)', () => {
  it('leads with the back link, the pair with token links, and the two-sided answer', async () => {
    renderPool(V3_WETH_USDC)
    const h1 = await loaded()
    expect(document.querySelector('a.back')?.getAttribute('href')).toBe('/pools')
    const tokenLinks = within(h1).getAllByRole('link')
    expect(tokenLinks.map((a) => a.getAttribute('href'))).toEqual([
      expect.stringMatching(/^\/tokens\/0x/),
      expect.stringMatching(/^\/tokens\/0x/),
    ])
    const answer = document.querySelector('.answer')
    expect(answer?.textContent).toMatch(
      /^It takes \$[\d.]+[KM] of buying to lift WETH 2\s% and \$[\d.]+[KM] of selling to push it down\.$/,
    )
    expect(screen.getByText(/Uniswap v3, 0\.05\s% fee/)).toBeTruthy()
  })

  it('names the tab after the pair', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    expect(document.title).toBe('WETH / USDC – Depthwatch')
  })

  it('draws the mirrored curve as the focal element, with its numbers behind Show data', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const curve = document.querySelector('.curve svg[role="img"]')
    expect(curve?.getAttribute('aria-label')).toBeTruthy()
    const show = screen.getAllByRole('button', { name: 'Show data' })[0]
    if (!show) throw new Error('Show data missing')
    fireEvent.click(show, { detail: 0 })
    const table = await screen.findByRole('table', { name: 'Depth per level and side' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual([
      `±1${NB}%`,
      `±2${NB}%`,
      `±5${NB}%`,
    ])
  })

  it('states four facts, value first, with the health grade', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const facts = document.querySelector('.pool-facts')
    if (!(facts instanceof HTMLElement)) throw new Error('facts missing')
    const labels = [...facts.querySelectorAll('dt')].map((d) => d.textContent)
    expect(labels).toEqual(['health', 'spread at $10K', `traded in 24${NB}h`, 'TVL'])
    expect(within(facts).getByRole('img', { name: /^Grade [A-F]$/ })).toBeTruthy()
  })

  it('flips the price, and the button names the other direction', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const flip = screen.getByRole('button', { name: 'Show price in WETH' })
    const before = document.querySelector('.pool-price')?.textContent ?? ''
    expect(before).toMatch(/^1\sWETH = [\d,.]+\sUSDC$/)
    fireEvent.click(flip, { detail: 0 })
    expect(screen.getByRole('button', { name: 'Show price in USDC' })).toBeTruthy()
    expect(document.querySelector('.pool-price')?.textContent).toMatch(/^1\sUSDC = 0\.\d+\sWETH$/)
  })
})

describe('Pool page: stored sides, price from the base token (N2, UX2-02)', () => {
  /** The stored ±2 % sides: up lifts token0 (USDC here), down pushes it. */
  async function stored(id: string) {
    const detail = await createMockClient({ now: 1_760_000_000 }).pool(id)
    const level = detail.latest?.depthUsd.find((d) => d.pct === 2)
    return { up: level?.upUsd ?? null, down: level?.downUsd ?? null }
  }

  it.each([
    [USDC_AERO, 'AERO', /^1\sAERO = 1\.32\sUSDC$/, /^1\sUSDC = 0\.7576\sAERO$/],
    [USDC_CBBTC, 'cbBTC', /^1\scbBTC = 98,522\.17\sUSDC$/, /^1\sUSDC = 0\.00001015\scbBTC$/],
  ])('%s keeps USDC’s sides and prices %s in USDC', async (id, base, line, flipped) => {
    const { up, down } = await stored(id)
    renderPool(id)
    await screen.findByRole('heading', { level: 1, name: `USDC / ${base}` })
    // The sides are the stored ones, token0's, as Home and the scorecards show them.
    expect(document.querySelector('.answer')?.textContent).toBe(
      `It takes ${usd(up)} of buying to lift USDC 2${NB}% and ${usd(down)} of selling to push it down.`,
    )
    expect(document.querySelector('.pool-price')?.textContent).toMatch(line)
    fireEvent.click(screen.getByRole('button', { name: `Show price in ${base}` }), { detail: 0 })
    expect(document.querySelector('.pool-price')?.textContent).toMatch(flipped)
  })
})

describe('Pool page: loading (ST1)', () => {
  it('shows the title block from a loaded list at once, with the skeleton laid out', async () => {
    const base = createMockClient({ now: 1_760_000_000 })
    const list = await base.pools({ limit: 200 })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['pools', { limit: 200 }], list)
    const client: ApiClient = { ...base, pool: () => new Promise(() => undefined) }
    render(
      <Providers client={client} mock queryClient={queryClient}>
        <MemoryRouter initialEntries={[`/pools/${encodeURIComponent(V3_WETH_USDC)}`]}>
          <AppRoutes />
        </MemoryRouter>
      </Providers>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'WETH / USDC' })).toBeTruthy()
    expect(document.querySelector('.pool-price')?.textContent).toMatch(/^1\sWETH = [\d,.]+\sUSDC$/)
    // The blocks hold the final heights from the first frame, unpainted for the first 300 ms.
    const skeleton = document.querySelector<HTMLElement>('[role="status"].skel-stack')
    expect(skeleton?.getAttribute('aria-label')).toBe('Loading pool')
    expect(skeleton?.style.visibility).toBe('hidden')
    expect(skeleton?.querySelectorAll('.skel').length).toBeGreaterThan(4)
  })
})

describe('Pool page: sections', () => {
  it('orders the sections and puts Details in each heading', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual([
      'Health',
      'Cost to trade',
      'Who provides it',
      'Over time',
      'About this pool',
    ])
    const health = screen.getByRole('region', { name: 'Health' })
    fireEvent.click(within(health).getByRole('button', { name: 'Details' }), { detail: 0 })
    const table = within(health).getByRole('table', { name: 'Health components' })
    expect(within(table).getByText(/^Total, grade [A-F]$/)).toBeTruthy()
  })

  it('keeps the window in the URL and starts from it', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    const time = screen.getByRole('region', { name: 'Over time' })
    const week = within(time).getByRole('radio', { name: `7${NB}d` })
    act(() => {
      fireEvent.click(week, { detail: 0 })
    })
    expect(search).toBe('?window=7d')
    expect(week.getAttribute('aria-checked')).toBe('true')
    cleanup()
    renderPool(V3_WETH_USDC, { query: '?window=7d' })
    await loaded()
    const again = screen.getByRole('region', { name: 'Over time' })
    expect(
      within(again)
        .getByRole('radio', { name: `7${NB}d` })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('lists the mandates on the pool, each linking to its scorecard', async () => {
    renderPool(MOCK_MM_OK_POOL)
    const region = await screen.findByRole('region', { name: 'Mandates on this pool' })
    const link = within(region).getAllByRole('link')[0]
    expect(link?.getAttribute('href')).toBe(mmHref(MOCK_MM_OK_ID))
    expect(within(region).getByText('Within KPI')).toBeTruthy()
  })
})

describe('Pool page: About this pool (L3)', () => {
  it('links an address-keyed pool to Basescan and offers a copy', async () => {
    const { container } = renderPool(V3_WETH_USDC)
    await loaded()
    const links = [...container.querySelectorAll('a[href^="https://basescan.org"]')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      `https://basescan.org/address/${V3_ADDRESS}`,
    ])
    expect(screen.getByTitle(V3_ADDRESS).textContent).toBe(
      `${V3_ADDRESS.slice(0, 10)}…${V3_ADDRESS.slice(-6)}`,
    )
    expect(screen.getByRole('button', { name: 'Copy address', hidden: true })).toBeTruthy()
  })

  it('shows a Uniswap v4 pool id as text, never as a dead explorer link', async () => {
    const { container } = renderPool(V4_ETH_USDC)
    await loaded()
    expect(container.querySelectorAll('a[href^="https://basescan.org"]')).toHaveLength(0)
    const id = screen.getByTitle(V4_POOL_ID)
    expect(id.tagName).toBe('SPAN')
    expect(screen.getByRole('button', { name: 'Copy pool id', hidden: true })).toBeTruthy()
  })

  it('names a hooks contract only when the pool has one', async () => {
    renderPool(V4_ETH_USDC, { meta: { hooks: ZERO_ADDRESS } })
    await loaded()
    expect(screen.queryByText('Hooks')).toBeNull()
    cleanup()
    renderPool(V4_ETH_USDC, { meta: { hooks: HOOKS } })
    await loaded()
    expect(screen.getByText('Hooks')).toBeTruthy()
    expect(screen.getByTitle(HOOKS).getAttribute('href')).toBe(
      `https://basescan.org/address/${HOOKS}`,
    )
  })
})

describe('Pool page: a pool with no grade', () => {
  const THIN = 'aerodrome-v2:0x2b6f9a1c4d8e3f7a0b5c6d9e1f2a3b4c5d6e7f80'
  const ONE_SIDED = 'uniswap-v3:0x61d4c2e8a3f90b7d5c1e6a4f2b8d3c09e7a5b1f4'
  const UNPRICED = 'uniswap-v3:0x9f3b7e1a5c2d8046e9b1a7c3f5d20e8b4a6c1d93'
  const facts = () => {
    const el = document.querySelector('.pool-facts')
    if (!(el instanceof HTMLElement)) throw new Error('facts missing')
    return el
  }
  const opened = async () => {
    const health = screen.getByRole('region', { name: 'Health' })
    fireEvent.click(within(health).getByRole('button', { name: 'Details' }), { detail: 0 })
    return health
  }

  it('says "Not rated" instead of a letter, and why, for a pool that is too thin', async () => {
    renderPool(THIN)
    await screen.findByRole('heading', { level: 1, name: /AERO \/ DEGEN/ })
    expect(within(facts()).queryByRole('img', { name: /^Grade/ })).toBeNull()
    const chip = within(facts()).getByRole('button', { name: 'Not rated' })
    fireEvent.focus(chip)
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Too thin to rate: neither side holds $5K within 2${NB}%.`,
    )
    const reason = `Too thin to rate: neither side holds $5K within 2${NB}%.`
    const health = await opened()
    // the takeaway and the Details line both say it; the numbers stay in the table
    // (the default matcher folds the no-break space in the text it reads, not in the needle)
    expect(within(health).getAllByText(reason.replaceAll(NB, ' '))).toHaveLength(2)
    const table = within(health).getByRole('table', { name: 'Health components' })
    expect(within(table).getByText('Total, not rated')).toBeTruthy()
    expect(within(table).queryByText(/grade [A-F]/)).toBeNull()
    expect(within(table).getAllByRole('row')).toHaveLength(6)
  })

  it('says "Too thin on one side" for a pool with a buy side only, and that it can’t absorb $10K', async () => {
    renderPool(ONE_SIDED)
    await screen.findByRole('heading', { level: 1, name: /BRETT \/ DEGEN/ })
    fireEvent.focus(within(facts()).getByRole('button', { name: 'Not rated' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      `Too thin on one side: the thinner side holds under $5K within 2${NB}%.`,
    )
    // a priced pool with no $10K spread: the words where the spread would be
    const spread = [...facts().querySelectorAll('.fact')].find(
      (f) => f.querySelector('dt')?.textContent === 'spread at $10K',
    )
    expect(spread?.querySelector('dd')?.textContent).toBe(`Can’t absorb $10K`)
    expect(document.querySelector('.answer')?.textContent).toMatch(
      /^Liquidity runs out before a 2\s% move/,
    )
  })

  it('says "No USD price" for a pool with a token that has none, with no spread to show', async () => {
    renderPool(UNPRICED)
    await screen.findByRole('heading', { level: 1, name: /WETH \/ TOSHI/ })
    fireEvent.focus(within(facts()).getByRole('button', { name: 'Not rated' }))
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'No USD price: a token in this pool has no price in dollars.',
    )
    const spread = [...facts().querySelectorAll('.fact')].find(
      (f) => f.querySelector('dt')?.textContent === 'spread at $10K',
    )
    expect(spread?.querySelector('dd')?.textContent).toBe('—')
    expect(document.querySelector('.answer')?.textContent).toBe(
      `It takes $42K of selling to push WETH down 2${NB}%. The buy side is unknown: TOSHI has no USD price.`,
    )
  })

  it('shows the grade of a rated pool as before', async () => {
    renderPool(V3_WETH_USDC)
    await loaded()
    expect(within(facts()).getByRole('img', { name: /^Grade [A-F]$/ })).toBeTruthy()
    expect(within(facts()).queryByRole('button', { name: 'Not rated' })).toBeNull()
  })
})

describe('Pool page: states', () => {
  it('says which pool was not found, with the id and two ways on', async () => {
    renderPool('uniswap-v3:0x00000000000000000000000000000000000000aa')
    expect(await screen.findByRole('heading', { level: 1, name: 'Pool not found' })).toBeTruthy()
    expect(screen.getByText('uniswap-v3:0x00000000000000000000000000000000000000aa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe('/pools')
  })
})

describe('poolAnswer', () => {
  const pool = { token0: { symbol: 'WETH' }, token1: { symbol: 'USDC' } } as PoolMetaDto
  const level = (up: number | null, down: number | null, reachedUp = true, reachedDown = true) =>
    ({
      pool,
      latest: {
        depthUsd: [{ pct: 2, upUsd: up, downUsd: down, totalUsd: null }],
        depth: [
          {
            pct: 2,
            up: { amountIn: '1', amountOut: '1', reached: reachedUp },
            down: { amountIn: '1', amountOut: '1', reached: reachedDown },
          },
        ],
      },
    }) as unknown as Pick<PoolDetail, 'pool' | 'latest'>

  it('states both sides at 3 significant figures (N1)', () => {
    expect(poolAnswer(level(6_079_641, 5_102_004))).toBe(
      `It takes $6.08M of buying to lift WETH 2${NB}% and $5.10M of selling to push it down.`,
    )
  })

  it('names the token with no USD price instead of a misleading number', () => {
    expect(poolAnswer(level(null, 5_102_004))).toBe(
      `It takes $5.10M of selling to push WETH down 2${NB}%. The buy side is unknown: USDC has no USD price.`,
    )
  })

  it('says how much empties a side that runs out before 2 %', () => {
    expect(poolAnswer(level(812_000, 5_102_004, false))).toBe(
      `Liquidity runs out before a 2${NB}% move: $812K empties the buy side, and $5.10M of selling pushes WETH down 2${NB}%.`,
    )
  })

  it('waits for the first snapshot', () => {
    expect(poolAnswer({ pool, latest: null })).toBe(
      'No snapshot yet. Depth appears after the first snapshot.',
    )
  })
})
