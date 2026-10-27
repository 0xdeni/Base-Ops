import { createPublicClient, numberToHex } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { erc20Abi } from '../abi/erc20.js'
import { BASE_ADDRESSES } from '../addresses.js'
import {
  addLogs,
  makeLog,
  registerCall,
  registerCallHistory,
  registerCode,
  registerError,
  registerRevert,
  setClock,
} from '../fixtures/builders.js'
import { addr, findCause, newFixture, registerToken, TOKEN_A, TOKEN_D } from '../test/helpers.js'
import { createFixture, createFixtureTransport, FixtureMissError, filterLogs } from './fixture.js'
import { canonicalize, fixtureKey } from './key.js'

const client = (fixture = newFixture()) =>
  createPublicClient({ chain: base, transport: createFixtureTransport(fixture) })

const rawTransport = (fixture = createFixture()) =>
  createFixtureTransport(fixture)({ chain: base, retryCount: 0 })

describe('fixture keys', () => {
  it('normalise hex case, sort object keys and drop undefined values', () => {
    const a = fixtureKey('eth_call', [{ to: '0xABCDEF', data: '0xDEAD', gas: undefined }, 'latest'])
    const b = fixtureKey('eth_call', [{ data: '0xdead', to: '0xabcdef' }, 'latest'])
    expect(a).toBe(b)
    expect(a.startsWith('eth_call:0x')).toBe(true)
    expect(fixtureKey('eth_call', [{ to: '0xabcdef', data: '0xdead' }, 'latest'])).not.toBe(
      fixtureKey('eth_call', [{ to: '0xabcdef', data: '0xdead' }, '0x10']),
    )
  })

  it('render bigints as decimal strings and keep non-hex strings as-is', () => {
    expect(canonicalize({ b: 10n, a: 'Hello', h: '0xAB' })).toBe(
      '{"a":"Hello","b":"10","h":"0xab"}',
    )
    expect(canonicalize([null, true, 1.5])).toBe('[null,true,1.5]')
  })
})

describe('createFixtureTransport', () => {
  it('answers a registered request deterministically', async () => {
    const fixture = newFixture()
    const c1 = client(fixture)
    const c2 = client(fixture)
    const r1 = await c1.readContract({
      address: TOKEN_A.address,
      abi: erc20Abi,
      functionName: 'decimals',
    })
    const r2 = await c2.readContract({
      address: TOKEN_A.address,
      abi: erc20Abi,
      functionName: 'decimals',
    })
    expect(r1).toBe(18)
    expect(r2).toBe(18)
    expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture)
  })

  it('throws a FixtureMissError naming method and params for unknown keys', async () => {
    const t = rawTransport()
    const params = [addr(0x1234), 'latest']
    const wrapped = (await t
      .request({ method: 'eth_getBalance', params } as never)
      .catch((e: unknown) => e)) as { details: string }
    // viem wraps transport throws; the helpful message survives as the `details` of the wrapper.
    expect(wrapped.details).toContain('eth_getBalance')
    expect(wrapped.details).toContain(addr(0x1234))
    const err = findCause(wrapped, (e) => e instanceof FixtureMissError) as FixtureMissError
    expect(err).toBeInstanceOf(FixtureMissError)
    expect(err.method).toBe('eth_getBalance')
    expect(err.params).toEqual(params)
    expect(err.key).toBe(fixtureKey('eth_getBalance', params))
    const viaClient = await client(createFixture())
      .getBalance({ address: addr(0x1234) })
      .catch((e) => e)
    expect(findCause(viaClient, (e) => e instanceof FixtureMissError)).toBeDefined()
  })

  it('replays $error entries as RPC errors with their code', async () => {
    const fixture = createFixture()
    const params = [{ fromBlock: '0x1', toBlock: '0x2', topics: [] }]
    registerError(fixture, 'eth_getLogs', params, { code: -32005, message: 'too many results' })
    const raw = (await rawTransport(fixture)
      .request({ method: 'eth_getLogs', params } as never)
      .catch((e: unknown) => e)) as { code: number; details: string }
    expect(raw.code).toBe(-32005)
    expect(raw.details).toBe('too many results')
    const viaClient = await client(fixture)
      .getLogs({ fromBlock: 1n, toBlock: 2n })
      .catch((e) => e)
    expect(findCause(viaClient, (e) => (e as { code?: number }).code === -32005)).toBeDefined()
  })

  it('decomposes Multicall3 aggregate3 into per-contract answers', async () => {
    const fixture = newFixture()
    const c = client(fixture)
    const calls = [TOKEN_A, TOKEN_D].map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'decimals' as const,
    }))
    const results = await c.multicall({
      contracts: calls,
      allowFailure: false,
      multicallAddress: BASE_ADDRESSES.multicall3,
    })
    expect(results).toEqual([18, 6])
    // A reverting inner call becomes success=false; viem reports it per call.
    registerRevert(fixture, { to: addr(0xee), abi: erc20Abi, functionName: 'decimals' })
    const withRevert = await c.multicall({
      contracts: [...calls, { address: addr(0xee), abi: erc20Abi, functionName: 'decimals' }],
      allowFailure: true,
      multicallAddress: BASE_ADDRESSES.multicall3,
    })
    expect(withRevert.map((r) => r.status)).toEqual(['success', 'success', 'failure'])
    await expect(
      c.multicall({
        contracts: [{ address: addr(0xee), abi: erc20Abi, functionName: 'decimals' }],
        allowFailure: false,
        multicallAddress: BASE_ADDRESSES.multicall3,
      }),
    ).rejects.toThrow()
    // An unregistered inner call fails the whole aggregate3 with the helpful error.
    const missing = await c
      .multicall({
        contracts: [{ address: addr(0xff), abi: erc20Abi, functionName: 'decimals' }],
        allowFailure: true,
        multicallAddress: BASE_ADDRESSES.multicall3,
      })
      .then((r) => r[0]?.error)
    expect(findCause(missing, (e) => e instanceof FixtureMissError)).toBeDefined()
  })

  it('keys calls by block parameter', async () => {
    const fixture = createFixture()
    registerCall(fixture, {
      to: TOKEN_A.address,
      abi: erc20Abi,
      functionName: 'decimals',
      result: 18,
      blocks: [123n],
    })
    const c = client(fixture)
    const read = (blockNumber?: bigint) =>
      c.readContract({
        address: TOKEN_A.address,
        abi: erc20Abi,
        functionName: 'decimals',
        ...(blockNumber === undefined ? {} : { blockNumber }),
      })
    expect(await read(123n)).toBe(18)
    await expect(read()).rejects.toThrow()
  })

  it('synthesises blocks from the clock', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: 1_000n, latestTimestamp: 2_000_000 })
    const c = client(fixture)
    expect(await c.getBlockNumber()).toBe(1_000n)
    const latest = await c.getBlock({ blockTag: 'latest' })
    expect(latest.number).toBe(1_000n)
    expect(latest.timestamp).toBe(2_000_000n)
    const older = await c.getBlock({ blockNumber: 990n })
    expect(older.timestamp).toBe(1_999_980n)
    await expect(c.getBlock({ blockNumber: 1_001n })).rejects.toThrow()
  })

  it('serves eth_getLogs from the log store with address/topic/range filters', async () => {
    const fixture = createFixture()
    registerToken(fixture, TOKEN_A)
    const log = (address: `0x${string}`, blockNumber: bigint, logIndex: number, to = addr(2)) =>
      makeLog({
        address,
        abi: erc20Abi,
        eventName: 'Transfer',
        args: { from: addr(1), to, value: 5n },
        blockNumber,
        logIndex,
      })
    addLogs(fixture, [
      log(TOKEN_A.address, 20n, 1),
      log(TOKEN_A.address, 10n, 3),
      log(TOKEN_A.address, 10n, 2, addr(9)),
      log(TOKEN_D.address, 15n, 0),
    ])
    const all = await client(fixture).getLogs({ fromBlock: 0n, toBlock: 100n })
    expect(all.map((l) => [l.blockNumber, l.logIndex])).toEqual([
      [10n, 2],
      [10n, 3],
      [15n, 0],
      [20n, 1],
    ])
    const byAddress = filterLogs(fixture.logs ?? [], { address: [TOKEN_D.address] })
    expect(byAddress).toHaveLength(1)
    const ranged = filterLogs(fixture.logs ?? [], {
      fromBlock: numberToHex(11n),
      toBlock: numberToHex(20n),
    })
    expect(ranged.map((l) => l.blockNumber)).toEqual([numberToHex(15n), numberToHex(20n)])
    const topic0 = all[0]?.topics[0]
    const toTopic = `0x${addr(9).slice(2).padStart(64, '0')}` as const
    const byTopics = filterLogs(fixture.logs ?? [], { topics: [topic0 ?? null, null, [toTopic]] })
    expect(byTopics.map((l) => l.logIndex)).toEqual([numberToHex(2)])
    const noMatch = filterLogs(fixture.logs ?? [], { topics: [`0x${'1'.repeat(64)}`] })
    expect(noMatch).toEqual([])
  })
})

