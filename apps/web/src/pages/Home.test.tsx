/**
 * Home (ia-v3 §4.1, docs/design/visual-v3.md §6.1) against the in-repo mock: the answer sentence,
 * the focal butterfly with its total row and Show data, the three facts, the two previews, the
 * empty and error states, the first-view intro and the paging behind the total row.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { ApiError } from '../api/errors.js'
import { createMockClient, MOCK_MM_BREACHED_ID, MOCK_MM_OK_ID } from '../api/mock.js'
import type { ApiClient, PoolSummary, PoolsQuery } from '../api/types.js'
import { pairLabel, poolHref, ratio, score, usd } from '../lib/format.js'
import {
  gapsTakeaway,
  homeAnswer,
  homeLead,
  isMeaningfulGap,
  mandatesTakeaway,
} from './home/copy.js'
import { INTRO_KEY } from './home/useIntro.js'

/**
 * A side of Base as Home draws it: each pool reads from its base token, so a pool whose price
 * (token1 per token0) is below 1, such as USDC / cbBTC, counts its stored up side as selling.
 */
/** The total row sums the stored sides (token0's), the same values every page shows. */
function storedSum(pools: readonly PoolSummary[], side: 'sell' | 'buy'): number {
  return pools.reduce((s, p) => s + ((side === 'sell' ? p.depth2DownUsd : p.depth2UpUsd) ?? 0), 0)
}

const NOW = 1_760_000_000
const NB = ' '

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

function renderHome(client: ApiClient = createMockClient({ now: NOW }), path = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
  return client
}

const figure = () => screen.findByRole('group', { name: /^Base: / })
function preview(name: string): HTMLElement {
  const el = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!el) throw new Error(`no preview ${name}`)
  return el
}

describe('Home: answer and actions', () => {
  it('states Base depth in the display answer and the scored count in the lead', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    const h1 = await screen.findByRole('heading', { level: 1 })
    await waitFor(() => expect(h1.textContent).toBe(homeAnswer(totals.depth2Usd)))
    expect(h1.textContent).toBe(
      `${usd(totals.depth2Usd)} sits within 2${NB}% of the price on Base.`,
    )
    expect(screen.getByText(homeLead(totals.scored, totals.rated))).toBeTruthy()
    // 18 scored pools, 15 of them deep enough to be graded: the lead says so, not "A to F" for all
    expect(totals.scored).toBe(18)
    expect(totals.rated).toBe(15)
    expect(homeLead(totals.scored, totals.rated)).toBe(
      'Depthwatch measures what it costs to move each of 18 Uniswap and Aerodrome pools, and grades the 15 deep enough to rate A to F.',
    )
    const browse = screen.getByRole('link', { name: 'Browse pools' })
    expect(browse.getAttribute('href')).toBe('/pools')
    expect(browse.className).toContain('primary')
    expect(document.querySelectorAll('main .btn.primary')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'How it’s measured' }).getAttribute('href')).toBe(
      '/methodology',
    )
  })

  it('renders inside <main> on the page grid', async () => {
    renderHome()
    await figure()
    const root = document.querySelector('.home')
    expect(root?.classList.contains('wrap')).toBe(true)
    expect(root?.parentElement?.tagName).toBe('MAIN')
  })
})

