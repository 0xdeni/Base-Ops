/**
 * USD prices from one pass of pool overviews (docs/METRICS.md, "USD prices").
 *
 * Every pool is a price edge token0 ↔ token1 (token1 per token0, human) whose weight is the
 * thinner side of its ±2 % depth: the token1 it takes to push the price up by 2 % against the
 * token0 it takes to push it down by 2 %, both valued in one currency. A pool that is empty on one
 * side of its price (an off-market pool that arbitrage has drained) has weight 0 and is not a
 * route, however deep its other side. Depth comes from core's `computeDepth` on the pool's full
 * state when the snapshot step has read it, otherwise on a state built from the overview: reserves
 * for Aerodrome v2 (exact), and for concentrated pools a *proxy* that assumes the active liquidity
 * holds across the band (no tick data yet). Native ETH (Uniswap v4 currency0 == 0x0) is tied to
 * WETH by a 1:1 edge of unbounded weight. Anchors are the chain's USD stablecoins.
 *
 * `derivePrices` is run twice: first with both sides valued in token1 at the pool's own price, to
 * find a USD price for every reachable token, then with each side valued at its token's USD price
 * from the first pass, so the widest-path comparison is made in one currency.
 */
import type { PoolOverview } from '@depthwatch/chain'
import {
  type Address,
  computeDepth,
  type DepthLevel,
  type DerivedPrice,
  depthToUsd,
  derivePrices,
  midPrice,
  NATIVE_ETH,
  type PoolState,
  type PriceEdge,
  rawToHuman,
} from '@depthwatch/core'
import type { PriceInput } from '@depthwatch/db'

export type PriceMap = Map<Address, DerivedPrice>

export const PRICE_DEPTH_PCT = 2
/** Ticks either side of the current tick over which the proxy state assumes constant liquidity. */
export const PROXY_TICK_SPAN = 2_000
/** Weight of the native ETH ↔ WETH edge (wrapping is 1:1 and unbounded). */
export const WRAP_EDGE_WEIGHT = Number.MAX_SAFE_INTEGER
export const WRAP_EDGE_SOURCE = 'wrap:weth'

export interface PoolPricing {
  view: PoolOverview
  /** Full state when available, otherwise one built from the overview; null when unreadable. */
  state: PoolState | null
  /** True when `state` is the constant-liquidity proxy (tick data not read). */
  proxy: boolean
  /** token1 per token0, human; null when the pool has no usable price. */
  price: number | null
  /** Depth at ±PRICE_DEPTH_PCT on the pool's state. */
  depth: DepthLevel | null
}

/**
 * A PoolState from the overview alone. Aerodrome v2 pools are complete (reserves + fee); for
 * concentrated pools the tick list is unknown, so the state carries no ticks and bounds of
 * ±PROXY_TICK_SPAN around the current tick, which makes the swap walk assume constant liquidity.
 */
export function overviewState(view: PoolOverview): PoolState | null {
  const { pool } = view
  const base = { blockNumber: view.blockNumber, timestamp: 0 }
  switch (pool.kind) {
    case 'constant-product':
      return {
        ...base,
        kind: 'constant-product',
        reserve0: view.reserve0,
        reserve1: view.reserve1,
        feePips: pool.feePips,
      }
    case 'stable-swap':
      return {
        ...base,
        kind: 'stable-swap',
        reserve0: view.reserve0,
        reserve1: view.reserve1,
        decimals0: pool.token0.decimals,
        decimals1: pool.token1.decimals,
        feePips: pool.feePips,
      }
    case 'concentrated': {
      if (view.sqrtPriceX96 === null || view.tick === null || view.liquidity === null) return null
      if (view.sqrtPriceX96 <= 0n) return null
      return {
        ...base,
        kind: 'concentrated',
        sqrtPriceX96: view.sqrtPriceX96,
        tick: view.tick,
        liquidity: view.liquidity,
        feePips: pool.feePips,
        tickSpacing: pool.tickSpacing ?? 1,
        ticks: [],
        tickLowerBound: view.tick - PROXY_TICK_SPAN,
        tickUpperBound: view.tick + PROXY_TICK_SPAN,
      }
    }
  }
}

function usablePrice(price: number): number | null {
  return Number.isFinite(price) && price > 0 ? price : null
}

/** Price and 2 % depth of one pool, from its full state when given. */
export function pricingFor(view: PoolOverview, exact?: PoolState): PoolPricing {
  const state = exact ?? overviewState(view)
  if (state === null) return { view, state: null, proxy: false, price: null, depth: null }
  const { token0, token1 } = view.pool
  const price = usablePrice(midPrice(state, token0.decimals, token1.decimals))
  let depth: DepthLevel | null = null
  if (price !== null) {
    try {
      depth = computeDepth(state, token0.decimals, token1.decimals, [PRICE_DEPTH_PCT])[0] ?? null
    } catch {
      depth = null
    }
  }
  return { view, state, proxy: exact === undefined && state.kind === 'concentrated', price, depth }
}

/** A pool's price edge with its ±PRICE_DEPTH_PCT depth per side, in human units. */
export interface PoolPriceEdge extends PriceEdge {
  /** token1 that pushes the price up by PRICE_DEPTH_PCT (the up side's input). */
  upToken1: number
  /** token0 that pushes the price down by PRICE_DEPTH_PCT (the down side's input). */
  downToken0: number
}

