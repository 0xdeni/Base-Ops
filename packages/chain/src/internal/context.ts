import type { Address, TokenInfo } from '@depthwatch/core'
import type { PublicClient, Transport } from 'viem'
import type { base } from 'viem/chains'
import type { ChainAddresses } from '../addresses.js'
import type { BackoffEvent } from './backoff.js'
import type { NfpmSnapshot, V4TransferSnapshot } from './types.js'

export type BaseClient = PublicClient<Transport, typeof base>

/** One backoff before retrying a rate-limited or transient `eth_getLogs` request. */
export interface LogRetryEvent {
  reason: 'rate-limit' | 'transient'
  /** 1 for the first retry. */
  attempt: number
  retries: number
  delayMs: number
  fromBlock: bigint
  toBlock: bigint
  providerMessage: string
}

/**
 * Exponential backoff of every rate-limited / transient request (named for `eth_getLogs`, its first
 * user): min(baseDelayMs · 2^n, maxDelayMs), or `Retry-After`. `onRetry` hears `eth_getLogs`
 * backoffs; the main endpoint's go to `ReaderContext.onCallRetry`.
 */
export interface LogRetryPolicy {
  retries: number
  baseDelayMs: number
  maxDelayMs: number
  sleep: (ms: number) => Promise<void>
  onRetry: ((event: LogRetryEvent) => void) | undefined
}

/** Everything an adapter needs; owned by the reader and shared across calls. */
export interface ReaderContext {
  /** Every read but `eth_getLogs`: `eth_call` / multicall, blocks, chain id. */
  client: BaseClient
  /** `eth_getLogs` only (internal/logs.ts); the same client as `client` unless configured. */
  logsClient: BaseClient
  addresses: ChainAddresses
  /** Block span of one `eth_getLogs` request before automatic splitting. */
  logChunkSize: bigint
  /** A rejected range is never halved below this span: the reader throws LogRangeLimitError. */
  minLogRange: bigint
  /** Largest span the logs endpoint said it accepts, learned from its error message. */
  logRangeCap: bigint | undefined
  logRetry: LogRetryPolicy
  /** Each backoff of a main-endpoint request (multicalls, blocks) under `logRetry`'s policy. */
  onCallRetry: ((event: BackoffEvent) => void) | undefined
  /** Upper bound of calls per Multicall3 `aggregate3`. */
  maxCallsPerMulticall: number
  /** `aggregate3` requests one `multicallBatched` call keeps in flight; further groups wait. */
  maxConcurrentMulticalls: number
  tokenCache: Map<Address, TokenInfo>
  timestampCache: Map<bigint, number>
  /**
   * Most recent NFPM snapshot per position manager. `readPositions` is called once per pool with
   * the same block range, and every pool of an NFPM needs the same logs and the same
   * `positions()`/`ownerOf()` reads, so they are fetched once and filtered per pool.
   */
  nfpmCache: Map<Address, NfpmSnapshot>
  /**
   * Same idea for Uniswap v4: PositionManager `Transfer` logs carry no pool, so the tokens
   * transferred in a range are read once per range and filtered per pool.
   */
  v4TransferCache: Map<Address, V4TransferSnapshot>
}

/** address(0): "no gauge" from `Voter.gauges` / `CLPool.gauge()`, mint/burn counterparty in logs. */
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000'

export function lowercase(address: string): Address {
  return address.toLowerCase() as Address
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}