describe('Home: the focal butterfly (CH4, ia-v3 §4.1)', () => {
  it('lists the 7 deepest pools plus the gap pool, with the Gap marker linking to /gaps', async () => {
    const client = renderHome()
    const fig = await figure()
    const pools = (await client.pools({ sort: 'depth', limit: 200 })).items
    const gaps = (await client.gaps({ limit: 200 })).items.filter(isMeaningfulGap)
    const gapPool = gaps[0]?.pool.pool
    if (!gapPool) throw new Error('mock has no gap')
    const rows = within(fig).getAllByRole('listitem')
    expect(rows).toHaveLength(8)
    const deepest = pools[0]
    if (!deepest) throw new Error('no pools')
    const links = rows.map((r) => r.querySelector('a.bf-pair')?.getAttribute('href'))
    expect(links[0]).toBe(poolHref(deepest.pool.id))
    expect(links).toContain(poolHref(gapPool.id))
    const gap = within(fig).getByRole('link', { name: /^Liquidity gap: / })
    expect(gap.getAttribute('href')).toBe('/gaps')
    expect(gap.getAttribute('aria-label')).toContain(pairLabel(gapPool.token0, gapPool.token1))
  })

  it('closes with the "All of Base" total row whose two labels sum every pool', async () => {
    const client = renderHome()
    const fig = await figure()
    const pools = (await client.pools({ sort: 'depth', limit: 200 })).items
    expect(within(fig).getByText('All of Base')).toBeTruthy()
    expect(within(fig).getByText(`${pools.length} pools`)).toBeTruthy()
    const totals = [...fig.querySelectorAll('.tot-val')].map((el) => el.textContent)
    expect(totals).toEqual([usd(storedSum(pools, 'sell')), usd(storedSum(pools, 'buy'))])
    expect(within(fig).getByText('One scale for every pool')).toBeTruthy()
    // 15 pools, 8 rows: the rest are one link away, deepest first.
    const all = within(fig).getByRole('link', { name: `Show all ${pools.length} pools` })
    expect(all.getAttribute('href')).toBe('/pools?sort=depth')
  })

  it('plays the grow-from-spine intro on the first Home view of a session only', async () => {
    renderHome()
    const fig = await figure()
    expect(fig.className).toContain('grow')
    await waitFor(() => expect(window.sessionStorage.getItem(INTRO_KEY)).toBe('1'))
    cleanup()
    renderHome()
    expect((await figure()).className).not.toContain('grow')
    cleanup()
    renderHome(undefined, '/?replay=1')
    expect((await figure()).className).toContain('grow')
  })

  it('opens Show data: every row with both sides, its share and the total', async () => {
    renderHome()
    await figure()
    const show = screen.getByRole('button', { name: 'Show data' })
    expect(show.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(show)
    expect(show.getAttribute('aria-expanded')).toBe('true')
    const table = screen.getByRole('table', { name: `Depth within 2${NB}% by pool` })
    const header = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(header).toEqual(['Pool', `Sell side ±2${NB}%`, `Buy side ±2${NB}%`, 'Share of Base'])
    const body = within(table).getAllByRole('row').slice(1)
    // 8 listed pools, the other 10 as one row, and the total.
    expect(body).toHaveLength(10)
    expect(body.at(-1)?.textContent).toContain('All of Base')
    expect(body.at(-1)?.textContent).toContain(`100${NB}%`)
    expect(body.at(-2)?.textContent).toContain('10 other pools')
  })
})

describe('Home: facts (D3)', () => {
  it('shows 24 h volume, median health with its grade and the biggest gap', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    const top = (await client.gaps({ limit: 200 })).items[0]
    if (!top) throw new Error('mock has no gaps')
    const facts = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('dl.home-facts')
      if (!el) throw new Error('no facts yet')
      return el
    })
    const terms = [...facts.querySelectorAll('dt')].map((dt) => dt.textContent)
    const values = [...facts.querySelectorAll('dd')].map((dd) => dd.textContent)
    expect(terms).toEqual([
      `traded in 24${NB}h`,
      `median health across ${totals.rated} rated pools`,
      `${pairLabel(top.pool.pool.token0, top.pool.pool.token1)}, the biggest gap`,
    ])
    expect(values[0]).toBe(usd(totals.volume24hUsd))
    expect(values[1]).toContain(score(totals.medianHealth))
    expect(values[2]).toBe(ratio(top.gap.turnoverRatio))
    expect(within(facts).getByRole('img', { name: 'Grade A' })).toBeTruthy()
    // The terms are glossary tooltips: focus opens the definition with its Methodology anchor.
    fireEvent.focus(within(facts).getByRole('button', { name: 'health' }))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByRole('link').getAttribute('href')).toBe('/methodology#health')
  })
})

describe('Home: the median health counts only the rated pools', () => {
  it('says how many pools it is the median of, and has none when no pool is rated', async () => {
    const base = createMockClient({ now: NOW })
    const stats = await base.stats()
    renderHome(
      withClient({
        stats: async () => ({
          ...stats,
          totals: { ...stats.totals, rated: 1, medianHealth: 87.6 },
        }),
      }),
    )
    const facts = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('dl.home-facts')
      if (!el) throw new Error('no facts yet')
      return el
    })
    const terms = [...facts.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(terms[1]).toBe('median health across 1 rated pool')
    expect(facts.querySelectorAll('dd')[1]?.textContent).toContain('87')
    expect(within(facts).getByRole('img', { name: 'Grade A' })).toBeTruthy()
    cleanup()
    renderHome(
      withClient({
        stats: async () => ({
          ...stats,
          totals: { ...stats.totals, rated: 0, medianHealth: null },
        }),
      }),
    )
    const none = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('dl.home-facts')
      if (!el) throw new Error('no facts yet')
      return el
    })
    expect([...none.querySelectorAll('dt')][1]?.textContent).toBe(
      'median health, no pool rated yet',
    )
    expect(none.querySelectorAll('dd')[1]?.textContent).toBe('—')
    expect(within(none).queryByRole('img', { name: /^Grade / })).toBeNull()
    expect(
      await screen.findByText(
        'Depthwatch measures what it costs to move each of 18 Uniswap and Aerodrome pools, but none is deep enough to grade.',
      ),
    ).toBeTruthy()
  })
})

