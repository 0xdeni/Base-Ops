/**
 * The square field (docs/design/visual-v4.md §5.9.2), as pure functions: one square per pool with
 * depth, its area true to the pool's depth within 2 % (side = √(depth × k)), packed largest first
 * from the bottom left by a skyline packer with a 3 px gutter. `k` is the largest scale at which
 * the packing fits the field. Pools whose square would be under the minimum side are merged into
 * one square whose area is their total; pools with no depth are not drawn, only counted.
 */

export interface FieldPool {
  id: string
  /** Two-sided depth within 2 % of the price, USD; null or 0 is not drawn. */
  depth: number | null
}

/** What a square stands for: one pool, or the pools merged into one square. */
type Stands<P extends FieldPool> = { kind: 'pool'; pool: P } | { kind: 'merged'; pools: P[] }

/** A square before placement: its side, and the USD its area stands for. */
type Item<P extends FieldPool> = { s: number; depth: number } & Stands<P>

export type FieldSquare<P extends FieldPool> = Item<P> & {
  /** Left and top in px from the field's top left corner. */
  x: number
  y: number
}

export interface FieldModel<P extends FieldPool> {
  /** Largest first. */
  squares: FieldSquare<P>[]
  /** px² per USD: every square's area over its depth. */
  k: number
  /** The pools merged into one square, their total and the deepest of them. */
  merged: { count: number; depth: number; max: number } | null
  /** Pools with no depth within 2 % (not drawn). */
  zero: number
  /** USD drawn: every pool with depth, merged ones included. */
  total: number
}

export interface FieldOptions {
  /** The smallest side drawn on its own: 5 px on desktop, 4 on phones. */
  min: number
  /** Space around every square, px. */
  gutter?: number
  /** Halvings of the scale search. */
  steps?: number
}

/**
 * Skyline packing: each size in order takes the left-most run of columns whose highest point is
 * lowest, and raises those columns by the size plus the gutter. Positions are measured from the
 * bottom left (`y` up). A sliding-window maximum keeps each placement linear in the width.
 */
export function skyline(
  sizes: readonly number[],
  W: number,
  gutter: number,
): { x: number; y: number }[] {
  const cols = Math.max(1, Math.floor(W))
  const sky = new Float64Array(cols)
  const out: { x: number; y: number }[] = []
  const deque = new Int32Array(cols)
  for (const size of sizes) {
    const occ = Math.min(cols, Math.ceil(size) + gutter)
    let bestX = 0
    let bestH = Number.POSITIVE_INFINITY
    let head = 0
    let tail = 0
    for (let j = 0; j < cols; j++) {
      while (tail > head && (sky[deque[tail - 1] ?? 0] ?? 0) <= (sky[j] ?? 0)) tail--
      deque[tail++] = j
      if ((deque[head] ?? 0) <= j - occ) head++
      const x = j - occ + 1
      if (x < 0) continue
      const h = sky[deque[head] ?? 0] ?? 0
      if (h < bestH) {
        bestH = h
        bestX = x
      }
    }
    for (let j = bestX; j < bestX + occ; j++) sky[j] = bestH + occ
    out.push({ x: bestX, y: bestH })
  }
  return out
}

interface Packed<P extends FieldPool> {
  squares: FieldSquare<P>[]
  height: number
  fits: boolean
  merged: P[]
}

function packAt<P extends FieldPool>(
  pools: readonly P[],
  k: number,
  W: number,
  H: number,
  min: number,
  gutter: number,
): Packed<P> {
  const big: P[] = []
  const small: P[] = []
  for (const p of pools) (Math.sqrt((p.depth ?? 0) * k) >= min ? big : small).push(p)
  const items: Item<P>[] = big.map((p) => ({
    kind: 'pool' as const,
    pool: p,
    depth: p.depth ?? 0,
    s: Math.sqrt((p.depth ?? 0) * k),
  }))
  if (small.length) {
    const depth = small.reduce((t, p) => t + (p.depth ?? 0), 0)
    items.push({ kind: 'merged' as const, pools: small, depth, s: Math.sqrt(depth * k) })
  }
  items.sort((a, b) => b.s - a.s)
  const at = skyline(
    items.map((i) => i.s),
    W,
    gutter,
  )
  let height = 0
  let wide = false
  const squares = items.map((it, i) => {
    const p = at[i] ?? { x: 0, y: 0 }
    height = Math.max(height, p.y + it.s)
    if (p.x + it.s > W + 1e-6) wide = true
    return { ...it, x: p.x, y: H - p.y - it.s }
  })
  return { squares, height, fits: height <= H && !wide, merged: small }
}

/**
 * Packs `pools` into a `W` × `H` field at the largest scale that fits: a bisection on `k` between
 * 0 and the scale that would fill the field's whole area.
 */
export function squareField<P extends FieldPool>(
  pools: readonly P[],
  W: number,
  H: number,
  { min, gutter = 3, steps = 28 }: FieldOptions,
): FieldModel<P> {
  const drawn = pools
    .filter((p) => p.depth !== null && p.depth > 0)
    .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))
  const zero = pools.length - drawn.length
  const total = drawn.reduce((t, p) => t + (p.depth ?? 0), 0)
  if (!drawn.length || !(W > 0) || !(H > 0) || !(total > 0))
    return { squares: [], k: 0, merged: null, zero, total }
  let lo = 0
  let hi = (W * H) / total
  let best = packAt(drawn, Number.MIN_VALUE, W, H, min, gutter)
  let bestK = 0
  for (let n = 0; n < steps; n++) {
    const mid = (lo + hi) / 2
    const r = packAt(drawn, mid, W, H, min, gutter)
    if (r.fits) {
      best = r
      bestK = mid
      lo = mid
    } else hi = mid
  }
  const m = best.merged
  return {
    squares: best.squares,
    k: bestK,
    merged: m.length
      ? {
          count: m.length,
          depth: m.reduce((t, p) => t + (p.depth ?? 0), 0),
          max: Math.max(...m.map((p) => p.depth ?? 0)),
        }
      : null,
    zero,
    total,
  }
}

/** The index of the square under (`x`, `y`), with 1 px of slack; -1 over a gutter. */
export function squareAt(
  squares: readonly { x: number; y: number; s: number }[],
  x: number,
  y: number,
): number {
  for (let i = 0; i < squares.length; i++) {
    const q = squares[i]
    if (q && x >= q.x - 1 && x <= q.x + q.s + 1 && y >= q.y - 1 && y <= q.y + q.s + 1) return i
  }
  return -1
}

/**
 * The squares the arrow keys step through, in order of depth: rated pools only (the merged
 * square and unrated pools are read by pointer).
 */
export function stepOrder<P extends FieldPool>(
  squares: readonly FieldSquare<P>[],
  rated: (p: P) => boolean,
): number[] {
  const out: number[] = []
  squares.forEach((q, i) => {
    if (q.kind === 'pool' && rated(q.pool)) out.push(i)
  })
  return out
}

/** The next index in `order` from `current` (-1 at rest), clamped at both ends. */
export function step(order: readonly number[], current: number, dir: 1 | -1): number {
  if (!order.length) return -1
  const k = order.indexOf(current)
  if (k < 0) return dir > 0 ? (order[0] ?? -1) : (order[order.length - 1] ?? -1)
  return order[Math.min(order.length - 1, Math.max(0, k + dir))] ?? -1
}
