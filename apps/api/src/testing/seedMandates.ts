/**
 * The two mandates of the seed (docs/design/scorecards.md §5 demo and §7 mock mode use the same
 * ids, so a dashboard pointed at a seeded API finds what its mock shows):
 *
 * - `demo-slipstream-weth-usdc` meets its KPIs on the seed's Slipstream pool: status `ok`, with
 *   a three-sample `depthDown` breach five days ago and one unpriced sample six days ago so the
 *   7 d / 30 d uptime is below 100 % while the 24 h uptime is exactly 1. Two extra samples 31
 *   days old sit outside the 30-day summary window.
 * - `demo-aero-usdc-aero` is an Aerodrome v2 LP share far below its `minDepthUsd` on the
 *   AERO/USDC pool: `breached` since its seventh sample, six within-KPI samples before that.
 *
 * `withinKpi` and `breaches` come from core's `evaluateKpis`, so the seed can never disagree
 * with the rules the pipeline applies.
 */
import {
  DEFAULT_ALERT_AFTER_SAMPLES,
  evaluateKpis,
  type Mandate,
  type MmAttribution,
  type MmSample,
} from '@depthwatch/core'
import { fixtureAddress } from '@depthwatch/db'
import { DAY, HOUR } from './constants.js'
import { blockAt, series, wobble } from './timeline.js'
import type { SeedPools } from './universe.js'

export const SEED_MM_OK_ID = 'demo-slipstream-weth-usdc'
export const SEED_MM_BREACHED_ID = 'demo-aero-usdc-aero'
/** The Slipstream mandate's depositor address. */
export const SEED_MM_OWNER_SLIP = fixtureAddress(0xb1)
/** The Aerodrome v2 mandate's LP-holder addresses. */
export const SEED_MM_OWNERS_AERO = [fixtureAddress(0xb2), fixtureAddress(0xb3)] as const

export interface SeedMandates {
  /** `demo-slipstream-weth-usdc`: within KPI (status ok). */
  slipstreamOk: Mandate
  /** `demo-aero-usdc-aero`: below minDepthUsd (status breached). */
  aeroBreached: Mandate
}

/** Index of the single unpriced (unevaluable) sample of the ok mandate. */
export const SEED_MM_UNPRICED_INDEX = 24
/** Indices of the ok mandate's past `depthDown` breach (three consecutive samples). */
export const SEED_MM_OK_BREACH_INDICES = [36, 37, 38] as const
/** Number of leading within-KPI samples of the breached mandate. */
export const SEED_MM_BREACHED_OK_PREFIX = 6

export function seedMandates(now: number, pools: SeedPools): SeedMandates {
  return {
    slipstreamOk: {
      id: SEED_MM_OK_ID,
      name: 'Demo Markets · Slipstream WETH/AERO',
      poolId: pools.wethAeroSlip.id,
      marketMaker: 'Demo Markets',
      addresses: [SEED_MM_OWNER_SLIP],
      kpis: {
        minDepthUsd: 50_000,
        bandPct: 2,
        maxSpreadBps: null,
        spreadNotionalUsd: 10_000,
        targetUptime: 0.95,
      },
      alertWebhookUrl: null,
      alertAfterSamples: DEFAULT_ALERT_AFTER_SAMPLES,
      active: true,
      createdAt: now - 40 * DAY,
      notes: 'Seed mirror of the demo Slipstream mandate: gauge-staked position, depth KPI only.',
    },
    aeroBreached: {
      id: SEED_MM_BREACHED_ID,
      name: 'Demo Markets · Aerodrome AERO/USDC',
      poolId: pools.aeroUsdcV2.id,
      marketMaker: 'Demo Markets',
      addresses: [...SEED_MM_OWNERS_AERO],
      kpis: {
        minDepthUsd: 25_000,
        bandPct: 2,
        maxSpreadBps: 40,
        spreadNotionalUsd: 10_000,
        targetUptime: 0.9,
      },
      alertWebhookUrl: null,
      alertAfterSamples: DEFAULT_ALERT_AFTER_SAMPLES,
      active: true,
      createdAt: now - 3 * DAY,
      notes: null,
    },
  }
}

function sampleFor(mandate: Mandate, now: number, ts: number, attr: MmAttribution): MmSample {
  const { withinKpi, breaches } = evaluateKpis(attr, mandate.kpis)
  return {
    mandateId: mandate.id,
    poolId: mandate.poolId,
    blockNumber: blockAt(now, ts),
    timestamp: ts,
    attribution: attr,
    withinKpi,
    breaches,
  }
}

/** Slipstream positions: ~30 % of the pool's ±2 % weight, both sides well above $50k. */
function slipstreamAttribution(
  index: number,
  variant: 'ok' | 'breach' | 'unpriced',
): MmAttribution {
  const w = wobble(index)
  const poolDepth = 200_000 * w
  if (variant === 'unpriced') {
    return {
      method: 'positions',
      holdings: 2,
      shareOfPool: 0.3,
      depthUpUsd: null,
      depthDownUsd: null,
      poolDepthUpUsd: null,
      poolDepthDownUsd: null,
      spreadBps: null,
      poolSpreadBps: null,
    }
  }
  return {
    method: 'positions',
    holdings: 2,
    shareOfPool: 0.3,
    depthUpUsd: variant === 'breach' ? 60_000 : 60_000 * w,
    depthDownUsd: variant === 'breach' ? 42_000 : 58_000 * w,
    poolDepthUpUsd: poolDepth,
    poolDepthDownUsd: poolDepth,
    spreadBps: 22 * w,
    poolSpreadBps: 15 * w,
  }
}

/** Aerodrome v2 LP share: 12 % of the pool, which is far below the $25k KPI after the prefix. */
function aeroAttribution(index: number, ok: boolean): MmAttribution {
  const w = wobble(index)
  return {
    method: 'lp-share',
    holdings: 2,
    shareOfPool: ok ? 0.4 : 0.12,
    depthUpUsd: (ok ? 31_000 : 9_000) * w,
    depthDownUsd: (ok ? 30_000 : 8_800) * w,
    poolDepthUpUsd: 75_000 * w,
    poolDepthDownUsd: 75_000 * w,
    spreadBps: 36 * w,
    poolSpreadBps: 35 * w,
  }
}

/** Every sample of each seed mandate, ascending, keyed by mandate id. */
export function seedMmSamples(now: number, mandates: SeedMandates): Map<string, MmSample[]> {
  const ok = mandates.slipstreamOk
  const okSamples: MmSample[] = []
  for (const ts of series(now - 31 * DAY, 2 * HOUR, 2 * HOUR)) {
    okSamples.push(sampleFor(ok, now, ts, slipstreamAttribution(okSamples.length, 'ok')))
  }
  series(now, 8 * DAY, 2 * HOUR).forEach((ts, index) => {
    const variant =
      index === SEED_MM_UNPRICED_INDEX
        ? 'unpriced'
        : (SEED_MM_OK_BREACH_INDICES as readonly number[]).includes(index)
          ? 'breach'
          : 'ok'
    okSamples.push(sampleFor(ok, now, ts, slipstreamAttribution(index, variant)))
  })

  const breached = mandates.aeroBreached
  const breachedSamples = series(now, 2 * DAY, 2 * HOUR).map((ts, index) =>
    sampleFor(breached, now, ts, aeroAttribution(index, index < SEED_MM_BREACHED_OK_PREFIX)),
  )

  return new Map([
    [ok.id, okSamples],
    [breached.id, breachedSamples],
  ])
}
