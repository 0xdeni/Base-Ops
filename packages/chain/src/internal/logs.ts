/**
 * `eth_getLogs` in fixed-size chunks (`logChunkSize`, default 10 000 blocks), always on the
 * reader's logs client (`ReaderContext.logsClient`), never on the main one. Logs are fetched raw
 * and decoded with viem's `decodeEventLog` (strict) so the same path serves every DEX.
 *
 * Failures are classified by internal/logErrors.ts:
 * - rate-limited / transient: the same range is retried by the reader's one backoff
 *   (./backoff.ts, policy `ReaderContext.logRetry`; `Retry-After` wins when the provider sends one),
 *   then the request fails with `RetryExhaustedError`, which is final: it is never re-read as a
 *   rejected range, so a request that keeps timing out costs one retry budget, not one per half;
 * - range rejected: the reader splits, but never below the floor min(`minLogRange`,
 *   `logChunkSize`). A stated maximum span below the floor (Alchemy free: 10 blocks, against the
 *   CLI's 2 000-block chunks) throws `LogRangeLimitError` at once; a stated maximum at or above it
 *   splits the range into spans of that size and caps later chunks; without a stated maximum the
 *   range is halved, and a range that cannot be halved without going below the floor throws
 *   `LogRangeLimitError` instead of crawling. A chunk size the endpoint accepts (10 on Alchemy's
 *   free tier) is never split, so it works however small it is.
 * Chunks are requested one at a time: a rate-limited public endpoint gains nothing from parallel
 * requests, and in-order chunks keep callers' cursors simple.
 */
import type { Address, Hex } from '@depthwatch/core'
import {
  type Abi,
  type ContractEventName,
  type DecodeEventLogReturnType,
  decodeEventLog,
  encodeEventTopics,
  hexToBigInt,
  hexToNumber,
  numberToHex,
  type RpcLog,
} from 'viem'
import { withBackoff } from './backoff.js'
import { type LogRetryEvent, lowercase, type ReaderContext } from './context.js'
import { classifyLogsError, LogRangeLimitError, RetryExhaustedError } from './logErrors.js'

export type Topics = (Hex | Hex[] | null)[]

export interface LogFilter {
  address?: Address | Address[]
  topics?: Topics
}

export interface DecodedLog<TArgs> {
  args: TArgs
  address: Address
  blockNumber: bigint
  logIndex: number
  txHash: Hex
  topics: Hex[]
}

const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b)

/**
 * `out.push(...items)` one by one: spread arguments overflow the call stack above about 125 000
 * items, which one chunk can hold on an endpoint without a result cap.
 */
function append(out: RpcLog[], items: readonly RpcLog[]): void {
  for (const item of items) out.push(item)
}

/** Progress of one `fetchLogs` scan, for callers that report it (the CLI's volume step). */
export interface LogScanObserver {
  /** After each top-level chunk: its blocks have been served (split ranges included). */
  chunk?: (fromBlock: bigint, toBlock: bigint) => void
  /** Each backoff of one of the scan's requests (also passed to `logRetry.onRetry`). */
  retry?: (event: LogRetryEvent) => void
}

/** One `eth_getLogs` on the logs client, under the reader's one backoff (./backoff.ts). */
function requestLogs(
  ctx: ReaderContext,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  observer: LogScanObserver | undefined,
): Promise<RpcLog[]> {
  const params = {
    ...(filter.address === undefined ? {} : { address: filter.address }),
    ...(filter.topics === undefined ? {} : { topics: filter.topics }),
    fromBlock: numberToHex(fromBlock),
    toBlock: numberToHex(toBlock),
  }
  return withBackoff(
    ctx.logRetry,
    `eth_getLogs blocks ${fromBlock}-${toBlock}`,
    () => ctx.logsClient.request({ method: 'eth_getLogs', params: [params] }),
    ({ reason, attempt, retries, delayMs, providerMessage }) => {
      const logEvent: LogRetryEvent = {
        reason,
        attempt,
        retries,
        delayMs,
        fromBlock,
        toBlock,
        providerMessage,
      }
      ctx.logRetry.onRetry?.(logEvent)
      observer?.retry?.(logEvent)
    },
  )
}

