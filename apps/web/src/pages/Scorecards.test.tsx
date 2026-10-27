import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { ApiError } from '../api/errors.js'
import {
  createMockClient,
  MOCK_MM_BREACHED_ID,
  MOCK_MM_BREACHED_POOL,
  MOCK_MM_OK_ID,
} from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { poolHref } from '../lib/format.js'
import { PHONE_QUERY } from '../lib/useMediaQuery.js'

const NOW = 1_760_000_000
const NB = ' '

let search = ''
function LocationProbe() {
  search = useLocation().search
  return null
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
})

function renderAt(path: string, client: ApiClient = createMockClient({ now: NOW })) {
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

/** Matches the phone query only, as a 390 px viewport would. */
function phone() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

/** The mandate rows (the shell's nav and footer hold lists too). */
async function rows(): Promise<HTMLElement[]> {
  const list = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('.mml-list')
    if (!el) throw new Error('no mandate list yet')
    return el
  })
  return within(list).getAllByRole('listitem')
}

describe('/mm scorecards list (ia-v3 §4.5)', () => {
  it('answers how many mandates are within their KPIs, under one h1 and one lead', async () => {
    renderAt('/mm')
    expect(screen.getByRole('heading', { level: 1, name: 'Market-maker scorecards' })).toBeTruthy()
    expect(await screen.findByText('1 of 2 mandates is within its KPIs right now.')).toBeTruthy()
    expect(
      screen.getByText(
        'A scorecard checks the depth a market maker promised against what is on chain at every snapshot.',
      ),
    ).toBeTruthy()
    expect(document.querySelector('.mml-caption')?.textContent).toBe('2 mandates')
  })

  it('lists each mandate as one row link with its status word, pool and 7 d uptime bullet', async () => {
    renderAt('/mm')
    const [aero, slip] = await rows()
    if (!aero || !slip) throw new Error('rows missing')
    // API order: both active, so by name.
    const link = within(aero).getByRole('link', { name: /^Demo Markets . Aerodrome AERO\/USDC$/ })
    expect(link.getAttribute('href')).toBe(`/mm/${MOCK_MM_BREACHED_ID}`)
    expect(within(aero).getByText('Breached')).toBeTruthy()
    expect(await within(aero).findByText('Demo Markets on USDC / AERO, Aerodrome v2')).toBeTruthy()
    expect(
      within(aero).getByRole('img', {
        name: `7 day uptime 24${NB}% against a 90${NB}% target`,
      }),
    ).toBeTruthy()
    expect(within(slip).getByRole('link').getAttribute('href')).toBe(`/mm/${MOCK_MM_OK_ID}`)
    expect(within(slip).getByText('Within KPI')).toBeTruthy()
    // Status is shape plus word with no fill: the filled chip lives on the scorecard only (K5).
    expect(document.querySelector('.status-chip')).toBeNull()
  })

  it('adds a 7 d uptime strip per row on desktop, and none on phones', async () => {
    renderAt('/mm')
    expect(await screen.findByRole('img', { name: '6 of 25 samples within KPI' })).toBeTruthy()
    expect(
      await screen.findByRole('img', { name: '80 of 83 samples within KPI, 1 not evaluable' }),
    ).toBeTruthy()
    cleanup()
    phone()
    renderAt('/mm')
    await rows()
    expect(screen.queryByRole('img', { name: /samples within KPI/ })).toBeNull()
  })

  it('filters by mandate state through the URL (?active=, replace)', async () => {
    renderAt('/mm')
    await rows()
    const filter = screen.getByRole('radiogroup', { name: 'Mandates' })
    fireEvent.click(within(filter).getByRole('radio', { name: 'Inactive' }), { detail: 1 })
    expect(search).toBe('?active=false')
    expect(await screen.findByText('No inactive mandates.')).toBeTruthy()
    expect(document.querySelector('.mml-caption')?.textContent).toBe('Showing 0 of 2 mandates')
    // The answer always speaks for every mandate.
    expect(screen.getByText('1 of 2 mandates is within its KPIs right now.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show all mandates' }))
    expect(search).toBe('')
    expect(await rows()).toHaveLength(2)
  })

  it('reads ?active=true on load', async () => {
    renderAt('/mm?active=true')
    expect(await rows()).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Active' }).getAttribute('aria-checked')).toBe('true')
  })

  it('switches to the table view (?view=table) with every v2 column', async () => {
    renderAt('/mm')
    await rows()
    fireEvent.click(screen.getByRole('radio', { name: 'Table' }), { detail: 1 })
    expect(search).toBe('?view=table')
    const table = await screen.findByRole('table', { name: 'Market-maker scorecards' })
    const head = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(head).toEqual([
      'Scorecard',
      'Pool',
      'Status',
      `Uptime 24${NB}h`,
      `7${NB}d`,
      `30${NB}d`,
      'Sell side',
      'Buy side',
      'Spread',
      'Streak',
      'Last sample',
    ])
    const [, aero, slip] = within(table).getAllByRole('row')
    if (!aero || !slip) throw new Error('rows missing')
    expect(
      within(aero).getByRole('link', { name: /^Demo Markets . Aerodrome AERO\/USDC$/ }),
    ).toBeTruthy()
    const pool = await within(aero).findByRole('link', { name: 'USDC / AERO' })
    expect(pool.getAttribute('href')).toBe(poolHref(MOCK_MM_BREACHED_POOL))
    expect(within(aero).getByText('Aerodrome v2, 0.3 %')).toBeTruthy()
    // Both sides below the $25K KPI (marked), the spread within its 40 bps KPI.
    expect(within(aero).getAllByRole('img', { name: 'Below KPI' })).toHaveLength(2)
    expect(within(aero).getAllByText('KPI $25K')).toHaveLength(2)
    expect(within(aero).getByText('KPI 40.0 bps')).toBeTruthy()
    expect(within(aero).getByText('19 breached')).toBeTruthy()
    expect(within(slip).getByText('No KPI')).toBeTruthy()
    expect(within(slip).getByText('58 within KPI')).toBeTruthy()
    expect(within(slip).queryByRole('img', { name: 'Below KPI' })).toBeNull()
    expect(within(slip).getByText('96.4 %')).toBeTruthy()
  })
})

describe('/mm states', () => {
  it('says how to register the first mandate when there is none', async () => {
    const client = { ...createMockClient({ now: NOW }), scorecards: async () => ({ items: [] }) }
    renderAt('/mm', client)
    expect(await screen.findByText('No market-maker mandates are registered yet.')).toBeTruthy()
    expect(screen.getByText('depthwatch mm register')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How scorecards work' }).getAttribute('href')).toBe(
      '/methodology#scorecards',
    )
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('keeps the page usable when the list fails, with a Retry', async () => {
    const client = {
      ...createMockClient({ now: NOW }),
      scorecards: async () => {
        throw new ApiError(500, 'boom')
      },
    }
    renderAt('/mm', client)
    expect(
      await screen.findByText(
        'Unable to load scorecards. Check that the API is running, then retry.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Market-maker scorecards' })).toBeTruthy()
  })
})
