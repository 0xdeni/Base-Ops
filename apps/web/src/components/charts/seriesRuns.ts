/**
 * Missing periods are never interpolated (CH5): a series splits into solid runs wherever a value is
 * unknown or two samples sit more than 3 sampling intervals apart, and each break becomes a dashed
 * `text-3` segment between the runs it separates.
 */
import { median } from '../../lib/scale.js'

export interface RunPoint {
  timestamp: number
  v: number
}

export function seriesRuns<T extends { timestamp: number }>(
  points: readonly T[],
  value: (p: T) => number | null,
): { solid: RunPoint[][]; gaps: [RunPoint, RunPoint][] } {
  const steps: number[] = []
  for (let i = 1; i < points.length; i++) {
    const d = (points[i]?.timestamp ?? 0) - (points[i - 1]?.timestamp ?? 0)
    if (d > 0) steps.push(d)
  }
  const interval = median(steps)
  const solid: RunPoint[][] = []
  let run: RunPoint[] = []
  let prevT: number | null = null
  for (const p of points) {
    const v = value(p)
    const tooFar = interval !== null && prevT !== null && p.timestamp - prevT > interval * 3
    if (v === null || !Number.isFinite(v) || tooFar) {
      if (run.length) solid.push(run)
      run = []
    }
    if (v !== null && Number.isFinite(v)) run.push({ timestamp: p.timestamp, v })
    prevT = p.timestamp
  }
  if (run.length) solid.push(run)
  const gaps: [RunPoint, RunPoint][] = []
  for (let i = 1; i < solid.length; i++) {
    const a = solid[i - 1]?.at(-1)
    const b = solid[i]?.[0]
    if (a && b) gaps.push([a, b])
  }
  return { solid, gaps }
}
