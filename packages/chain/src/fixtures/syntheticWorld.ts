/**
 * The six pools of the synthetic Base world, in discovery order:
 * WETH/USDC v3 500, cbBTC/USDC v3 3000, ETH/USDC v4 500, AERO/USDC Aerodrome v2 volatile,
 * USDC/USDbC Aerodrome v2 stable, WETH/USDC Slipstream tickSpacing 100.
 *
 * Market-maker fixtures (docs/design/scorecards.md §3): both v2 pools have a gauge and
 * `SYNTHETIC_OWNERS[0]` holds 40 % of their LP supply in wallet plus 10 % staked; the Slipstream
 * pool's [-300, 300] position of `SYNTHETIC_OWNERS[1]` is staked in the pool's CLGauge. In the
 * time-varying world both follow the scripted events of syntheticTime.ts (the USDC/AERO holder
 * tops its LP up and pulls it back on a schedule, the Slipstream position dips once).
 */
import { minBigint, type TokenInfo } from '@depthwatch/core'
import { NATIVE_ETH_TOKEN, TOKENS } from '../addresses.js'
import {
  buildConcentrated,
  buildV2,
  type ConcentratedFactors,
  type ConcentratedSpec,
  type PositionTemplate,
  type V2Factors,
  type V2Spec,
  type WorldClock,
} from './syntheticBuild.js'
import { windowActivity } from './syntheticSwaps.js'
import {
  aeroMarketMakerOut,
  assetOf,
  liquidityFactor,
  priceFactor,
  resolveTimeline,
  SYNTHETIC_EVENTS,
  slipstreamMarketMakerDipped,
} from './syntheticTime.js'
import {
  SYNTHETIC_POOL_LABELS as L,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_PRICES,
  type SyntheticOptions,
  type SyntheticPool,
  type SyntheticTimeline,
  type SyntheticWorld,
} from './syntheticTypes.js'

const E18 = 10n ** 18n
const E12 = 10n ** 12n
const { ETH, CBBTC, AERO, USD } = SYNTHETIC_PRICES

/** Liquidity stream of a v2 pool's other LP holders (positions use their template index). */
const V2_OTHERS_STREAM = 63

export type SyntheticPoolSpec =
  | { kind: 'concentrated'; spec: ConcentratedSpec }
  | { kind: 'v2'; spec: V2Spec }

const ts10: readonly PositionTemplate[] = [
  { lower: -2000, upper: 2000, liquidity: 3n * E18, owner: 0 },
  { lower: -300, upper: 300, liquidity: 2n * E18, owner: 1 },
  { lower: -60, upper: 60, liquidity: (15n * E18) / 10n, owner: 2 },
  { lower: 400, upper: 900, liquidity: E18, owner: 0 },
  { lower: -900, upper: -400, liquidity: (8n * E18) / 10n, owner: 3 },
]

/** The pools as data (clock independent); `createdOffset` is measured back from the anchor. */
export const SYNTHETIC_POOL_SPECS: readonly SyntheticPoolSpec[] = Object.freeze([
  {
    kind: 'concentrated',
    spec: {
      label: L.wethUsdcV3,
      variant: 'v3',
      token0: TOKENS.WETH,
      token1: TOKENS.USDC,
      feePips: 500,
      tickSpacing: 10,
      price: ETH,
      createdOffset: 2_000_000n,
      templates: [...ts10],
      firstTokenId: 500_001n,
      activity: { volumeUsd: 8_000_000, swapCount: 120, token0Usd: ETH, token1Usd: USD },
    },
  },
  {
    kind: 'concentrated',
    spec: {
      label: L.cbbtcUsdcV3,
      variant: 'v3',
      token0: TOKENS.USDC,
      token1: TOKENS.CBBTC,
      feePips: 3000,
      tickSpacing: 60,
      price: 1 / CBBTC,
      createdOffset: 1_500_000n,
      templates: [
        { lower: -2400, upper: 2400, liquidity: 4n * E12, owner: 1 },
        { lower: -600, upper: 600, liquidity: (25n * E12) / 10n, owner: 2 },
        { lower: -120, upper: 120, liquidity: (15n * E12) / 10n, owner: 0 },
        { lower: 480, upper: 1200, liquidity: E12, owner: 3 },
      ],
      firstTokenId: 600_001n,
      activity: { volumeUsd: 2_000_000, swapCount: 40, token0Usd: USD, token1Usd: CBBTC },
    },
  },
  {
    kind: 'concentrated',
    spec: {
      label: L.ethUsdcV4,
      variant: 'v4',
      token0: NATIVE_ETH_TOKEN,
      token1: TOKENS.USDC,
      feePips: 500,
      tickSpacing: 10,
      price: ETH,
      createdOffset: 800_000n,
      templates: ts10.map((t, i) => ({
        ...t,
        liquidity: (t.liquidity * 85n) / 100n,
        owner: (i + 1) % 4,
      })),
      firstTokenId: 1_001n,
      activity: { volumeUsd: 6_000_000, swapCount: 100, token0Usd: ETH, token1Usd: USD },
    },
  },
  {
    kind: 'v2',
    spec: {
      label: L.usdcAeroV2,
      token0: TOKENS.USDC,
      token1: TOKENS.AERO,
      stable: false,
      feeBps: 30n,
      reserve0: 1_500_000n * 10n ** 6n,
      reserve1: 1_250_000n * E18,
      createdOffset: 1_800_000n,
      activity: { volumeUsd: 1_500_000, swapCount: 60, token0Usd: USD, token1Usd: AERO },
      holders: [{ owner: 0, walletPct: 40, stakedPct: 10, scripted: 'aeroMarketMaker' }],
    },
  },
  {
    kind: 'v2',
    spec: {
      label: L.usdcUsdbcV2,
      token0: TOKENS.USDC,
      token1: TOKENS.USDBC,
      stable: true,
      feeBps: 5n,
      reserve0: 3_000_000n * 10n ** 6n,
      reserve1: 2_950_000n * 10n ** 6n,
      createdOffset: 1_700_000n,
      activity: { volumeUsd: 300_000, swapCount: 20, token0Usd: USD, token1Usd: USD },
      holders: [{ owner: 0, walletPct: 40, stakedPct: 10 }],
    },
  },
  {
    kind: 'concentrated',
    spec: {
      label: L.wethUsdcSlipstream,
      variant: 'slipstream',
      token0: TOKENS.WETH,
      token1: TOKENS.USDC,
      feePips: 500,
      tickSpacing: 100,
      price: ETH,
      createdOffset: 900_000n,
      templates: [
        { lower: -3000, upper: 3000, liquidity: 5n * E18, owner: 2 },
        { lower: -500, upper: 500, liquidity: 3n * E18, owner: 3 },
        { lower: -100, upper: 200, liquidity: 2n * E18, owner: 0 },
        {
          lower: -300,
          upper: 300,
          liquidity: 2n * E18,
          owner: 1,
          staked: true,
          scripted: 'slipstreamMarketMaker',
        },
      ],
      firstTokenId: 7_001n,
      activity: { volumeUsd: 10_000_000, swapCount: 150, token0Usd: ETH, token1Usd: USD },
    },
  },
])

