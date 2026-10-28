/**
 * Seeds of the mock API. `../mock/pools.json` holds human numbers (USD depth, bps spreads); this
 * module turns them into the exact wire DTOs, scoring them with core's real `computeHealthScore`
 * / `computeGap` so the mock never disagrees with docs/METRICS.md.
 */
import type {
  Address,
  ConcentrationMetrics,
  DepthLevelUsd,
  Dex,
  GapMetrics,
  HealthScore,
  Hex,
  PersistenceMetrics,
  PoolKind,
  SpreadPoint,
  TokenInfo,
} from '@depthwatch/core'
import {
  computeGap,
  computeHealthScore,
  isStaleQuote,
  poolOwnerTop1Share,
  priceDeviationBps,
} from '@depthwatch/core'
import poolsJson from '../mock/pools.json'
import tokensJson from '../mock/tokens.json'
import type { DepthLevelDto, PoolMetaDto, PoolSnapshotDto, PoolSummary } from './types.js'

export interface TokenSeed {
  address: string
  name: string
  decimals: number
  usd: number
  via: string[]
}

export interface PoolSeed {
  id: string
  dex: Dex
  kind: PoolKind
  address: string | null
  poolId: string | null
  token0: string
  token1: string
  feePips: number
  tickSpacing: number | null
  stable: boolean
  hooks: string | null
  createdAtBlock: string
  price: number
  tvlUsd: number
  activeLiquidity: string
  /** pct → [upUsd, downUsd] */
  depthUsd: Record<string, number[]>
  /** at $1k / $10k / $100k; null = infeasible */
  spreadBps: Array<number | null>
  /** "pct:side" entries whose target price was not reached. */
  unreached?: string[]
  concentration: Omit<ConcentrationMetrics, 'bandPct'>
  persistence: Record<'24h' | '7d', number[] | null>
  volume24hUsd: number
}

export const TOKENS = tokensJson as Record<string, TokenSeed>
export const SEEDS = poolsJson as unknown as PoolSeed[]
const DEPTH_PCTS = [1, 2, 5] as const
const SPREAD_NOTIONALS = [1_000, 10_000, 100_000] as const
export const LATEST_BLOCK = '36123456'

export function tokenInfo(symbol: string): TokenInfo {
  const seed = TOKENS[symbol]
  if (!seed) throw new Error(`mock: unknown token ${symbol}`)
  return {
    address: seed.address as Address,
    symbol,
    name: seed.name,
    decimals: seed.decimals,
  }
}

/** The token's USD price; null when it has none (an unpriced token seeds `usd: 0`). */
function tokenUsd(symbol: string): number | null {
  const usd = TOKENS[symbol]?.usd ?? 0
  return usd > 0 ? usd : null
}

