/**
 * The Pool page's test harness: renders `/pools/:id` over the mock client, with the ids of the
 * mock pools the tests read and a probe of the URL's query string.
 */
import { QueryClient } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { AppRoutes, Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import type { ApiClient, PoolDetail, PoolMetaDto } from '../../api/types.js'

export const NOW = 1_760_000_000
export const V3_ADDRESS = '0xd0b53d9277642d899df5c87a3966a349a798f224'
export const V3_WETH_USDC = `uniswap-v3:${V3_ADDRESS}`
export const V4_POOL_ID = '0x3f0e1c7b8d2a9f4e6b1c5d8a7e9f2b4c6d8e0f1a2b3c4d5e6f708192a3b4c5d6'
export const V4_ETH_USDC = `uniswap-v4:${V4_POOL_ID}`
/** What the v4 adapter stores as `hooks` for pools without hooks (`address(0)`). */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
/** Mock pools stored as USDC per … with a price below 1 (token1 per token0). */
export const USDC_AERO = 'aerodrome-v2:0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d'
export const USDC_CBBTC = 'uniswap-v3:0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef'
export const HOOKS = '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c40'

/** The query string of the latest render, as the router holds it. */
export const url = { search: '' }
function LocationProbe() {
  url.search = useLocation().search
  return null
}

/** Renders `/pools/:id` (plus `query`), with `patch` applied to the mock's detail. */
export function renderPool(
  id: string,
  {
    patch = {},
    meta = {},
    query = '',
  }: { patch?: Partial<PoolDetail>; meta?: Partial<PoolMetaDto>; query?: string } = {},
) {
  const base = createMockClient({ now: NOW })
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

export function loaded() {
  return screen.findByRole('heading', { level: 1, name: /WETH \/ USDC|ETH \/ USDC/ })
}

/** The facts row: the ink block over the band. */
export function facts(): HTMLElement {
  const el = document.querySelector('.pool-facts')
  if (!(el instanceof HTMLElement)) throw new Error('facts missing')
  return el
}