type TimelineSeed = Pick<SyntheticTimeline, 'seed' | 'anchorTimestamp'>

/** Price multiplier of token1 per token0 during `hour`. */
function pairPriceFactor(
  timeline: TimelineSeed,
  token0: TokenInfo,
  token1: TokenInfo,
  hour: number,
): number {
  const f0 = priceFactor(timeline.seed, assetOf(token0.address), hour)
  const f1 = priceFactor(timeline.seed, assetOf(token1.address), hour)
  return f0 / f1
}

/** A concentrated pool during `hour` of the time-varying world. */
export function concentratedFactorsAt(
  spec: ConcentratedSpec,
  poolIndex: number,
  timeline: TimelineSeed,
  hour: number,
): ConcentratedFactors {
  const { keepPct } = SYNTHETIC_EVENTS.slipstreamMarketMaker
  return {
    price: pairPriceFactor(timeline, spec.token0, spec.token1, hour),
    liquidity: spec.templates.map((t, i) => {
      if (t.scripted !== 'slipstreamMarketMaker')
        return liquidityFactor(timeline.seed, poolIndex, i, hour)
      return slipstreamMarketMakerDipped(timeline.anchorTimestamp, hour) ? keepPct / 100 : 1
    }),
  }
}

/** An Aerodrome v2 pool during `hour` of the time-varying world. */
export function v2FactorsAt(
  spec: V2Spec,
  poolIndex: number,
  timeline: TimelineSeed,
  hour: number,
): V2Factors {
  const { inWalletPct, inStakedPct } = SYNTHETIC_EVENTS.aeroMarketMaker
  const topUp = !aeroMarketMakerOut(timeline.anchorTimestamp, hour)
  return {
    price: pairPriceFactor(timeline, spec.token0, spec.token1, hour),
    others: liquidityFactor(timeline.seed, poolIndex, V2_OTHERS_STREAM, hour),
    holders: spec.holders.map((h) =>
      h.scripted === 'aeroMarketMaker' && topUp
        ? { ...h, walletPct: inWalletPct, stakedPct: inStakedPct }
        : h,
    ),
  }
}

function worldClock(opts: SyntheticOptions): WorldClock {
  const timeline = resolveTimeline(opts)
  const latestBlock = timeline?.epochBlock ?? opts.latestBlock ?? SYNTHETIC_DEFAULTS.latestBlock
  if (latestBlock < 2n) throw new RangeError('syntheticWorld: latestBlock must be ≥ 2')
  return {
    latestBlock,
    latestTimestamp:
      timeline?.epochTimestamp ?? opts.latestTimestamp ?? SYNTHETIC_DEFAULTS.latestTimestamp,
    secondsPerBlock: SYNTHETIC_DEFAULTS.secondsPerBlock,
    swapWindowBlocks: minBigint(latestBlock - 1n, SYNTHETIC_DEFAULTS.swapWindowBlocks),
    timeline,
  }
}

/**
 * The world at `opts`: the static world without an epoch, else the time-varying world's state at
 * the epoch's hour (its activity is the swaps of the 24 h before the epoch).
 */
export function syntheticWorld(opts: SyntheticOptions = {}): SyntheticWorld {
  const clock = worldClock(opts)
  const { timeline } = clock
  const pools: SyntheticPool[] = SYNTHETIC_POOL_SPECS.map((entry, i) => {
    if (timeline === null)
      return entry.kind === 'concentrated'
        ? buildConcentrated(entry.spec, clock)
        : buildV2(entry.spec, clock)
    const hour = timeline.epochHour
    const pool =
      entry.kind === 'concentrated'
        ? buildConcentrated(entry.spec, clock, concentratedFactorsAt(entry.spec, i, timeline, hour))
        : buildV2(entry.spec, clock, v2FactorsAt(entry.spec, i, timeline, hour))
    return { ...pool, ...windowActivity(timeline, i, entry.spec) }
  })
  return { ...clock, pools }
}
