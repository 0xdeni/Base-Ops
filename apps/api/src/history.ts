/**
 * History series for `GET /api/pools/:id/history`.
 *
 * DESIGN.md lists `health` in every history point, but scores are stored only for a pool's latest
 * state. Each point's health is therefore recomputed here with core's `computeHealthScore` from
 * the snapshot's health summary (`snapshots.seriesSummaryForPool`: the columns SQLite extracts,
 * no snapshot JSON parsed), with the persistence component taken over the trailing 24 h of
 * snapshots (the same window the stored score uses).
 */
import {
  computeHealthScore,
  computePersistence,
  type PersistenceSample,
  type PoolKind,
} from '@depthwatch/core'
import type { SnapshotHealthSummary } from '@depthwatch/db'
import type { HistoryPoint } from './dto.js'

/** What a history point is built from: a snapshot's health summary (`snapshotHealthSummary`). */
export type HistoryInput = SnapshotHealthSummary

/** Persistence window feeding the health score's persistence component. */
export const HEALTH_PERSISTENCE_HOURS = 24
export const HEALTH_PERSISTENCE_SECONDS = HEALTH_PERSISTENCE_HOURS * 3600

/**
 * Turns a snapshot summary series (ascending by timestamp) of a pool of kind `poolKind` into
 * history points, emitting the snapshots with `timestamp >= from`. Pass snapshots from
 * `from − HEALTH_PERSISTENCE_SECONDS` onwards so the first emitted points see their trailing
 * persistence samples; the lead-in is never emitted.
 */
export function buildHistoryPoints(
  snapshots: readonly HistoryInput[],
  from: number,
  poolKind: PoolKind,
): HistoryPoint[] {
  const samples: PersistenceSample[] = snapshots.map((snapshot) => ({
    timestamp: snapshot.updatedAt,
    depthUsd: snapshot.depth2Usd,
  }))
  const points: HistoryPoint[] = []
  let start = 0
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index]
    if (!snapshot) continue
    // Slide the window start forward: computePersistence ignores samples at or before now − 24 h,
    // so dropping them here only saves work.
    const windowStart = snapshot.updatedAt - HEALTH_PERSISTENCE_SECONDS
    while (start < index && (samples[start]?.timestamp ?? 0) <= windowStart) start++
    if (snapshot.updatedAt < from) continue
    const persistence = computePersistence(
      samples.slice(start, index + 1),
      HEALTH_PERSISTENCE_HOURS,
      snapshot.updatedAt,
    )
    const health = computeHealthScore({
      depth2UpUsd: snapshot.depth2UpUsd,
      depth2DownUsd: snapshot.depth2DownUsd,
      spread10kBps: snapshot.spread10kBps,
      ownerTop1Share: snapshot.ownerTop1Share,
      ownerCoverage: snapshot.ownerCoverage,
      rangeHhi: snapshot.rangeHhi,
      poolKind,
      persistence,
    })
    points.push({
      timestamp: snapshot.updatedAt,
      price: snapshot.price,
      depth2Usd: snapshot.depth2Usd,
      spread10kBps: snapshot.spread10kBps,
      tvlUsd: snapshot.tvlUsd,
      health: health.total,
    })
  }
  return points
}
