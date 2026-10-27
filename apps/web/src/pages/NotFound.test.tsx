/**
 * Not found (`*`, ia-v3 §3.5, docs/design/visual-v3.md §5.12, §6.9): the h1 says what was not
 * found, one sentence, the requested path in mono, then "Browse pools" and "See liquidity gaps",
 * in both routers; the v2 shim is lifted while it is mounted.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { App, AppRoutes, Providers } from '../App.js'
import { createMockClient } from '../api/mock.js'

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <Providers client={createMockClient({ now: 1_760_000_000 })} mock queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('Not found', () => {
  it('says what was not found, shows the requested path and two ways on (ST4)', () => {
    renderAt('/pool/uniswap-v3:0xabc')
    const main = screen.getByRole('main')
    const h1 = within(main).getByRole('heading', { level: 1 })
    expect(h1.textContent).toBe('Page not found')
    expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const answer = within(main).getByText(
      'Depthwatch does not track this page, or the link is wrong.',
    )
    expect(answer.className).toContain('answer')
    const id = within(main).getByText('/pool/uniswap-v3:0xabc')
    expect(id.className).toContain('mono')
    const browse = within(main).getByRole('link', { name: 'Browse pools' })
    expect(browse.getAttribute('href')).toBe('/pools')
    expect(browse.className).toContain('secondary')
    const gaps = within(main).getByRole('link', { name: 'See liquidity gaps' })
    expect(gaps.getAttribute('href')).toBe('/gaps')
    expect(gaps.className).toContain('plink')
  })

  it('renders on the v3 page grid', () => {
    renderAt('/nowhere')
    expect(screen.getByRole('heading', { level: 1 }).closest('.wrap.page')).toBeTruthy()
  })

  it('keeps its links inside the hash in the static build and says why a link can miss', async () => {
    window.location.hash = '#/nowhere'
    render(<App client={createMockClient({ now: 1_760_000_000 })} mock={false} staticBuild />)
    const main = screen.getByRole('main')
    expect((await within(main).findByRole('heading', { level: 1 })).textContent).toBe(
      'Page not found',
    )
    expect(main.textContent).toContain('This static copy only holds the data it was exported with.')
    expect(within(main).getByRole('link', { name: 'Browse pools' }).getAttribute('href')).toBe(
      '#/pools',
    )
    expect(within(main).getByText('/nowhere').className).toContain('mono')
  })
})
