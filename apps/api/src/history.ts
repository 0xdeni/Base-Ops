/**
 * History series for `GET /api/pools/:id/history`.
 *
 * DESIGN.md lists `health` in every history point, but scores are stored only for a pool's latest
 * state. Each point's health is therefore recomputed here with core's `computeHealthScore` from
 * the snapshot's own summary fields, with the persistence component taken over the trailing 24 h
 * of snapshots (the same window the stored score uses).
 */
import {
  computeHealthScore,
  computePersistence,
  type PersistenceSample,
  type PoolSnapshot,
} from '@depthwatch/core'
import { snapshotDepthSides, snapshotSummaryFields } from '@depthwatch/db'
import type { HistoryPoint } from './dto.js'

/** Persistence window feeding the health score's persistence component. */
export const HEALTH_PERSISTENCE_HOURS = 24
export const HEALTH_PERSISTENCE_SECONDS = HEALTH_PERSISTENCE_HOURS * 3600

/**
 * Turns a snapshot series (ascending by timestamp) into history points, emitting the snapshots
 * with `timestamp >= from`. Pass snapshots from `from − HEALTH_PERSISTENCE_SECONDS` onwards so the
 * first emitted points see their trailing persistence samples; the lead-in is never emitted.
 */
export function buildHistoryPoints(
  snapshots: readonly PoolSnapshot[],
  from: number,
): HistoryPoint[] {
  const fields = snapshots.map((snapshot) => snapshotSummaryFields(snapshot))
  const samples: PersistenceSample[] = snapshots.map((snapshot, index) => ({
    timestamp: snapshot.timestamp,
    depthUsd: fields[index]?.depth2Usd ?? null,
  }))
  const points: HistoryPoint[] = []
  let start = 0
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index]
    const summary = fields[index]
    if (!snapshot || !summary) continue
    // Slide the window start forward: computePersistence ignores samples at or before now − 24 h,
    // so dropping them here only saves work.
    const windowStart = snapshot.timestamp - HEALTH_PERSISTENCE_SECONDS
    while (start < index && (samples[start]?.timestamp ?? 0) <= windowStart) start++
    if (snapshot.timestamp < from) continue
    const persistence = computePersistence(
      samples.slice(start, index + 1),
      HEALTH_PERSISTENCE_HOURS,
      snapshot.timestamp,
    )
    const health = computeHealthScore({
      ...snapshotDepthSides(snapshot),
      spread10kBps: summary.spread10kBps,
      ownerTop1Share: summary.ownerTop1Share,
      rangeHhi: snapshot.concentration?.rangeHhi ?? null,
      persistence,
    })
    points.push({
      timestamp: snapshot.timestamp,
      price: snapshot.price,
      depth2Usd: summary.depth2Usd,
      spread10kBps: summary.spread10kBps,
      tvlUsd: snapshot.tvlUsd,
      health: health.total,
    })
  }
  return points
}