async function fetchRange(
  ctx: ReaderContext,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  observer: LogScanObserver | undefined,
): Promise<RpcLog[]> {
  try {
    return await requestLogs(ctx, filter, fromBlock, toBlock, observer)
  } catch (err) {
    // Only a provider's own answer may split the range; a spent retry budget is final.
    if (err instanceof RetryExhaustedError) throw err
    const info = classifyLogsError(err)
    if (info.kind !== 'range') throw err
    const span = toBlock - fromBlock + 1n
    const floor = minBig(ctx.minLogRange, ctx.logChunkSize)
    const limit = { chunkSize: ctx.logChunkSize, minRange: floor, fromBlock, toBlock }
    const { statedMax, providerMessage } = info
    if (statedMax !== undefined && statedMax < floor)
      throw new LogRangeLimitError({
        reason: 'stated',
        maxRange: statedMax,
        providerMessage,
        ...limit,
      })
    if (statedMax !== undefined && statedMax < span) {
      ctx.logRangeCap = minBig(ctx.logRangeCap ?? statedMax, statedMax)
      const out: RpcLog[] = []
      for (let start = fromBlock; start <= toBlock; start += statedMax)
        append(
          out,
          await fetchRange(ctx, filter, start, minBig(start + statedMax - 1n, toBlock), observer),
        )
      return out
    }
    // Halves of a `span`-block range are span/2 (rounded down) and the rest.
    if (span / 2n < floor)
      throw new LogRangeLimitError({
        reason: 'floor',
        maxRange: undefined,
        providerMessage,
        ...limit,
      })
    const mid = fromBlock + (toBlock - fromBlock) / 2n
    const left = await fetchRange(ctx, filter, fromBlock, mid, observer)
    const right = await fetchRange(ctx, filter, mid + 1n, toBlock, observer)
    return [...left, ...right]
  }
}

export async function fetchLogs(
  ctx: ReaderContext,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  observer?: LogScanObserver,
): Promise<RpcLog[]> {
  if (toBlock < fromBlock) return []
  const out: RpcLog[] = []
  for (let start = fromBlock; start <= toBlock; ) {
    const size = minBig(ctx.logChunkSize, ctx.logRangeCap ?? ctx.logChunkSize)
    const end = minBig(start + size - 1n, toBlock)
    append(out, await fetchRange(ctx, filter, start, end, observer))
    observer?.chunk?.(start, end)
    start = end + 1n
  }
  return out
}

export function eventTopics<const abi extends Abi>(
  abi: abi,
  eventName: ContractEventName<abi>,
): Hex {
  const topics = encodeEventTopics({ abi, eventName } as never)
  const topic0 = topics[0]
  if (topic0 === undefined) throw new Error(`no topic for event ${String(eventName)}`)
  return topic0
}

/** Decode one raw log against `eventName`; returns undefined for logs that do not match (strict). */
export function decodeLog<const abi extends Abi, name extends ContractEventName<abi>>(
  abi: abi,
  eventName: name,
  log: RpcLog,
): DecodedLog<DecodeEventLogReturnType<abi, name>['args']> | undefined {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null)
    return undefined
  try {
    const decoded = decodeEventLog({
      abi,
      eventName,
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    } as never) as DecodeEventLogReturnType<abi, name>
    return {
      args: decoded.args as DecodeEventLogReturnType<abi, name>['args'],
      address: lowercase(log.address),
      blockNumber: hexToBigInt(log.blockNumber),
      logIndex: hexToNumber(log.logIndex),
      txHash: log.transactionHash,
      topics: log.topics as Hex[],
    }
  } catch {
    return undefined
  }
}

export function decodeLogs<const abi extends Abi, name extends ContractEventName<abi>>(
  abi: abi,
  eventName: name,
  logs: readonly RpcLog[],
): DecodedLog<DecodeEventLogReturnType<abi, name>['args']>[] {
  const out: DecodedLog<DecodeEventLogReturnType<abi, name>['args']>[] = []
  for (const log of logs) {
    const d = decodeLog(abi, eventName, log)
    if (d) out.push(d)
  }
  return out
}
