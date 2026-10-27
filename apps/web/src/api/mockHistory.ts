/**
 * Deterministic synthetic history for the mock client: a slow sine drift plus seeded noise around
 * the pool's current depth / spread / health / price / TVL, so charts look alive but tests are
 * stable. Shaped exactly like the API's `HistoryResponse`: the window ends at the pool's newest
 * snapshot and every point lies inside `[from, to]`.
 */
import type { HistoryPoint, HistoryResponse, HistoryWindow } from './types.js'

/** FNV-1a 32-bit hash of a string; used to seed per-pool randomness. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Small seeded PRNG (mulberry32) returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface HistorySeed {
  id: string
  /** Null for a pool whose tokens have no USD price. */
  depth2Usd: number | null
  spread10kBps: number | null
  health: number
  price: number
  tvlUsd: number | null
  /** True when the pool has fewer than 3 snapshots: only the last two points are returned. */
  sparse: boolean
}

export const WINDOW_SECONDS: Readonly<Record<HistoryWindow, number>> = {
  '24h': 86_400,
  '7d': 7 * 86_400,
}
const STEP_SEC: Readonly<Record<HistoryWindow, number>> = { '24h': 300, '7d': 1800 }
const POINTS: Readonly<Record<HistoryWindow, number>> = { '24h': 288, '7d': 336 }
const PERIOD: Readonly<Record<HistoryWindow, number>> = { '24h': 23, '7d': 41 }

/** The series ending at `to` (the pool's newest snapshot timestamp). */
export function buildHistory(
  seed: HistorySeed,
  window: HistoryWindow,
  to: number,
): HistoryResponse {
  const from = to - WINDOW_SECONDS[window]
  const stepSec = STEP_SEC[window]
  const count = seed.sparse ? 2 : POINTS[window]
  const rand = mulberry32(fnv1a(`${seed.id}:${window}`))
  const period = PERIOD[window]
  const points: HistoryPoint[] = []
  for (let i = 0; i < count; i++) {
    const timestamp = to - (count - 1 - i) * stepSec
    const drift = Math.sin(i / period)
    const noise = rand() - 0.5
    const depth2Usd =
      seed.depth2Usd === null ? null : seed.depth2Usd * (1 + 0.07 * drift + 0.05 * noise)
    const spread10kBps =
      seed.spread10kBps === null ? null : seed.spread10kBps * (1 - 0.08 * drift + 0.08 * noise)
    const health = Math.min(100, Math.max(0, seed.health + 2.5 * drift + 1.5 * noise))
    const price = seed.price * (1 + 0.012 * Math.sin(i / 37 + 1) + 0.002 * noise)
    const tvlUsd = seed.tvlUsd === null ? null : seed.tvlUsd * (1 + 0.03 * drift + 0.01 * noise)
    points.push({ timestamp, price, depth2Usd, spread10kBps, tvlUsd, health })
  }
  return { window, from, to, points }
}
