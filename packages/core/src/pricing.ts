/**
 * USD price derivation over the observed pool-price graph (docs/METRICS.md, "USD prices").
 *
 * Widest-path (max-bottleneck) search from the anchors: among all routes from an anchor to a token,
 * pick the one whose weakest edge is strongest, so prices come through the deepest route. Edges
 * are traversed both ways (price inverted). Anchors keep their given price with infinite weight.
 *
 * A pool edge is weighed in USD when the search reaches it from a settled token: the thinner of its
 * two ±2 % depth sides, the settled token's side at that token's USD price and the other side at
 * the price the edge implies. One pass, and the weight does not depend on the tokens' units.
 */

import type { Address, DerivedPrice, PriceEdge } from './types.js'

interface HeapItem {
  weight: number
  seq: number
  token: Address
}

/** Binary max-heap on weight, ties broken by insertion order for determinism. */
class MaxHeap {
  private readonly items: HeapItem[] = []

  get size(): number {
    return this.items.length
  }

  push(item: HeapItem): void {
    this.items.push(item)
    let i = this.items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(parent, i)) break
      this.swap(parent, i)
      i = parent
    }
  }

  pop(): HeapItem | undefined {
    const top = this.items[0]
    const last = this.items.pop()
    if (top === undefined || last === undefined) return top
    if (this.items.length === 0) return top
    this.items[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let best = i
      if (l < this.items.length && this.less(best, l)) best = l
      if (r < this.items.length && this.less(best, r)) best = r
      if (best === i) break
      this.swap(i, best)
      i = best
    }
    return top
  }

  /** True when item a ranks below item b (lower weight, or same weight inserted later). */
  private less(a: number, b: number): boolean {
    const x = this.items[a]
    const y = this.items[b]
    if (x === undefined || y === undefined) return false
    return x.weight < y.weight || (x.weight === y.weight && x.seq > y.seq)
  }

  private swap(a: number, b: number): void {
    const x = this.items[a]
    const y = this.items[b]
    if (x === undefined || y === undefined) return
    this.items[a] = y
    this.items[b] = x
  }
}

interface Adjacent {
  token: Address
  /** USD(neighbour) = USD(this) × factor. */
  factor: number
  /**
   * Depth sides of a pool edge: `own` in this token's units, `other` in the neighbour's. Null for
   * an edge with a fixed weight.
   */
  sides: { own: number; other: number } | null
  /** Weight of an edge without sides. */
  fixed: number
  source: string
}

function positiveFinite(x: number | undefined): x is number {
  return x !== undefined && Number.isFinite(x) && x > 0
}

/** The edge's USD weight seen from a settled token worth `usd`, its neighbour worth `neighbourUsd`. */
function weighAt(edge: Adjacent, usd: number, neighbourUsd: number): number {
  if (edge.sides === null) return edge.fixed
  return Math.min(edge.sides.own * usd, edge.sides.other * neighbourUsd)
}

function lower(address: string): Address {
  return address.toLowerCase() as Address
}

/**
 * Derives USD prices for every token reachable from an anchor. `anchors` maps lowercase token
 * addresses to USD prices. Result: token → { usd, via (edge sources from the anchor), weight
 * (bottleneck along the route in USD, Infinity for anchors) }. Unreachable tokens are absent.
 *
 * An edge with sides (`upToken1`, `downToken0`) weighs `min(up × token1Usd, down × token0Usd)`
 * when it is relaxed; a side that is missing, zero or not finite makes it no route. An edge
 * without sides weighs its fixed `weight`.
 */
export function derivePrices(
  edges: readonly PriceEdge[],
  anchors: Record<Address, number>,
): Map<Address, DerivedPrice> {
  const adjacency = new Map<Address, Adjacent[]>()
  const link = (from: Address, entry: Adjacent) => {
    let list = adjacency.get(from)
    if (list === undefined) {
      list = []
      adjacency.set(from, list)
    }
    list.push(entry)
  }
  for (const edge of edges) {
    if (!positiveFinite(edge.price)) continue
    const sided = edge.upToken1 !== undefined || edge.downToken0 !== undefined
    if (sided && !(positiveFinite(edge.upToken1) && positiveFinite(edge.downToken0))) continue
    if (!sided && !positiveFinite(edge.weight)) continue
    const t0 = lower(edge.token0)
    const t1 = lower(edge.token1)
    if (t0 === t1) continue
    const up = edge.upToken1 ?? 0
    const down = edge.downToken0 ?? 0
    const fixed = edge.weight ?? 0
    // 1 token0 = price token1  ⇒  usd1 = usd0 / price, usd0 = usd1 × price. Seen from token0 its
    // own side is the down side (token0 in), from token1 the up side (token1 in).
    link(t0, {
      token: t1,
      factor: 1 / edge.price,
      sides: sided ? { own: down, other: up } : null,
      fixed,
      source: edge.source,
    })
    link(t1, {
      token: t0,
      factor: edge.price,
      sides: sided ? { own: up, other: down } : null,
      fixed,
      source: edge.source,
    })
  }

  const best = new Map<Address, DerivedPrice>()
  const heap = new MaxHeap()
  let seq = 0
  for (const [address, usd] of Object.entries(anchors)) {
    if (!(usd > 0) || !Number.isFinite(usd)) continue
    const token = lower(address)
    best.set(token, { usd, via: [], weight: Number.POSITIVE_INFINITY })
    heap.push({ weight: Number.POSITIVE_INFINITY, seq: seq++, token })
  }

  const settled = new Set<Address>()
  while (heap.size > 0) {
    const item = heap.pop()
    if (item === undefined) break
    if (settled.has(item.token)) continue
    const current = best.get(item.token)
    if (current === undefined || item.weight < current.weight) continue
    settled.add(item.token)
    for (const edge of adjacency.get(item.token) ?? []) {
      if (settled.has(edge.token)) continue
      const usd = current.usd * edge.factor
      if (!positiveFinite(usd)) continue
      const weight = weighAt(edge, current.usd, usd)
      if (!(weight > 0)) continue
      const bottleneck = Math.min(current.weight, weight)
      const known = best.get(edge.token)
      if (known !== undefined && known.weight >= bottleneck) continue
      best.set(edge.token, { usd, via: [...current.via, edge.source], weight: bottleneck })
      heap.push({ weight: bottleneck, seq: seq++, token: edge.token })
    }
  }
  return best
}
