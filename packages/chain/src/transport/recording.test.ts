import { createPublicClient } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { erc20Abi } from '../abi/erc20.js'
import { BASE_ADDRESSES } from '../addresses.js'
import { addLogs, makeLog, registerLogsError } from '../fixtures/builders.js'
import { addr, findCause, newFixture, TOKEN_A, TOKEN_D } from '../test/helpers.js'
import { createFixture, createFixtureTransport, FixtureMissError } from './fixture.js'
import { createRecordingTransport } from './recording.js'

describe('createRecordingTransport', () => {
  it('records live answers under keys the fixture transport replays', async () => {
    const live = newFixture(1_000n, 2_000_000)
    addLogs(live, [
      makeLog({
        address: TOKEN_A.address,
        abi: erc20Abi,
        eventName: 'Transfer',
        args: { from: addr(1), to: addr(2), value: 7n },
        blockNumber: 500n,
        logIndex: 4,
      }),
    ])
    registerLogsError(live, {
      address: TOKEN_A.address,
      topics: [], // viem's getLogs sends an empty topics list when no event is given
      fromBlock: 0n,
      toBlock: 900n,
      message: 'query returned more than 10000 results',
    })
    const sink = createFixture()
    const recorder = createPublicClient({
      chain: base,
      transport: createRecordingTransport(createFixtureTransport(live), sink),
    })
    const run = async (c: typeof recorder) => ({
      decimals: await c.readContract({
        address: TOKEN_A.address,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
      block: await c.getBlock({ blockNumber: 990n }),
      logs: await c.getLogs({ address: TOKEN_A.address, fromBlock: 400n, toBlock: 600n }),
      multi: await c.multicall({
        contracts: [TOKEN_A, TOKEN_D].map((t) => ({
          address: t.address,
          abi: erc20Abi,
          functionName: 'decimals' as const,
        })),
        allowFailure: false,
        multicallAddress: BASE_ADDRESSES.multicall3,
      }),
      error: await c
        .getLogs({ address: TOKEN_A.address, fromBlock: 0n, toBlock: 900n })
        .catch((e) => e),
    })
    const recorded = await run(recorder)
    expect(recorded.decimals).toBe(18)
    expect(recorded.multi).toEqual([18, 6])
    expect(recorded.logs).toHaveLength(1)
    expect(findCause(recorded.error, (e) => (e as { code?: number }).code === -32005)).toBeDefined()

    const keys = Object.keys(sink.calls)
    expect(keys.length).toBe(5)
    expect(keys.every((k) => k.startsWith('eth_'))).toBe(true)
    expect(sink.logs).toBeUndefined()
    expect(sink.clock).toBeUndefined()
    const errorEntries = Object.values(sink.calls).filter(
      (v) => typeof v === 'object' && v !== null && '$error' in v,
    )
    expect(errorEntries).toEqual([
      { $error: { code: -32005, message: 'query returned more than 10000 results' } },
    ])

    // Replay from the sink alone: no log store, no clock, only recorded keys.
    const replayer = createPublicClient({ chain: base, transport: createFixtureTransport(sink) })
    const replayed = await run(replayer)
    expect(replayed.decimals).toBe(recorded.decimals)
    expect(replayed.multi).toEqual(recorded.multi)
    expect(replayed.block.timestamp).toBe(recorded.block.timestamp)
    expect(replayed.block.hash).toBe(recorded.block.hash)
    expect(JSON.stringify(replayed.logs, bigintReplacer)).toBe(
      JSON.stringify(recorded.logs, bigintReplacer),
    )
    expect(findCause(replayed.error, (e) => (e as { code?: number }).code === -32005)).toBeDefined()
    const unknown = await replayer.getBlock({ blockNumber: 991n }).catch((e) => e)
    expect(findCause(unknown, (e) => e instanceof FixtureMissError)).toBeDefined()
  })

  it('does not record transport failures without an RPC code', async () => {
    const sink = createFixture()
    const c = createPublicClient({
      chain: base,
      transport: createRecordingTransport(createFixtureTransport(createFixture()), sink),
    })
    await expect(c.getBlockNumber()).rejects.toThrow()
    expect(Object.keys(sink.calls)).toEqual([])
  })
})

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}
