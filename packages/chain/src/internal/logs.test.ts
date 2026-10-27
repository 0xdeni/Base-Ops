/**
 * `fetchLogs` collects any number of logs: a chunk can hold more than the engine takes as spread
 * arguments (about 125 000), on an endpoint without a result cap or after a stated-maximum split.
 */
import { hexToBigInt, numberToHex, type RpcLog, RpcRequestError } from 'viem'
import { describe, expect, it } from 'vitest'
import type { ReaderContext } from './context.js'
import { fetchLogs } from './logs.js'

const MANY = 130_000

const LOG: RpcLog = {
  address: '0x0000000000000000000000000000000000000001',
  blockHash: `0x${'1'.repeat(64)}`,
  blockNumber: numberToHex(1n),
  data: '0x',
  logIndex: '0x0',
  removed: false,
  topics: [],
  transactionHash: `0x${'2'.repeat(64)}`,
  transactionIndex: '0x0',
}

type Range = { fromBlock: `0x${string}`; toBlock: `0x${string}` }

/** A ReaderContext whose logs client answers `answer(fromBlock, toBlock)`. */
function contextFor(answer: (from: bigint, to: bigint) => RpcLog[], logChunkSize: bigint) {
  const ranges: Array<[bigint, bigint]> = []
  const request = async ({ params }: { params: [Range] }) => {
    const from = hexToBigInt(params[0].fromBlock)
    const to = hexToBigInt(params[0].toBlock)
    ranges.push([from, to])
    return answer(from, to)
  }
  const ctx = {
    logsClient: { request },
    logChunkSize,
    minLogRange: 100n,
    logRangeCap: undefined,
    logRetry: {
      retries: 0,
      baseDelayMs: 1,
      maxDelayMs: 1,
      sleep: async () => {},
      onRetry: undefined,
    },
  } as unknown as ReaderContext
  return { ctx, ranges }
}

describe('fetchLogs', () => {
  it('returns every log of chunks larger than a spread call takes', async () => {
    const { ctx, ranges } = contextFor(() => new Array<RpcLog>(MANY).fill(LOG), 10n)
    const logs = await fetchLogs(ctx, {}, 1n, 20n)
    expect(ranges).toEqual([
      [1n, 10n],
      [11n, 20n],
    ])
    expect(logs).toHaveLength(2 * MANY)
  })

  it('returns every log of the spans a stated maximum splits a range into', async () => {
    const tooWide = new RpcRequestError({
      body: {},
      url: 'https://logs.example',
      error: { code: -32000, message: 'exceed maximum block range: 1000' },
    })
    const { ctx, ranges } = contextFor((from, to) => {
      if (to - from + 1n > 1_000n) throw tooWide
      return new Array<RpcLog>(MANY).fill(LOG)
    }, 2_000n)
    const logs = await fetchLogs(ctx, {}, 1n, 2_000n)
    expect(ranges).toEqual([
      [1n, 2_000n],
      [1n, 1_000n],
      [1_001n, 2_000n],
    ])
    expect(logs).toHaveLength(2 * MANY)
  })
})
