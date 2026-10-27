/**
 * What every pipeline step receives: the database, the chain reader, the config, a logger and a
 * clock. The clock is injectable so the demo (frozen synthetic chain) and tests window persistence
 * and volume against the chain's time rather than the wall clock.
 */

import type { ChainReader } from '@depthwatch/chain'
import type { Dex } from '@depthwatch/core'
import type { Database } from '@depthwatch/db'
import type { Config } from '../config.js'
import { type Logger, silentLogger } from '../log.js'

export interface PipelineContext {
  db: Database
  chain: ChainReader
  config: Config
  log: Logger
  /** Unix seconds. */
  now: () => number
}

export interface CreatePipelineContextOptions {
  db: Database
  chain: ChainReader
  config: Config
  log?: Logger
  now?: () => number
}

export function createPipelineContext(opts: CreatePipelineContextOptions): PipelineContext {
  return {
    db: opts.db,
    chain: opts.chain,
    config: opts.config,
    log: opts.log ?? silentLogger,
    now: opts.now ?? (() => Math.floor(Date.now() / 1000)),
  }
}

/** sync_state keys used by the pipeline. */
export const syncKeys = {
  discover: (dex: Dex) => `discover:${dex}:lastBlock`,
  /** Block of the last `discover --seed` of the DEX; never read as a log cursor. */
  seed: (dex: Dex) => `seed:${dex}:lastBlock`,
  positions: (poolId: string) => `positions:${poolId}:lastBlock`,
  snapshot: () => 'snapshot:lastBlock',
  /** Head of the last `volume` pass. */
  volume: () => 'volume:lastBlock',
  /** Timestamp of that head: the end of the volume data, which anchors the 24 h window (score.ts). */
  volumeHeadTs: () => 'volume:lastTs',
  /** Last block in the pool's hourly buckets (volume.ts). */
  volumeLastBlock: (poolId: string) => `volume:${poolId}:lastBlock`,
  /** First hour (unix seconds) from which the pool's hourly buckets are complete (volume.ts). */
  volumeFromTs: (poolId: string) => `volume:${poolId}:fromTs`,
} as const

/** Blocks per hour on Base (2 s blocks). */
export const BLOCKS_PER_HOUR = 1_800n
export const HOUR_SECONDS = 3_600
export const DAY_SECONDS = 86_400

/** `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const width = Math.max(1, Math.min(limit, items.length))
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: width }, worker))
  return results
}

export interface Settled<T> {
  ok: T[]
  failed: Array<{ item: string; error: unknown }>
}

/** Per-item try/catch around mapConcurrent: failures are collected instead of aborting the step. */
export async function settleConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  label: (item: T) => string,
  fn: (item: T) => Promise<R>,
): Promise<Settled<R>> {
  type Outcome = { ok: true; value: R } | { ok: false; item: string; error: unknown }
  const out: Settled<R> = { ok: [], failed: [] }
  const results = await mapConcurrent(items, limit, async (item): Promise<Outcome> => {
    try {
      const value = (await fn(item)) as R
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error, item: label(item) }
    }
  })
  for (const result of results) {
    if (result.ok) out.ok.push(result.value)
    else out.failed.push({ item: result.item, error: result.error })
  }
  return out
}