describe('fixture history', () => {
  it('answers code and calls by the entry in force at the block, alone or in a multicall', async () => {
    const fixture = createFixture()
    setClock(fixture, { latestBlock: 1_000n, latestTimestamp: 1_800_000_000 })
    registerCode(fixture, TOKEN_A.address, 500n, '0x60016002')
    registerCallHistory(fixture, {
      to: TOKEN_A.address,
      abi: erc20Abi,
      functionName: 'totalSupply',
      history: [
        { fromBlock: 500n, result: 7n },
        { fromBlock: 800n, result: 9n },
      ],
    })
    registerCall(fixture, {
      to: TOKEN_A.address,
      abi: erc20Abi,
      functionName: 'totalSupply',
      result: 1n,
      blocks: [900n],
    })
    const c = client(fixture)
    const code = (blockNumber: bigint) => c.getCode({ address: TOKEN_A.address, blockNumber })
    expect([await code(499n), await code(500n), await code(1_000n)]).toEqual([
      undefined,
      '0x60016002',
      '0x60016002',
    ])
    const supply = (blockNumber?: bigint) =>
      c.readContract({
        address: TOKEN_A.address,
        abi: erc20Abi,
        functionName: 'totalSupply',
        blockNumber,
      })
    expect([await supply(500n), await supply(799n), await supply(800n), await supply()]).toEqual([
      7n,
      7n,
      9n,
      9n, // `latest` reads at the clock's latest block
    ])
    expect(await supply(900n)).toBe(1n) // an exact entry wins
    await expect(supply(499n)).rejects.toSatisfy((e) =>
      Boolean(findCause(e, (x) => x instanceof FixtureMissError)),
    )
    const multi = await c.multicall({
      contracts: [600n, 850n].map(() => ({
        address: TOKEN_A.address,
        abi: erc20Abi,
        functionName: 'totalSupply',
      })),
      blockNumber: 850n,
      multicallAddress: BASE_ADDRESSES.multicall3,
    })
    expect(multi.map((r) => r.result)).toEqual([9n, 9n])
  })
})
