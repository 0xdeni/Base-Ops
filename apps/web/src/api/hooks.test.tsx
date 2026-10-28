/**
 * The health poll follows new data: when `latestSnapshotAt` or `latestScoredAt` moves, the page's
 * other queries refetch in place, so an open tab never shows a newer "Updated … ago" over older
 * numbers, nor keeps the previous pass's scores when a poll lands between a pass's snapshot and
 * its score. The mock and the static build never take a new snapshot and keep their data.
 */
import { QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes, Providers } from '../App.js'
import { usd } from '../lib/format.js'
import { HEALTH_REFETCH_MS } from './hooks.js'
import { createMockClient } from './mock.js'
import type { ApiClient } from './types.js'

const NOW = 1_760_000_000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.sessionStorage.clear()
})

/** The mock world whose snapshot time and Base depth the test moves, counting stats calls. */
function server() {
  const mock = createMockClient({ now: NOW })
  const state = { at: NOW, scoredAt: NOW, depth: 1_000_000, statsCalls: 0 }
  const client: ApiClient = {
    ...mock,
    health: async () => ({
      ...(await mock.health()),
      latestSnapshotAt: state.at,
      latestScoredAt: state.scoredAt,
    }),
    stats: async () => {
      state.statsCalls += 1
      const stats = await mock.stats()
      return { ...stats, totals: { ...stats.totals, depth2Usd: state.depth } }
    },
  }
  return { client, state }
}

function renderHome(client: ApiClient, opts: { mock?: boolean; staticBuild?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <Providers
      client={client}
      mock={opts.mock ?? false}
      staticBuild={opts.staticBuild}
      queryClient={queryClient}
    >
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  )
}

/** The hero figure of Home: Base's depth within ±2 %. */
async function hero(): Promise<string | null | undefined> {
  const h1 = await screen.findByRole('heading', { level: 1 })
  return h1.querySelector('.mega')?.textContent
}

/** Lets one health poll run and everything it starts settle. */
async function nextPoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HEALTH_REFETCH_MS)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000)
  })
}

describe('useHealth: new snapshots refresh the page', () => {
  it('refetches the hero figure when a poll finds a newer snapshot', async () => {
    const { client, state } = server()
    renderHome(client)
    await vi.waitFor(async () => expect(await hero()).toBe(usd(1_000_000)))
    state.at = NOW + 300
    state.depth = 2_500_000
    await nextPoll()
    await vi.waitFor(async () => expect(await hero()).toBe(usd(2_500_000)))
  })

  it('refetches again once the scores of the pass land after its snapshot', async () => {
    const { client, state } = server()
    renderHome(client)
    await vi.waitFor(async () => expect(await hero()).toBe(usd(1_000_000)))
    // The snapshot is stored; the score step has not run yet, so the stats are the old ones.
    state.at = NOW + 300
    await nextPoll()
    const calls = state.statsCalls
    expect(await hero()).toBe(usd(1_000_000))
    // The score step commits: the next poll sees it and the page reads the new totals.
    state.scoredAt = NOW + 330
    state.depth = 2_500_000
    await nextPoll()
    await vi.waitFor(async () => expect(await hero()).toBe(usd(2_500_000)))
    expect(state.statsCalls).toBe(calls + 1)
  })

  it('leaves the data alone while the snapshot is the same', async () => {
    const { client, state } = server()
    renderHome(client)
    await vi.waitFor(async () => expect(await hero()).toBe(usd(1_000_000)))
    const calls = state.statsCalls
    state.depth = 2_500_000
    await nextPoll()
    await nextPoll()
    expect(state.statsCalls).toBe(calls)
    expect(await hero()).toBe(usd(1_000_000))
  })

  it('never refetches for the mock or the static build', async () => {
    for (const opts of [{ mock: true }, { staticBuild: true }]) {
      const { client, state } = server()
      renderHome(client, opts)
      await vi.waitFor(async () => expect(await hero()).toBe(usd(1_000_000)))
      const calls = state.statsCalls
      state.at = NOW + 300
      state.depth = 2_500_000
      await nextPoll()
      expect(state.statsCalls).toBe(calls)
      expect(await hero()).toBe(usd(1_000_000))
      cleanup()
    }
  })
})
