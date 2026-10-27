import type { SwapEvent } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TIMESTAMP_SPAN, fillTimestamps } from './timestamps.js'

const swapAt = (blockNumber: bigint): SwapEvent => ({
  poolId: 'uniswap-v3:0x01',
  blockNumber,
  logIndex: 0,
  txHash: '0x01',
  amount0: 1n,
  amount1: -1n,
  timestamp: null,
})

/** A header source over `tsOf` that records which blocks were fetched (no cache). */
function headers(tsOf: (block: bigint) => number) {
  const fetched: bigint[] = []
  const timestampOf = async (block: bigint) => {
    fetched.push(block)
    return tsOf(block)
  }
  return { fetched, timestampOf }
}

describe('fillTimestamps', () => {
  it('interpolates exactly on a 2 s cadence from anchors every span blocks', async () => {
    const tsOf = (b: bigint) => 1_700_000_000 + Number(b) * 2
    const { fetched, timestampOf } = headers(tsOf)
    const events = [12_345n, 19_999n, 20_000n, 31_000n, 45_300n].map(swapAt)
    await fillTimestamps(events, 45_300n, DEFAULT_TIMESTAMP_SPAN, timestampOf)
    expect(events.map((e) => e.timestamp)).toEqual(events.map((e) => tsOf(e.blockNumber)))
    // Segments [10 000, 20 000], [20 000, 30 000], [30 000, 40 000] and [40 000, 45 300]
    // (45 300 is the scan's end, the newest block it may read).
    expect(fetched).toEqual([
      10_000n,
      20_000n,
      20_000n,
      30_000n,
      30_000n,
      40_000n,
      40_000n,
      45_300n,
    ])
  })

  it('takes the anchor itself for a swap on a segment start that is also the scan end', async () => {
    const { fetched, timestampOf } = headers((b) => Number(b))
    const events = [swapAt(30_000n)]
    await fillTimestamps(events, 30_000n, 10_000n, timestampOf)
    expect(events[0]?.timestamp).toBe(30_000)
    expect(fetched).toEqual([30_000n])
  })

  it('bisects a segment whose endpoints do not show a whole number of seconds per block', async () => {
    // 2 s blocks up to block 1 000, then 1 s blocks: a cadence change inside one segment.
    const tsOf = (b: bigint) => (b <= 1_000n ? Number(b) * 2 : 2_000 + Number(b - 1_000n))
    const { fetched, timestampOf } = headers(tsOf)
    const blocks = [10n, 999n, 1_000n, 1_001n, 1_500n, 3_999n]
    const events = blocks.map(swapAt)
    await fillTimestamps(events, 4_000n, 4_000n, timestampOf)
    expect(events.map((e) => e.timestamp)).toEqual(blocks.map(tsOf))
    // Linear interpolation over [0, 4 000] alone would put block 1 000 at 1 666 s instead of 2 000.
    expect(fetched.length).toBeGreaterThan(2)
    expect(fetched.length).toBeLessThan(40)
  })

  it('leaves events untouched when there are none', async () => {
    const { fetched, timestampOf } = headers(() => 0)
    await fillTimestamps([], 100n, 10n, timestampOf)
    expect(fetched).toEqual([])
  })
})
