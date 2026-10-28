import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import type { DexStatsDto, StatsResponse } from '../dto.js'
import { toDexStats } from '../summary.js'

function sumTotals(byDex: DexStatsDto[], medianHealth: number | null): StatsResponse['totals'] {
  const totals = {
    pools: 0,
    tracked: 0,
    scored: 0,
    rated: 0,
    depth2Usd: 0,
    depthKnownPools: 0,
    volume24hUsd: null as number | null,
    medianHealth,
  }
  for (const row of byDex) {
    totals.pools += row.pools
    totals.tracked += row.tracked
    totals.scored += row.scored
    totals.rated += row.rated
    totals.depth2Usd += row.depth2Usd
    totals.depthKnownPools += row.depthKnownPools
    // Unknown stays unknown: only DEXes with a known volume contribute to the total.
    if (row.volume24hUsd !== null)
      totals.volume24hUsd = (totals.volume24hUsd ?? 0) + row.volume24hUsd
  }
  return totals
}

/** `GET /api/stats`: per-dex totals (one row per DEX, constant order) plus the grand total. */
export function statsRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/', (c) => {
    const byDex = ctx.db.scores.statsByDex().map(toDexStats)
    // Per-dex medians cannot be combined, so the overall one is read over every rated pool.
    const body: StatsResponse = {
      byDex,
      totals: sumTotals(byDex, ctx.db.scores.medianRatedHealth()),
    }
    return c.json(body)
  })
  return app
}
