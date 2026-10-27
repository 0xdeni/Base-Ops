import { describe, expect, it } from 'vitest'
import {
  computeVolume24hUsd,
  scoringVolumeWindow,
  VOLUME_MAX_AGE_SECONDS,
  volumeWindow,
} from './volume.js'

const H = 1_792_929_600 // 2026-10-25T12:00:00Z, an hour boundary
const HOUR = 3_600
const DAY = 86_400

const bucket = (hourStart: number, volumeUsd: number | null, swapCount = 1) => ({
  hourStart,
  volumeUsd,
  swapCount,
})

describe('volumeWindow', () => {
  it('is the 24 whole hours before the hour that holds the end of the data', () => {
    expect(volumeWindow(H + 37 * 60 + 20)).toEqual({ fromTs: H - DAY, toTs: H })
    expect(volumeWindow(H)).toEqual({ fromTs: H - DAY, toTs: H }) // an end on the boundary
    expect(volumeWindow(H - 1)).toEqual({ fromTs: H - HOUR - DAY, toTs: H - HOUR })
    const { fromTs, toTs } = volumeWindow(H + 1_234)
    expect(toTs - fromTs).toBe(DAY) // exactly 24 h, never 22.6
    expect(volumeWindow(H + 10, 6)).toEqual({ fromTs: H - 6 * HOUR, toTs: H })
    expect(() => volumeWindow(Number.NaN)).toThrow(RangeError)
    expect(() => volumeWindow(H, 0)).toThrow(RangeError)
  })

  it('does not move with the scoring clock, only goes stale after a day', () => {
    const end = H + 22 * 60 // the volume pass ended at 12:22
    const window = { fromTs: H - DAY, toTs: H }
    expect(scoringVolumeWindow(end, end)).toEqual(window)
    expect(scoringVolumeWindow(end, end + 36 * 60)).toEqual(window) // a snapshot in between
    expect(scoringVolumeWindow(end, end + VOLUME_MAX_AGE_SECONDS)).toEqual(window)
    expect(scoringVolumeWindow(end, end + VOLUME_MAX_AGE_SECONDS + 1)).toBeNull()
    expect(scoringVolumeWindow(null, end)).toBeNull()
  })
})

describe('computeVolume24hUsd', () => {
  const window = { fromTs: H - DAY, toTs: H }

  it('sums the buckets that start inside the window, both boundaries half-open', () => {
    const buckets = [
      bucket(H - DAY - HOUR, 1_000_000), // before the window
      bucket(H - DAY, 20_000), // first bucket: whole, counted
      bucket(H - HOUR, 30_000), // last whole hour
      bucket(H, 9_000), // the hour still being filled: not yet
    ]
    expect(computeVolume24hUsd(window, H - DAY, buckets)).toBe(50_000)
  })

  it('is 0 for a covered pool without swaps and null when coverage is short or unknown', () => {
    expect(computeVolume24hUsd(window, H - 2 * DAY, [])).toBe(0)
    expect(computeVolume24hUsd(window, H - DAY + HOUR, [bucket(H - HOUR, 5)])).toBeNull()
    expect(computeVolume24hUsd(window, null, [bucket(H - HOUR, 5)])).toBeNull()
    expect(computeVolume24hUsd(null, H - DAY, [bucket(H - HOUR, 5)])).toBeNull()
  })

  it('is null when a traded hour has no USD value', () => {
    expect(
      computeVolume24hUsd(window, H - DAY, [bucket(H - 2 * HOUR, 5), bucket(H - HOUR, null)]),
    ).toBeNull()
    expect(computeVolume24hUsd(window, H - DAY, [bucket(H - HOUR, null, 0)])).toBe(0)
  })
})
