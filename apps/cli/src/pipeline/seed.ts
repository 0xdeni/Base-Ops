/**
 * `discover --seed` (and `run --seed`, `start`): pool discovery without `eth_getLogs`, for an
 * endpoint that cannot serve factory log scans (Alchemy's free tier answers 10-block ranges only).
 * The chain reader asks each DEX for the pools of every pair of the reference tokens and the
 * configured extra tokens (`--seed-token`, DEPTHWATCH_SEED_TOKENS) at the head
 * (`ChainReader.seedPools`, about a dozen multicalls) and finds each new pool's creation block by
 * binary search over archive state (about 26 requests per pool). Pools already in the database
 * keep their stored creation block and cost no search, so a rerun costs only the factory reads.
 *
 * Pools are upserted as the search completes each batch, so a failed or interrupted seed resumes
 * with the pools it had not dated yet; rate-limited requests are retried with backoff, each one
 * logged as a warning. At the end `seed:<dex>:lastBlock` records the seed block of every DEX whose
 * seeder succeeded. A DEX whose factory views failed gets no marker and a warning; its pools are
 * missing, the other DEXes' are stored, and the step then fails naming it, so it is seeded again
 * (under `start`, at the next pass). The log cursors (`discover:<dex>:lastBlock`) are left alone:
 * a later log scan from an endpoint that serves wide ranges still finds every pool outside the
 * seeded pairs.
 */
import type { SeedDexResult } from '@depthwatch/chain'
import type { Address, Dex } from '@depthwatch/core'
import { type PipelineContext, syncKeys } from './context.js'

export interface SeedStepResult {
  blockNumber: bigint
  /** Pools found (all upserted). */
  found: number
  /** Of those, pools the database did not have. */
  added: number
  /** Requests of the creation-block search. */
  searchRequests: number
  /** The DEXes seeded (a failed one makes the step throw after storing these). */
  dexes: SeedDexResult[]
}

export interface SeedStepOptions {
  dexes?: readonly Dex[]
  /** Pools per creation-search batch (default: the chain's DEFAULT_SEED_BATCH). */
  batchSize?: number
}

export async function seedStep(
  ctx: PipelineContext,
  opts: SeedStepOptions = {},
): Promise<SeedStepResult> {
  const { db, chain, log } = ctx
  const dexes = opts.dexes ?? ctx.config.dexes
  const tokens = [
    ...new Set<Address>([
      ...chain.addresses.referenceTokens.map((t) => t.address),
      ...ctx.config.seedTokens,
    ]),
  ]
  log.info('seeding from factory views', {
    dexes: dexes.join(','),
    tokens: tokens.length,
    ...(ctx.config.seedTokens.length > 0 ? { extra: ctx.config.seedTokens.join(',') } : {}),
  })
  let added = 0
  const result = await chain.seedPools({
    dexes,
    tokens,
    knownCreatedAt: (id) => db.pools.get(id)?.createdAtBlock,
    concurrency: ctx.config.concurrency,
    batchSize: opts.batchSize,
    onPools: (pools, progress) => {
      added += pools.filter((pool) => db.pools.get(pool.id) === undefined).length
      db.pools.upsertMany(pools)
      if (progress.total > 0 && progress.done > 0)
        log.info('creation blocks found', {
          pools: `${progress.done}/${progress.total}`,
          requests: progress.requests,
        })
    },
    onSearchRound: (p) =>
      log.debug('creation-block search', {
        round: `${p.round}/${p.rounds}`,
        open: p.open,
        requests: p.requests,
      }),
    onRetry: (event) =>
      log.warn('rpc backoff', {
        reason: event.reason,
        retry: `${event.attempt}/${event.retries}`,
        delayMs: event.delayMs,
        request: event.what,
      }),
  })
  db.transaction(() => {
    for (const d of result.dexes) db.syncState.setBigInt(syncKeys.seed(d.dex), result.blockNumber)
  })
  // Planner statistics for the pools written, so the feeds search the scored set, not every pool.
  db.analyze()
  for (const d of result.dexes)
    log.info('seeded', {
      dex: d.dex,
      candidates: d.candidates,
      found: d.found,
      searched: d.searched,
      total: db.pools.count({ dex: d.dex }),
    })
  for (const f of result.failed) log.warn('seed failed', { dex: f.dex, error: f.error })
  if (result.failed.length > 0)
    throw new Error(
      `seeding failed for ${result.failed.map((f) => f.dex).join(', ')} ` +
        `(${result.pools.length} pools of the other DEXes stored): ${result.failed[0]?.error}`,
    )
  return {
    blockNumber: result.blockNumber,
    found: result.pools.length,
    added,
    searchRequests: result.searchRequests,
    dexes: result.dexes,
  }
}
