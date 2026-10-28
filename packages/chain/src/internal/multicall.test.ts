/**
 * `multicallBatched` keeps at most `maxConcurrentMulticalls` aggregate3 requests of one call in
 * flight and returns every result in call order, whatever order the groups are answered in.
 */
import type { Address } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { erc20Abi } from '../abi/erc20.js'
import type { ReaderContext } from './context.js'
import { type ContractCall, multicallBatched } from './multicall.js'

type Answer = { status: 'success'; result: unknown }

interface Pending {
  contracts: readonly ContractCall[]
  resolve: (answers: Answer[]) => void
}

/** A ReaderContext whose `client.multicall` answers only when the test resolves it. */
function deferredContext(maxCallsPerMulticall: number, maxConcurrentMulticalls: number) {
  const pending: Pending[] = []
  let inFlight = 0
  let peak = 0
  const multicall = ({ contracts }: { contracts: readonly ContractCall[] }) =>
    new Promise<Answer[]>((resolve) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      pending.push({
        contracts,
        resolve: (answers) => {
          inFlight--
          resolve(answers)
        },
      })
    })
  const ctx = {
    client: { multicall },
    addresses: { multicall3: '0x00000000000000000000000000000000000000ca' },
    maxCallsPerMulticall,
    maxConcurrentMulticalls,
    onCallRetry: undefined,
    logRetry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  } as unknown as ReaderContext
  return { ctx, pending, peak: () => peak, inFlight: () => inFlight }
}

const token = (i: number): Address => `0x${(i + 1).toString(16).padStart(40, '0')}` as Address
const call = (i: number): ContractCall => ({
  address: token(i),
  abi: erc20Abi,
  functionName: 'decimals',
})

/** Lets every settled promise run its continuations. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('multicallBatched', () => {
  it('keeps at most maxConcurrentMulticalls groups in flight and returns results in call order', async () => {
    const { ctx, pending, peak, inFlight } = deferredContext(2, 4)
    const calls = Array.from({ length: 40 }, (_, i) => call(i))
    const result = multicallBatched(ctx, calls, 123n)
    await flush()
    expect(pending).toHaveLength(4) // 20 groups, 4 sent
    // Answer the open groups newest first, so completion order differs from call order.
    let answered = 0
    while (answered < pending.length) {
      const open = pending.slice(answered)
      for (const group of [...open].reverse())
        group.resolve(
          group.contracts.map((c) => ({ status: 'success', result: `answer ${c.address}` })),
        )
      answered += open.length
      await flush()
      expect(inFlight()).toBeLessThanOrEqual(4)
    }
    expect(pending).toHaveLength(20)
    expect(peak()).toBe(4)
    expect(await result).toEqual(
      calls.map((c) => ({ status: 'success', result: `answer ${c.address}` })),
    )
  })

  it('starts no further group after one fails', async () => {
    const { ctx, pending } = deferredContext(1, 2)
    const failing = {
      ...ctx,
      client: {
        multicall: async ({ contracts }: { contracts: readonly ContractCall[] }) => {
          pending.push({ contracts, resolve: () => {} })
          throw new Error('missing trie node')
        },
      },
    } as unknown as ReaderContext
    await expect(multicallBatched(failing, [call(0), call(1), call(2), call(3)])).rejects.toThrow(
      'missing trie node',
    )
    expect(pending.length).toBeLessThanOrEqual(2)
  })
})
