/**
 * Test harness of the Pools and Gaps screens: the page on its route, a router probe that logs every location, a stand-in nav link, and a
 * `matchMedia` stub for the phone layout (jsdom computes no layout). Imported by tests only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { type ReactNode, useEffect } from 'react'
import {
  Link,
  MemoryRouter,
  type NavigateFunction,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { ApiProvider } from '../../api/context.js'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient } from '../../api/types.js'
import { PHONE_QUERY } from '../../lib/useMediaQuery.js'

export const NOW = 1_760_000_000

export interface Harness {
  /** Every location (`pathname + search`) the router passed through, in order. */
  log: string[]
  navigate: NavigateFunction | null
  client: ApiClient
}

function Probe({ harness }: { harness: Harness }) {
  const location = useLocation()
  harness.navigate = useNavigate()
  useEffect(() => {
    harness.log.push(location.pathname + location.search)
  }, [harness, location])
  return null
}

export function renderPage(
  path: string,
  routePath: string,
  page: ReactNode,
  client: ApiClient = createMockClient({ now: NOW }),
): Harness {
  const harness: Harness = { log: [], navigate: null, client }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client} mock dataNow={NOW}>
        <MemoryRouter initialEntries={[path]}>
          <Probe harness={harness} />
          <nav>
            <Link to={routePath}>Nav link</Link>
          </nav>
          <Routes>
            <Route path={routePath} element={page} />
            <Route path="/pools/:id" element={<p>Pool page</p>} />
            <Route path="/methodology" element={<p>Methodology page</p>} />
          </Routes>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  )
  return harness
}

/** A `matchMedia` where only the phone query matches, while `phone` is true. */
export function stubPhone(phone = true): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: phone && query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

export function unstubPhone(): void {
  Reflect.deleteProperty(window, 'matchMedia')
}