/** Human amount → raw decimal string without going through Number for the digits. */
export function toRawAmount(human: number, decimals: number): string {
  if (!Number.isFinite(human) || human <= 0) return '0'
  const [whole = '0', frac = ''] = human.toFixed(decimals).split('.')
  const digits = `${whole}${frac.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '')
  return digits
}

/** One mock pool: its seed plus every DTO fragment the endpoints assemble. */
export interface MockPool {
  seed: PoolSeed
  meta: PoolMetaDto
  snapshot: PoolSnapshotDto
  score: HealthScore
  gap: GapMetrics
  persistence24h: PersistenceMetrics
  persistence7d: PersistenceMetrics
  /** The priced sides; null when neither token has a USD price. */
  depth2Usd: number | null
  spread10kBps: number | null
  /** The 24 h volume in USD; null for an unpriced pool. */
  volume24hUsd: number | null
}

function buildMeta(seed: PoolSeed): PoolMetaDto {
  return {
    id: seed.id,
    dex: seed.dex,
    kind: seed.kind,
    address: seed.address as Address | null,
    poolId: seed.poolId as Hex | null,
    token0: tokenInfo(seed.token0),
    token1: tokenInfo(seed.token1),
    feePips: seed.feePips,
    tickSpacing: seed.tickSpacing,
    stable: seed.stable,
    hooks: seed.hooks as Address | null,
    createdAtBlock: seed.createdAtBlock,
  }
}

function buildDepth(
  seed: PoolSeed,
  meta: PoolMetaDto,
): { depth: DepthLevelDto[]; usd: DepthLevelUsd[] } {
  // The raw amounts need some price: an unpriced token is worth 1 here, and its side stays null.
  const px0 = tokenUsd(seed.token0)
  const px1 = tokenUsd(seed.token1)
  const usd0 = px0 ?? 1
  const usd1 = px1 ?? 1
  const unreached = new Set(seed.unreached ?? [])
  const depth: DepthLevelDto[] = []
  const usd: DepthLevelUsd[] = []
  for (const pct of DEPTH_PCTS) {
    const [upUsd = 0, downUsd = 0] = seed.depthUsd[String(pct)] ?? []
    const slip = pct / 200
    depth.push({
      pct,
      up: {
        amountIn: toRawAmount(upUsd / usd1, meta.token1.decimals),
        amountOut: toRawAmount(upUsd / usd0 / (1 + slip), meta.token0.decimals),
        reached: !unreached.has(`${pct}:up`),
      },
      down: {
        amountIn: toRawAmount(downUsd / usd0, meta.token0.decimals),
        amountOut: toRawAmount((downUsd / usd1) * (1 - slip), meta.token1.decimals),
        reached: !unreached.has(`${pct}:down`),
      },
    })
    // As core's `depthToUsd`: a side of a token with no USD price is null, the total is the known
    // sides.
    const up = px1 === null ? null : upUsd
    const down = px0 === null ? null : downUsd
    usd.push({
      pct,
      upUsd: up,
      downUsd: down,
      totalUsd: up !== null && down !== null ? up + down : (up ?? down),
    })
  }
  return { depth, usd }
}

function buildSpreads(seed: PoolSeed): SpreadPoint[] {
  return SPREAD_NOTIONALS.map((notionalUsd, i) => {
    const bps = seed.spreadBps[i] ?? null
    if (bps === null) {
      return {
        notionalUsd,
        spreadBps: null,
        feasible: false,
        buyAvgPrice: null,
        sellAvgPrice: null,
      }
    }
    return {
      notionalUsd,
      spreadBps: bps,
      feasible: true,
      buyAvgPrice: seed.price * (1 + bps / 20_000),
      sellAvgPrice: seed.price * (1 - bps / 20_000),
    }
  })
}

function buildPersistence(
  windowHours: number,
  pair: number[] | null,
  depth2Usd: number,
): PersistenceMetrics {
  const samples = pair ? windowHours * 12 : 2
  const [stability = null, uptime = null] = pair ?? []
  return {
    windowHours,
    samples,
    depthUsdMedian: depth2Usd,
    depthUsdP10: stability === null ? depth2Usd * 0.98 : depth2Usd * stability,
    depthUsdMin: stability === null ? depth2Usd * 0.97 : depth2Usd * stability * 0.9,
    stability,
    uptime,
  }
}

/** Deterministic small offset per pool id so "updated" times differ between pools. */
export function snapshotAge(id: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 240
}

export function buildPool(seed: PoolSeed, now: number): MockPool {
  const meta = buildMeta(seed)
  const { depth, usd } = buildDepth(seed, meta)
  const spreads = buildSpreads(seed)
  const level2 = usd.find((l) => l.pct === 2)
  const depth2Usd = level2?.totalUsd ?? null
  // A pool with an unpriced token has no TVL or volume in dollars.
  const unpriced = tokenUsd(seed.token0) === null || tokenUsd(seed.token1) === null
  const volume24hUsd = unpriced ? null : seed.volume24hUsd
  const spread10kBps = spreads.find((s) => s.notionalUsd === 10_000)?.spreadBps ?? null
  const concentration: ConcentrationMetrics = { bandPct: 5, ...seed.concentration }
  const persistence24h = buildPersistence(24, seed.persistence['24h'], depth2Usd ?? 0)
  const persistence7d = buildPersistence(168, seed.persistence['7d'], depth2Usd ?? 0)
  const score = computeHealthScore({
    depth2UpUsd: level2?.upUsd ?? null,
    depth2DownUsd: level2?.downUsd ?? null,
    spread10kBps,
    ownerTop1Share: concentration.owners?.top1Share ?? null,
    ownerCoverage: concentration.owners?.coverage ?? null,
    rangeHhi: concentration.rangeHhi,
    poolKind: seed.kind,
    persistence: persistence24h,
  })
  const gap = computeGap(volume24hUsd, depth2Usd)
  const snapshot: PoolSnapshotDto = {
    poolId: seed.id,
    blockNumber: LATEST_BLOCK,
    timestamp: now - snapshotAge(seed.id),
    price: seed.price,
    token0Usd: tokenUsd(seed.token0),
    token1Usd: tokenUsd(seed.token1),
    tvlUsd: unpriced ? null : seed.tvlUsd,
    activeLiquidity: seed.activeLiquidity,
    depth,
    depthUsd: usd,
    spreads,
    concentration,
    priceDeviationBps: priceDeviationBps(seed.price, tokenUsd(seed.token0), tokenUsd(seed.token1)),
    feePips: seed.feePips,
  }
  return {
    seed,
    meta,
    snapshot,
    score,
    gap,
    persistence24h,
    persistence7d,
    depth2Usd,
    spread10kBps,
    volume24hUsd,
  }
}

/**
 * The pools-table row of a mock pool, shaped like the API's `toPoolSummary`: the ±2 % sides are
 * the snapshot's own ±2 % level, never re-derived.
 */
export function summarize(p: MockPool): PoolSummary {
  const level2 = p.snapshot.depthUsd.find((level) => level.pct === 2)
  return {
    pool: p.meta,
    price: p.snapshot.price,
    tvlUsd: p.snapshot.tvlUsd,
    depth2Usd: p.depth2Usd,
    depth2UpUsd: level2?.upUsd ?? null,
    depth2DownUsd: level2?.downUsd ?? null,
    spread10kBps: p.spread10kBps,
    priceDeviationBps: p.snapshot.priceDeviationBps,
    staleQuote: isStaleQuote(p.snapshot.priceDeviationBps),
    health: {
      total: p.score.total,
      grade: p.score.grade,
      rated: p.score.rated,
      unratedReason: p.score.unratedReason,
      concentrationBasis: p.score.concentrationBasis,
    },
    gapScore: p.gap.gapScore,
    volume24hUsd: p.volume24hUsd,
    // As the API stores it: only a share of owners that describe the pool.
    ownerTop1Share: poolOwnerTop1Share(p.snapshot.concentration?.owners),
    updatedAt: p.snapshot.timestamp,
  }
}
