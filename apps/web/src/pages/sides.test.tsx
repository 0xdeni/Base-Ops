/**
 * One pool, one set of sides (UX2-02, DV2-01): every page keeps the stored sides (token0's, AGENTS.md
 * rule 6), so a market maker cross-checking a scorecard against Home reads the same sell and buy
 * values for the same pool. USDC / AERO is priced below 1, the case that once swapped on Home only.
 */
import { QueryClient } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { createMockClient, MOCK_MM_BREACHED_ID } from '../api/mock.js'
import { MOCK_MM_BREACHED_POOL } from '../api/mockScorecards.js'
import type { ApiClient } from '../api/types.js'
import { dexShort } from '../components/charts/butterflyModel.js'
import { NB, usd } from '../lib/format.js'

const NOW = 1_760_000_000

afterEach(cleanup)

/**
 * The mock client shaped like the demo world: USDC / AERO is the biggest gap (so Home lists it),
 * and the scorecard's latest whole-pool depth is the observatory's own row for the pool, as the
 * pipeline stores both from one snapshot (the demo reads $15.9K and $15.6K).
 */
function consistentClient(): ApiClient {
  const base = createMockClient({ now: NOW })
  return {
    ...base,
    async gaps(query) {
      const res = await base.gaps(query)
      const pool = (await base.pools({ limit: 200 })).items.find(
        (p) => p.pool.id === MOCK_MM_BREACHED_POOL,
      )
      const first = res.items[0]
      if (!pool || !first) return res
      const rest = res.items.filter((g) => g.pool.pool.id !== MOCK_MM_BREACHED_POOL)
      return { ...res, items: [{ pool, gap: { ...first.gap, turnoverRatio: 50.8 } }, ...rest] }
    },
    async scorecard(id) {
      const detail = await base.scorecard(id)
      const { latest, pool } = detail
      if (!latest || !pool) return detail
      return {
        ...detail,
        latest: {
          ...latest,
          attribution: {
            ...latest.attribution,
            poolDepthUpUsd: pool.depth2UpUsd,
            poolDepthDownUsd: pool.depth2DownUsd,
          },
        },
      }
    },
  }
}

function renderAt(client: ApiClient, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers client={client} mock dataNow={NOW} queryClient={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

describe('sides agree across pages (UX2-02)', () => {
  it('Home’s Show data and the scorecard’s Mandate list give USDC / AERO the same sides', async () => {
    const client = consistentClient()
    const pool = (await client.pool(MOCK_MM_BREACHED_POOL)).pool
    expect(`${pool.token0.symbol} / ${pool.token1.symbol}`).toBe('USDC / AERO')
    const summary = (await client.scorecard(MOCK_MM_BREACHED_ID)).pool
    const sell = usd(summary?.depth2DownUsd ?? null)
    const buy = usd(summary?.depth2UpUsd ?? null)
    expect(sell).not.toBe(buy)

    renderAt(client, '/')
    await screen.findByRole('group', { name: /^Base: / })
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }))
    const table = screen.getByRole('table', { name: `Depth within 2${NB}% by pool` })
    const row = within(table)
      .getAllByRole('row')
      .find((tr) => tr.textContent?.startsWith(`USDC / AERO (Aerodrome) ${dexShort(pool.dex)}`))
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent)
    expect(cells.slice(1, 3)).toEqual([sell, buy])
    cleanup()

    renderAt(client, `/mm/${MOCK_MM_BREACHED_ID}`)
    const term = await screen.findByText('Whole-pool depth now')
    await waitFor(() =>
      expect(term.closest('div')?.querySelector('dd')?.textContent).toBe(
        `${sell} sell side, ${buy} buy side`,
      ),
    )
  })
})