describe('Home: previews', () => {
  it('previews at most 3 meaningful gaps and links to /gaps', async () => {
    const client = renderHome()
    const meaningful = (await client.gaps({ limit: 200 })).items.filter(isMeaningfulGap)
    await screen.findByText(gapsTakeaway(meaningful.length))
    const gaps = preview('Where liquidity is thin')
    expect(within(gaps).getByRole('link', { name: 'See all gaps' }).getAttribute('href')).toBe(
      '/gaps',
    )
    const rows = within(gaps).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const first = meaningful[0]
    if (!first) throw new Error('no gaps')
    const link = within(rows[0] as HTMLElement).getByRole('link')
    expect(link.getAttribute('href')).toBe(poolHref(first.pool.pool.id))
    expect(rows[0]?.textContent).toContain(
      `Trades ${ratio(first.gap.turnoverRatio)} its depth a day`,
    )
    expect(
      within(rows[0] as HTMLElement)
        .getByRole('img')
        .getAttribute('aria-label'),
    ).toMatch(/^Gap score \d+ of 100; 3× turnover is 24$/)
    // Three real gaps fill the preview, so there is no quiet line.
    expect(within(gaps).queryByText(/Every other pool/)).toBeNull()
  })

  it('previews the mandates with status, the pool and the 7 d uptime against its target', async () => {
    renderHome()
    await screen.findByText(/^1 of 2 mandates is within its/)
    const mm = preview('Market makers on the record')
    expect(mm.querySelector('.takeaway')?.textContent).toBe(
      '1 of 2 mandates is within its KPIs right now.',
    )
    expect(within(mm).getByRole('link', { name: 'See all scorecards' }).getAttribute('href')).toBe(
      '/mm',
    )
    const rows = within(mm).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('a.rl-link')?.getAttribute('href'))).toEqual([
      `/mm/${MOCK_MM_BREACHED_ID}`,
      `/mm/${MOCK_MM_OK_ID}`,
    ])
    expect(within(rows[0] as HTMLElement).getByText('Breached')).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Within KPI')).toBeTruthy()
    await waitFor(() => expect(rows[0]?.textContent).toContain('Demo Markets on USDC / AERO'))
    expect(
      within(rows[0] as HTMLElement)
        .getByRole('img', { name: /^7 day uptime/ })
        .getAttribute('aria-label'),
    ).toBe(`7 day uptime 24${NB}% against a 90${NB}% target`)
  })
})

/** The mock with some endpoints replaced. */
function withClient(over: Partial<ApiClient>): ApiClient {
  return { ...createMockClient({ now: NOW }), ...over }
}

