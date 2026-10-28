/**
 * Test helpers for Home: the app's routes over the in-repo mock, at a fixed clock, with some
 * endpoints replaceable.
 */
import { QueryClient } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient } from '../../api/types.js'

export const NOW = 1_760_000_000

/** The mock with some endpoints replaced. */
export function withClient(over: Partial<ApiClient> = {}): ApiClient {
  return { ...createMockClient({ now: NOW }), ...over }
}

export function renderHome(client: ApiClient = withClient(), path = '/'): ApiClient {
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

/** The facts row once its content (not its skeleton) is in. */
export function findFacts(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.home-facts')].find(
      (f) => !f.closest('.skel-stack'),
    )
    if (!el) throw new Error('no facts yet')
    return el
  })
}
