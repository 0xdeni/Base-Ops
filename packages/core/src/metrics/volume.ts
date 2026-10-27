/**
 * 24 h USD volume from hourly buckets (docs/METRICS.md, "24 h volume").
 *
 * The window is exactly 24 whole hours: `[H − 24 h, H)` with `H` the start of the hour that holds
 * the last block the volume step read (`dataEndTs`). It is anchored to the data, not to the scoring
 * clock, so a snapshot between `volume` and `score` cannot shorten it; the hour from `H` to
 * `dataEndTs` is still being filled and waits for a later pass. The first bucket is whole because
 * the volume step scans from before it. The total is null when it is not known: no recent volume
 * pass, buckets that do not reach back to the window's start, or a traded hour without a USD value.
 */

import type { VolumeBucket } from '../types.js'

export const VOLUME_WINDOW_HOURS = 24
const HOUR_SECONDS = 3_600
/** A volume pass older than this at scoring time no longer describes the last day: null volume. */
export const VOLUME_MAX_AGE_SECONDS = 24 * HOUR_SECONDS

/** Half-open window of bucket starts: `fromTs ≤ hourStart < toTs` (unix seconds). */
export interface VolumeWindow {
  fromTs: number
  toTs: number
}

/** The `hours` whole hours before the hour that holds `dataEndTs`. */
export function volumeWindow(dataEndTs: number, hours: number = VOLUME_WINDOW_HOURS): VolumeWindow {
  if (!Number.isFinite(dataEndTs)) throw new RangeError(`volumeWindow: invalid end ${dataEndTs}`)
  if (!Number.isInteger(hours) || hours <= 0)
    throw new RangeError(`volumeWindow: invalid hours ${hours}`)
  const toTs = Math.floor(dataEndTs / HOUR_SECONDS) * HOUR_SECONDS
  return { fromTs: toTs - hours * HOUR_SECONDS, toTs }
}

/**
 * The 24 h window to score with at `now`, or null when there is no volume pass (`dataEndTs`
 * null) or the last one ended more than VOLUME_MAX_AGE_SECONDS before `now`.
 */
export function scoringVolumeWindow(dataEndTs: number | null, now: number): VolumeWindow | null {
  if (dataEndTs === null || !Number.isFinite(dataEndTs)) return null
  if (now - dataEndTs > VOLUME_MAX_AGE_SECONDS) return null
  return volumeWindow(dataEndTs)
}

/**
 * `volume24hUsd` of one pool: the sum of `volumeUsd` over its buckets that start inside `window`.
 * `coveredFromTs` is the first hour from which the pool's buckets are complete as of the last
 * volume pass (null when the pool was not part of it). 0 when the buckets cover the window and
 * none of them traded; null when the window is null, the coverage starts after `window.fromTs`, or
 * a traded hour in the window has no USD value.
 */
export function computeVolume24hUsd(
  window: VolumeWindow | null,
  coveredFromTs: number | null,
  buckets: readonly Pick<VolumeBucket, 'hourStart' | 'volumeUsd' | 'swapCount'>[],
): number | null {
  if (window === null || coveredFromTs === null || coveredFromTs > window.fromTs) return null
  let total = 0
  for (const bucket of buckets) {
    if (bucket.hourStart < window.fromTs || bucket.hourStart >= window.toTs) continue
    if (bucket.swapCount === 0) continue
    if (bucket.volumeUsd === null || !Number.isFinite(bucket.volumeUsd)) return null
    total += bucket.volumeUsd
  }
  return total
}
