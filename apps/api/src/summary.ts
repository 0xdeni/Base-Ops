/**
 * Mappers from repository rows to wire DTOs. Everything that leaves the API goes through
 * `toJsonSafe`, so bigints (block numbers, raw amounts) are decimal strings on the wire.
 */
import { type GapMetrics, toJsonSafe } from '@depthwatch/core'
import type { DexStats, ScoredPoolRow } from '@depthwatch/db'
import type { DexStatsDto, GapItem, PoolSummary } from './dto.js'

/** Table row for a scored pool: score fields from `scores`, the rest from its newest snapshot. */
export function toPoolSummary(row: ScoredPoolRow): PoolSummary {
  const { score, latest } = row
  return {
    pool: toJsonSafe(row.pool),
    price: latest?.price ?? null,
    tvlUsd: latest?.tvlUsd ?? null,
    depth2Usd: score.depth2Usd ?? latest?.depth2Usd ?? null,
    depth2UpUsd: latest?.depth2UpUsd ?? null,
    depth2DownUsd: latest?.depth2DownUsd ?? null,
    spread10kBps: latest?.spread10kBps ?? null,
    health: {
      total: score.health.total,
      grade: score.health.grade,
      rated: score.health.rated,
      unratedReason: score.health.unratedReason,
      concentrationBasis: score.health.concentrationBasis,
    },
    gapScore: score.gap.gapScore,
    volume24hUsd: score.volume24hUsd,
    ownerTop1Share: latest?.ownerTop1Share ?? null,
    updatedAt: latest?.updatedAt ?? null,
  }
}

export function toGapItem(row: ScoredPoolRow): GapItem {
  const gap: GapMetrics = {
    volume24hUsd: row.score.gap.volume24hUsd,
    depth2Usd: row.score.gap.depth2Usd,
    turnoverRatio: row.score.gap.turnoverRatio,
    gapScore: row.score.gap.gapScore,
  }
  return { pool: toPoolSummary(row), gap }
}

export function toDexStats(stats: DexStats): DexStatsDto {
  return {
    dex: stats.dex,
    pools: stats.pools,
    tracked: stats.tracked,
    scored: stats.scored,
    rated: stats.rated,
    depth2Usd: stats.depth2UsdSum,
    volume24hUsd: stats.volume24hUsdSum,
    medianHealth: stats.medianHealth,
  }
}