/** A pool edge, or a plain edge without depth sides (the ETH ↔ WETH wrap edge, unbounded weight). */
export type PriceGraphEdge = PoolPriceEdge | PriceEdge

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Human depth per side at ±PRICE_DEPTH_PCT; zero for a side that is empty or unknown. */
export function depthSides(pricing: PoolPricing): { upToken1: number; downToken0: number } {
  if (pricing.depth === null) return { upToken1: 0, downToken0: 0 }
  const { token0, token1 } = pricing.view.pool
  return {
    upToken1: positive(rawToHuman(pricing.depth.up.amountIn, token1.decimals)),
    downToken0: positive(rawToHuman(pricing.depth.down.amountIn, token0.decimals)),
  }
}

/**
 * First-pass edge weight in token1: the thinner side of the ±2 % depth, the down side's token0
 * valued at the pool's own price. 0 when either side is empty or the pool has no price.
 */
export function edgeWeight(pricing: PoolPricing): number {
  if (pricing.price === null) return 0
  const { upToken1, downToken0 } = depthSides(pricing)
  return positive(Math.min(upToken1, downToken0 * pricing.price))
}

/** Second-pass edge weight in USD: the thinner side, each valued at its token's USD price. */
export function usdEdgeWeight(edge: PoolPriceEdge, token0Usd: number, token1Usd: number): number {
  return positive(Math.min(edge.upToken1 * token1Usd, edge.downToken0 * token0Usd))
}

function wrapEdge(wrappedNative: Address): PriceEdge {
  return {
    token0: NATIVE_ETH,
    token1: wrappedNative.toLowerCase() as Address,
    price: 1,
    weight: WRAP_EDGE_WEIGHT,
    source: WRAP_EDGE_SOURCE,
  }
}

/** Edges of every priced pool with depth on both sides, plus the wrap edge when given. */
export function buildPriceEdges(
  pricings: readonly PoolPricing[],
  wrappedNative?: Address,
): PriceGraphEdge[] {
  const edges: PriceGraphEdge[] = []
  for (const pricing of pricings) {
    if (pricing.price === null) continue
    const weight = edgeWeight(pricing)
    if (weight <= 0) continue
    const { pool } = pricing.view
    edges.push({
      token0: pool.token0.address,
      token1: pool.token1.address,
      price: pricing.price,
      weight,
      source: pool.id,
      ...depthSides(pricing),
    })
  }
  if (wrappedNative !== undefined) edges.push(wrapEdge(wrappedNative))
  return edges
}

export function usdOf(prices: ReadonlyMap<Address, DerivedPrice>, address: Address): number | null {
  const entry = prices.get(address.toLowerCase() as Address)
  return entry === undefined ? null : entry.usd
}

export interface ComputePricesOptions {
  /** Full states by pool id (from readState) to replace the overview proxies. */
  states?: ReadonlyMap<string, PoolState>
  /** WETH address: ties native ETH (0x0) to it 1:1. */
  wrappedNative?: Address
}

/** Overviews → pricings → two-pass `derivePrices`. */
export function computePrices(
  views: readonly PoolOverview[],
  anchors: Record<Address, number>,
  opts: ComputePricesOptions = {},
): PriceMap {
  const pricings = views.map((view) => pricingFor(view, opts.states?.get(view.pool.id)))
  return derivePricesTwoPass(buildPriceEdges(pricings, opts.wrappedNative), anchors)
}

function hasSides(edge: PriceGraphEdge): edge is PoolPriceEdge {
  return 'upToken1' in edge && 'downToken0' in edge
}

/**
 * First pass on the token1-valued weights; second pass on `usdEdgeWeight`, each side valued at
 * its token's first-pass USD price. A pool edge whose tokens the first pass could not price is
 * dropped; the wrap edge (no sides) keeps its weight.
 */
export function derivePricesTwoPass(
  edges: readonly PriceGraphEdge[],
  anchors: Record<Address, number>,
): PriceMap {
  const first = derivePrices(edges, anchors)
  const usdEdges: PriceEdge[] = []
  for (const edge of edges) {
    if (!hasSides(edge)) {
      usdEdges.push(edge)
      continue
    }
    const token0Usd = usdOf(first, edge.token0)
    const token1Usd = usdOf(first, edge.token1)
    if (token0Usd === null || token1Usd === null) continue
    usdEdges.push({ ...edge, weight: usdEdgeWeight(edge, token0Usd, token1Usd) })
  }
  return derivePrices(usdEdges, anchors)
}

/** USD value of the 2 % depth (both sides) for ranking pools whose reserves are unknown. */
export function depthUsdFor(
  pricing: PoolPricing,
  prices: ReadonlyMap<Address, DerivedPrice>,
): number | null {
  if (pricing.depth === null) return null
  const { token0, token1 } = pricing.view.pool
  const [level] = depthToUsd(
    [pricing.depth],
    token0,
    token1,
    usdOf(prices, token0.address),
    usdOf(prices, token1.address),
  )
  return level?.totalUsd ?? null
}

/** Rows for `db.prices.replaceAll`, sorted by token for deterministic writes. */
export function priceEntries(prices: ReadonlyMap<Address, DerivedPrice>): PriceInput[] {
  return [...prices.entries()]
    .map(([token, derived]) => ({ token, usd: derived.usd, via: derived.via }))
    .sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0))
}
