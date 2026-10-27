import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'
import type { ApiClient } from '../api/types.js'
import { isInAppHref, routeIntentOf } from './Layout.js'

const NOW = 1_760_000_000
const NB = ' '

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(cleanup)

function renderAt(
  path: string,
  opts: { demo?: boolean; mock?: boolean; dataNow?: number; client?: ApiClient } = {},
) {
  const client = opts.client ?? createMockClient({ now: NOW })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers
      client={client}
      mock={opts.mock ?? opts.demo !== true}
      demo={opts.demo}
      dataNow={opts.dataNow}
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

const nav = () => screen.getByRole('navigation', { name: 'Primary' })
const current = () =>
  within(nav())
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent)

describe('shell landmarks and wayfinding', () => {
  it('starts with a skip link that moves focus to <main>', () => {
    renderAt('/methodology')
    const focusable = document.body.querySelectorAll('a[href], button')
    expect(focusable[0]?.textContent).toBe('Skip to content')
    const main = screen.getByRole('main')
    main.scrollIntoView = vi.fn()
    fireEvent.click(screen.getByRole('link', { name: 'Skip to content' }))
    expect(document.activeElement).toBe(main)
    expect(main.getAttribute('tabindex')).toBe('-1')
  })

  it('links the wordmark home and lists Pools, Gaps, Scorecards and Methodology in one nav', () => {
    renderAt('/gaps')
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1)
    const home = screen.getAllByRole('link', { name: 'Depthwatch home' })
    expect(home.map((a) => a.getAttribute('href'))).toEqual(['/', '/'])
    const links = within(nav()).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Pools', 'Gaps', 'Scorecards', 'Methodology'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/pools',
      '/gaps',
      '/mm',
      '/methodology',
    ])
    expect(current()).toEqual(['Gaps'])
    expect(nav().querySelector('.nav-ind')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('keeps Pools current on pool and token pages and marks nothing on Home', () => {
    renderAt(
      `/pools/${encodeURIComponent('uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224')}`,
    )
    expect(current()).toEqual(['Pools'])
    cleanup()
    renderAt('/tokens/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    expect(current()).toEqual(['Pools'])
    cleanup()
    renderAt('/')
    expect(current()).toEqual([])
  })
})

describe('route changes', () => {
  it('moves focus to <main> after a keyboard navigation, not after a pointer one', async () => {
    renderAt('/methodology')
    const main = screen.getByRole('main')
    fireEvent.click(within(nav()).getByRole('link', { name: 'Gaps' }), { detail: 1 })
    await waitFor(() => expect(current()).toEqual(['Gaps']))
    expect(document.activeElement).not.toBe(main)
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)
    fireEvent.click(within(nav()).getByRole('link', { name: 'Scorecards' }), { detail: 0 })
    await waitFor(() => expect(current()).toEqual(['Scorecards']))
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('animates only pointer clicks on in-app links with the primary button (§4 row 6)', () => {
    const a = document.createElement('a')
    a.setAttribute('href', '/pools')
    const span = document.createElement('span')
    a.append(span)
    document.body.append(a)
    const click = (init: MouseEventInit) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
      Object.defineProperty(e, 'target', { value: span })
      return e
    }
    expect(routeIntentOf(click({ detail: 1 }), false)).toBe('pointer')
    expect(routeIntentOf(click({ detail: 0 }), false)).toBe('keyboard')
    expect(routeIntentOf(click({ detail: 1 }), true)).toBe('instant')
    expect(routeIntentOf(click({ detail: 1, metaKey: true }), false)).toBeNull()
    expect(routeIntentOf(click({ detail: 1, button: 1 }), false)).toBeNull()
    a.setAttribute('target', '_blank')
    expect(routeIntentOf(click({ detail: 1 }), false)).toBeNull()
    a.remove()
    expect(isInAppHref('#/pools')).toBe(true)
    expect(isInAppHref('/AGENTS.md')).toBe(true)
    expect(isInAppHref('//evil.example')).toBe(false)
    expect(isInAppHref('https://github.com/0xdeni/Base-Ops')).toBe(false)
  })
})

describe('freshness (ia-v3 §3.2)', () => {
  it('reads "Updated 2 min ago" against the data clock and opens the details popover', async () => {
    renderAt('/methodology', { demo: true, dataNow: NOW + 120 })
    const button = await screen.findByRole('button', {
      name: `Data freshness: updated 2${NB}min ago`,
    })
    expect(button.textContent).toBe(`Updated 2${NB}min ago`)
    expect(button.getAttribute('title')).toMatch(
      /^Block \d{1,3}(,\d{3})+, [\d,]+ of [\d,]+ pools tracked, /,
    )
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const rows = [...pop.querySelectorAll('dt')].map((dt) => dt.textContent)
    expect(rows).toEqual(['Updated', 'Block', 'Pools tracked', 'Snapshot'])
    expect(within(pop).getByText(/^\d{1,3}(,\d{3})+$/)).toBeTruthy()
    expect(within(pop).getByText(/^[\d,]+ of [\d,]+$/)).toBeTruthy()
    expect(within(pop).getByText(/UTC$/)).toBeTruthy()
    // Escape closes it and returns focus to the trigger.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Data freshness' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('reads "Offline" with the error and a Retry when the health check fails (ST7)', async () => {
    const base = createMockClient({ now: NOW })
    const health = vi.fn(() => Promise.reject(new Error('down')))
    renderAt('/methodology', { client: { ...base, health } })
    const button = await screen.findByRole('button', { name: 'Data freshness: offline' })
    expect(button.textContent).toBe('Offline')
    fireEvent.click(button, { detail: 0 })
    const pop = screen.getByRole('dialog', { name: 'Data freshness' })
    expect(pop.textContent).toContain('Unable to reach the API')
    const calls = health.mock.calls.length
    await act(async () => {
      fireEvent.click(within(pop).getByRole('button', { name: 'Retry' }))
    })
    expect(health.mock.calls.length).toBeGreaterThan(calls)
  })
})

describe('demo line and footer (ia-v3 §3.1, §3.3)', () => {
  it('says "Demo data" once, with the full sentence behind "About the demo"', () => {
    renderAt('/', { demo: true })
    const note = screen.getByRole('note', { name: 'Data source' })
    expect(note.textContent).toMatch(/^Demo data: a synthetic week of Base/)
    fireEvent.click(within(note).getByRole('button', { name: 'About the demo' }), { detail: 1 })
    expect(screen.getByRole('dialog', { name: 'About the demo' }).textContent).toBe(
      'Every number comes from the real pipeline run over a simulated week of Base.',
    )
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText('Data: synthetic demo world')).toBeTruthy()
  })

  it('reads "In-repo mock data" in mock mode and shows no demo line for live data', () => {
    renderAt('/mm')
    expect(screen.getByRole('note', { name: 'Data source' }).textContent).toMatch(
      /^In-repo mock data/,
    )
    expect(within(screen.getByRole('contentinfo')).getByText('Data: in-repo mock')).toBeTruthy()
    cleanup()
    renderAt('/mm', { mock: false })
    expect(screen.queryByRole('note')).toBeNull()
    expect(within(screen.getByRole('contentinfo')).getByText('Data: Base mainnet')).toBeTruthy()
  })

  it('carries the promise and the Methodology, API and GitHub links, without middle dots', () => {
    renderAt('/mm')
    const footer = screen.getByRole('contentinfo')
    expect(
      within(footer).getByText('Open source and read-only. No token, no custody.'),
    ).toBeTruthy()
    const href = (name: string) => within(footer).getByRole('link', { name }).getAttribute('href')
    expect(href('Methodology')).toBe('/methodology')
    expect(href('API')).toBe('/AGENTS.md')
    expect(href('GitHub')).toBe('https://github.com/0xdeni/Base-Ops')
    expect(footer.textContent).not.toContain('·')
  })
})
