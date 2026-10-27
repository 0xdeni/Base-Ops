import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import {
  createMockClient,
  MOCK_MM_BREACHED_ID,
  MOCK_MM_BREACHED_POOL,
  MOCK_MM_OK_ID,
  MOCK_MM_OK_POOL,
} from '../api/mock.js'
import { MOCK_MM_OWNER_SLIP } from '../api/mockScorecards.js'
import { poolHref } from '../lib/format.js'

const NOW = 1_760_000_000
const NB = '\u00a0'

afterEach(cleanup)

let search = ''
function LocationProbe() {
  search = useLocation().search
  return null
}

function renderAt(path: string) {
  const client = createMockClient({ now: NOW })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={client} mock dataNow={NOW} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </Providers>,
  )
}

function section(name: string): HTMLElement {
  const el = screen.getByRole('heading', { level: 2, name }).closest('section')
  if (!el) throw new Error(`section ${name} not rendered`)
  return el
}

/** Every fact label, in order (the `dt`s of the facts row). */
function factLabels(): string[] {
  const facts = document.querySelector('.sc-facts')
  if (!facts) throw new Error('facts not rendered')
  return [...facts.querySelectorAll('dt')].map((dt) => dt.textContent ?? '')
}

async function chart(): Promise<HTMLElement> {
  return screen.findByRole('img', { name: /^Market-maker depth per side over/ })
}

describe('/mm/:id title block and answer (ia-v3 §4.6)', () => {
  it('starts with the back link, the mandate name, its status chip and the meta line', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    const h1 = await screen.findByRole('heading', {
      level: 1,
      name: /^Demo Markets . Slipstream WETH\/AERO$/,
    })
    expect(h1).toBeTruthy()
    const back = document.querySelector('a.back')
    expect(back?.textContent).toBe('Scorecards')
    expect(back?.getAttribute('href')).toBe('/mm')
    // The chip sits after the h1 on desktop and leads the meta line on phones (CSS picks one).
    expect(document.querySelectorAll('.status-chip')).toHaveLength(2)
    expect(document.querySelector('.status-chip')?.textContent).toBe('Within KPI')
    const meta = document.querySelector('.sc-sub')
    expect(meta?.textContent).toMatch(/Demo Markets on WETH \/ AERO, Aerodrome Slipstream, 0\.3.%/)
    const pool = within(meta as HTMLElement).getByRole('link', { name: 'WETH / AERO' })
    expect(pool.getAttribute('href')).toBe(poolHref(MOCK_MM_OK_POOL))
  })

  it('answers with the current streak and since when', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    expect(
      await screen.findByText(/^Within KPI for 58 consecutive samples, since 4.Oct, 14:53.UTC\.$/),
    ).toBeTruthy()
  })

  it('drops the "since" clause when a spread KPI adds a fourth fact', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    expect(await screen.findByText('Breached for 19 consecutive samples.')).toBeTruthy()
    expect(document.querySelector('.status-chip')?.textContent).toBe('Breached')
  })
})