describe('Home: states (ia-v3 §4.1)', () => {
  it('says so when no pool is scored yet, with the spine only and no facts', async () => {
    const base = createMockClient({ now: NOW })
    const stats = await base.stats()
    renderHome(
      withClient({
        stats: async () => ({ ...stats, totals: { ...stats.totals, scored: 0, pools: 3 } }),
        pools: async () => ({ items: [], total: 0 }),
        gaps: async () => ({ items: [], minVolumeUsd: 10_000 }),
      }),
    )
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No pools are scored yet.' }),
    ).toBeTruthy()
    expect(
      screen.getByText('3 pools discovered. Scores appear after the first snapshot.'),
    ).toBeTruthy()
    expect(await screen.findByLabelText('No Base pools are scored yet')).toBeTruthy()
    expect(document.querySelector('.home-facts')).toBeNull()
    expect(await screen.findByText('No pool trades 3× its depth today.')).toBeTruthy()
  })

  it('shows a dash, never $0, when no pool has a known 24 h volume', async () => {
    const base = createMockClient({ now: NOW })
    const stats = await base.stats()
    renderHome(
      withClient({
        stats: async () => ({ ...stats, totals: { ...stats.totals, volume24hUsd: null } }),
      }),
    )
    const facts = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('dl.home-facts')
      if (!el) throw new Error('no facts yet')
      return el
    })
    const traded = [...facts.querySelectorAll('dd')][0]
    expect(traded?.textContent).not.toContain('$0')
    expect(traded?.textContent).toBe(usd(null))
  })

  it('without a meaningful gap: no Gap marker, no rows, the highest turnover as the fact', async () => {
    const base = createMockClient({ now: NOW })
    const feed = await base.gaps({ limit: 200 })
    const calm = feed.items.filter((g) => !isMeaningfulGap(g))
    const top = calm[0]
    if (!top) throw new Error('mock has no calm pool')
    renderHome(withClient({ gaps: async () => ({ ...feed, items: calm }) }))
    const fig = await figure()
    expect(within(fig).queryByRole('link', { name: /^Liquidity gap/ })).toBeNull()
    await screen.findByText('No pool trades 3× its depth today.')
    expect(within(preview('Where liquidity is thin')).queryByRole('list')).toBeNull()
    const pair = pairLabel(top.pool.pool.token0, top.pool.pool.token1)
    expect(await screen.findByText(`${pair}, the highest`, { exact: false })).toBeTruthy()
    expect(screen.getByText(ratio(top.gap.turnoverRatio))).toBeTruthy()
  })

  it('adds the quiet line under fewer than 3 gap rows', async () => {
    const base = createMockClient({ now: NOW })
    const feed = await base.gaps({ limit: 200 })
    const one = [
      feed.items.filter(isMeaningfulGap)[0],
      ...feed.items.filter((g) => !isMeaningfulGap(g)),
    ]
    renderHome(
      withClient({ gaps: async () => ({ ...feed, items: one.flatMap((g) => (g ? [g] : [])) }) }),
    )
    expect(await screen.findByText('1 pool trades 3× its depth or more every day.')).toBeTruthy()
    const gaps = preview('Where liquidity is thin')
    expect(within(gaps).getAllByRole('listitem')).toHaveLength(2)
    expect(within(gaps).getByText('Every other pool trades less than 3× its depth.')).toBeTruthy()
  })

  it('shrinks the scorecards preview to one line when no mandate is registered', async () => {
    renderHome(withClient({ scorecards: async () => ({ items: [] }) }))
    const line = await screen.findByText(/^No market-maker mandates registered yet\./)
    expect(
      within(line).getByRole('link', { name: 'How scorecards work' }).getAttribute('href'),
    ).toBe('/methodology#scorecards')
    const mm = preview('Market makers on the record')
    expect(within(mm).queryByRole('link', { name: 'See all scorecards' })).toBeNull()
    expect(within(mm).queryByRole('list')).toBeNull()
  })

  it('names an unscored mandated pool by its short address', async () => {
    const base = createMockClient({ now: NOW })
    const { items } = await base.scorecards()
    const poolId = `aerodrome-v2:0x${'ab'.repeat(20)}`
    renderHome(
      withClient({
        scorecards: async () => ({
          items: items.map((s) => ({ ...s, mandate: { ...s.mandate, poolId } })),
        }),
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByText(/^Demo Markets on 0xabab…abab$/)).toHaveLength(items.length),
    )
  })

  it('keeps the page usable when the totals fail to load', async () => {
    renderHome(
      withClient({
        stats: async () => {
          throw new ApiError(500, 'boom')
        },
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Unable to load the totals\./)
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(await figure()).toBeTruthy()
  })
})

describe('Home: the total row reads every page of pools', () => {
  it('pages through /api/pools so the total sums all of them', async () => {
    const base = createMockClient({ now: NOW })
    const seed = (await base.pools({ limit: 200 })).items
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
    const totals = [...fig.querySelectorAll('.tot-val')].map((el) => el.textContent)
    expect(totals).toEqual([usd(storedSum(many, 'sell')), usd(storedSum(many, 'buy'))])
    expect(within(fig).getByRole('link', { name: 'Show all 450 pools' })).toBeTruthy()
  })
})

describe('Home copy', () => {
  it('agrees in number', () => {
    expect(gapsTakeaway(0)).toBe('No pool trades 3× its depth today.')
    expect(gapsTakeaway(1)).toBe('1 pool trades 3× its depth or more every day.')
    expect(gapsTakeaway(4)).toBe('4 pools trade 3× their depth or more every day.')
    const take = (ok: number, n: number) => {
      const w = mandatesTakeaway(
        Array.from({ length: n }, (_, i) => ({ status: i < ok ? 'ok' : 'breached' }) as const),
      )
      return `${w.before}KPIs${w.after}`
    }
    expect(take(1, 2)).toBe('1 of 2 mandates is within its KPIs right now.')
    expect(take(2, 2)).toBe('2 of 2 mandates are within their KPIs right now.')
    expect(take(0, 3)).toBe('0 of 3 mandates are within their KPIs right now.')
    expect(take(0, 1)).toBe('0 of 1 mandate is within its KPIs right now.')
    expect(homeLead(1, 1)).toMatch(
      /its one scored Uniswap or Aerodrome pool, and grades it A to F\.$/,
    )
    expect(homeLead(1, 0)).toMatch(
      /its one scored Uniswap or Aerodrome pool, but it is too thin to grade\.$/,
    )
    expect(homeLead(5, 5)).toMatch(
      /each of 5 Uniswap and Aerodrome pools, and grades them A to F\.$/,
    )
    expect(homeLead(492, 50)).toMatch(
      /each of 492 .*, and grades the 50 deep enough to rate A to F\.$/,
    )
    expect(homeLead(492, 0)).toMatch(/each of 492 .*, but none is deep enough to grade\.$/)
  })
})