describe('/mm/:id focal chart and facts', () => {
  it('draws the market-maker chart over 7 d by default with Show data under it', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 7 days against the \$50K KPI/)
    const windows = screen.getByRole('radiogroup', { name: 'Time window' })
    expect(
      within(windows)
        .getByRole('radio', { name: `7${NB}d` })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Whole-pool depth' })).toBeTruthy()
    const showData = screen.getByRole('button', { name: 'Show data' })
    fireEvent.click(showData, { detail: 0 })
    expect(showData.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('table', { name: 'Samples per UTC day' })).toBeTruthy()
  })

  it('labels each fact with its comparison (ia-v3 §4.6)', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    expect(factLabels()).toEqual([
      'sell side now, within the $50K KPI',
      'buy side now, within the $50K KPI',
      `uptime, 7${NB}d, meets the 95${NB}% target`,
    ])
    // "KPI" is a glossary term at rest.
    expect(screen.getAllByRole('button', { name: 'KPI' })).toHaveLength(2)
    expect(screen.queryByRole('img', { name: 'Below KPI' })).toBeNull()
  })

  it('marks breached values with a triangle and adds the spread fact', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    expect(factLabels()).toEqual([
      'sell side now, below the $25K KPI',
      'buy side now, below the $25K KPI',
      `uptime, 7${NB}d, below the 90${NB}% target`,
      `spread at $10K now, within the 40.0${NB}bps KPI`,
    ])
    expect(screen.getAllByRole('img', { name: 'Below KPI' })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Below target' })).toBeTruthy()
    expect(screen.getByText('$8.81K')).toBeTruthy()
    expect(screen.getByText('$9.01K')).toBeTruthy()
  })

  it('rewrites the facts while scrubbing with the arrow keys, and restores them on Escape', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    const img = await chart()
    act(() => img.focus())
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(factLabels()[0]).toBe('sell side now, within the $50K KPI')
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(factLabels()[0]).toBe('sell side then, within the $50K KPI')
    expect(document.querySelector('.scrub-cap')?.textContent).toMatch(/^Within KPI.*UTC$/)
    // Plain words while scrubbing: no glossary buttons move under the pointer.
    expect(screen.queryAllByRole('button', { name: 'KPI' })).toHaveLength(0)
    fireEvent.keyDown(img, { key: 'Escape' })
    expect(factLabels()[0]).toBe('sell side now, within the $50K KPI')
    expect(screen.getAllByRole('button', { name: 'KPI' })).toHaveLength(2)
  })

  it('keeps the window in the URL (?window=, replace) and follows it in the sections', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    expect(within(section('Uptime')).getByText(/over 7 days/)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: `24${NB}h` }), { detail: 1 })
    expect(search).toBe('?window=24h')
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 24 hours/)
    expect(
      within(section('Uptime')).getByText(
        `12 of 12 samples within KPI over 24 hours (target 95 %).`,
      ),
    ).toBeTruthy()
    expect(within(section('Breaches')).getByText('No breaches in 24 hours.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: `7${NB}d` }), { detail: 1 })
    expect(search).toBe('')
  })

  it('reads ?window=30d on load', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}?window=30d`)
    expect((await chart()).getAttribute('aria-label')).toMatch(/over 30 days/)
    expect(screen.getByRole('radio', { name: `30${NB}d` }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(
      within(section('Uptime')).getByText(
        `93 of 96 samples within KPI over 30 days (target 95 %).`,
      ),
    ).toBeTruthy()
  })
})

describe('/mm/:id sections', () => {
  it('shows the uptime strip and all three windows behind Details', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const up = section('Uptime')
    expect(
      within(up).getByText(`80 of 83 samples within KPI over 7 days (target 95 %).`),
    ).toBeTruthy()
    expect(
      within(up).getByRole('img', { name: '80 of 83 samples within KPI, 1 not evaluable' }),
    ).toBeTruthy()
    fireEvent.click(within(up).getByRole('button', { name: 'Details' }), { detail: 0 })
    const rows = within(within(up).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      `24${NB}h1212100${NB}%0`,
      `7${NB}d838096.4${NB}%1`,
      `30${NB}d969396.9${NB}%1`,
    ])
  })

  it('collapses breached samples into episodes, with the raw samples behind Show samples', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const br = section('Breaches')
    expect(within(br).getByText(`1 breach episode in 7 days, the longest 4 h.`)).toBeTruthy()
    expect(within(br).getByText(`4 h, 3 samples, sell side`)).toBeTruthy()
    expect(within(br).getByText('$42K')).toBeTruthy()
    fireEvent.click(within(br).getByRole('button', { name: 'Show samples' }), { detail: 0 })
    const table = within(br).getByRole('table', { name: 'Breached samples, newest first' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toMatch(/Sell side\$60K\$42K/)
  })

  it('lists five episodes, then "Show all N episodes"', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const br = section('Breaches')
    expect(within(br).getByText(`1 breach episode in 7 days, the longest 36 h.`)).toBeTruthy()
    expect(within(br).getByText(`36 h, ongoing, 19 samples, both sides`)).toBeTruthy()
    expect(within(br).queryByRole('button', { name: /^Show all/ })).toBeNull()
  })

  it('reads the worst moments against the KPI, with the block in Details', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const worst = section('Worst moments')
    expect(within(worst).getByText('Lowest buy-side depth')).toBeTruthy()
    expect(within(worst).getByText('Lowest sell-side depth')).toBeTruthy()
    expect(within(worst).getByText('Widest spread')).toBeTruthy()
    expect(within(worst).getByText(`37.4 bps`)).toBeTruthy()
    // The time's tooltip carries the block; Details carries it too (P6: never hover-only).
    const time = within(worst).getAllByRole('button', { name: /UTC$|ago$/ })[0]
    if (!time) throw new Error('no time term')
    act(() => time.focus())
    expect(screen.getByRole('tooltip').textContent).toMatch(/^Block 36,087,456, /)
    fireEvent.click(within(worst).getByRole('button', { name: 'Details' }), { detail: 0 })
    expect(within(worst).getAllByText('36,087,456').length).toBeGreaterThan(0)
  })

  it('collapses the spread without a KPI and reveals both measured series', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const spread = section('Spread')
    expect(within(spread).getByText('This mandate has no spread KPI.')).toBeTruthy()
    fireEvent.click(within(spread).getByRole('button', { name: 'Show measured spread' }), {
      detail: 0,
    })
    expect(within(spread).getByText('Market-maker spread at $10K')).toBeTruthy()
    expect(within(spread).getByText('Whole-pool spread at $10K')).toBeTruthy()
  })

  it('shows the spread series at once when the mandate has a spread KPI', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const spread = section('Spread')
    expect(within(spread).getByText(`KPI: at most 40.0 bps at $10K.`)).toBeTruthy()
    expect(within(spread).getByText('Market-maker spread at $10K')).toBeTruthy()
    expect(within(spread).queryByRole('button', { name: 'Show measured spread' })).toBeNull()
    // The KPI is a dashed line on the market maker's spread only, labelled in the right pad.
    await waitFor(() => expect(spread.querySelectorAll('.mult-ref')).toHaveLength(1))
    expect(within(spread).getByText('KPI 40.0')).toBeTruthy()
  })

  it('previews the API badge, copies the snippets and hides the code behind Show code', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const embed = section('Embed badge')
    expect(await within(embed).findByTestId('badge-preview')).toBeTruthy()
    expect(within(embed).getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
    expect(within(embed).getByRole('button', { name: 'Copy Markdown' })).toBeTruthy()
    expect(within(embed).getByText('Cached for 5 minutes.')).toBeTruthy()
    expect(within(embed).queryByText('Badge URL')).toBeNull()
    fireEvent.click(within(embed).getByRole('button', { name: 'Show code' }), { detail: 0 })
    expect(within(embed).getByText('Badge URL')).toBeTruthy()
    expect(
      within(embed).getByText(new RegExp(`/api/mm/${MOCK_MM_OK_ID}/badge\\.svg$`)),
    ).toBeTruthy()
  })

  it('lists the mandate: addresses on Basescan with copy, KPIs, attribution, alerts', async () => {
    renderAt(`/mm/${MOCK_MM_OK_ID}`)
    await chart()
    const about = section('Mandate')
    // Always open from 840 px (CSS); jsdom sees the phone disclosure, so open it.
    fireEvent.click(within(about).getByRole('button', { name: 'Mandate details' }), { detail: 0 })
    const address = within(about).getByRole('link', { name: '0x00000000…0000b1' })
    expect(address.getAttribute('href')).toBe(`https://basescan.org/address/${MOCK_MM_OWNER_SLIP}`)
    expect(
      within(about).getByRole('button', { name: `Copy address ${MOCK_MM_OWNER_SLIP}` }),
    ).toBeTruthy()
    const text = about.textContent ?? ''
    expect(text).toContain(`$50K per side within ±2${NB}%`)
    expect(text).toContain('2 positions')
    expect(text).toContain(`Share of in-band liquidity30${NB}%`)
    expect(text).toContain('After 3 breached samples, no webhook')
    expect(text).toContain('Mock mirror of the demo Slipstream mandate')
    expect(text).toMatch(/Registered\d+.Aug, \d\d:\d\d.UTC, active/)
  })

  it('keeps the breached mandate pool linked from the Mandate list', async () => {
    renderAt(`/mm/${MOCK_MM_BREACHED_ID}`)
    await chart()
    const about = section('Mandate')
    fireEvent.click(within(about).getByRole('button', { name: 'Mandate details' }), { detail: 0 })
    expect(within(about).getByRole('link', { name: 'USDC / AERO' }).getAttribute('href')).toBe(
      poolHref(MOCK_MM_BREACHED_POOL),
    )
  })
})

describe('/mm/:id not found', () => {
  it('says what was not found, shows the id and links to the scorecards', async () => {
    renderAt('/mm/no-such-mandate')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Scorecard not found' }),
    ).toBeTruthy()
    expect(screen.getByText('no-such-mandate')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse scorecards' }).getAttribute('href')).toBe('/mm')
    expect(screen.getByRole('link', { name: 'How scorecards work' }).getAttribute('href')).toBe(
      '/methodology#scorecards',
    )
  })
})
