/**
 * Block timestamps for swaps. Logs carry no timestamp and `eth_getBlockByNumber` cannot be
 * multicalled, so only anchor blocks are fetched: the multiples of a fixed span
 * (`DEFAULT_TIMESTAMP_SPAN`, 10 000 blocks ≈ 5.6 h on Base) and the scan's last block. A swap
 * gets the linear interpolation between the anchors around its block. The span is independent of
 * the `eth_getLogs` chunk size, so a scan in 10-block log chunks still fetches a handful of
 * headers: 24 h of Base (≈ 45 300 blocks) needs at most 7, and a later scan of an overlapping
 * window in the same process reuses the cached multiples.
 *
 * Base produces a block every 2 s (an OP Stack protocol constant), so the interpolation is exact.
 * A segment whose endpoints do not show a whole number of seconds per block (a cadence change
 * inside it, or another chain) is bisected until it does or until its endpoints are adjacent, so
 * an irregular segment costs extra headers but never a wrong hour bucket.
 */
import type { SwapEvent } from '@depthwatch/core'

/** Blocks between two timestamp anchors (≈ 5.6 h at Base's 2 s blocks). */
export const DEFAULT_TIMESTAMP_SPAN = 10_000n

export type TimestampOf = (blockNumber: bigint) => Promise<number>

/** Timestamp of every event: exact at `start` and `end`, linear in between. */
async function fillSegment(
  events: readonly SwapEvent[],
  start: bigint,
  end: bigint,
  timestampOf: TimestampOf,
): Promise<void> {
  const tsStart = await timestampOf(start)
  if (end === start) {
    for (const e of events) e.timestamp = tsStart
    return
  }
  const tsEnd = await timestampOf(end)
  const blocks = end - start
  const seconds = BigInt(tsEnd - tsStart)
  if (seconds % blocks !== 0n && blocks > 1n) {
    const mid = start + blocks / 2n
    const left = events.filter((e) => e.blockNumber <= mid)
    const right = events.filter((e) => e.blockNumber > mid)
    if (left.length > 0) await fillSegment(left, start, mid, timestampOf)
    if (right.length > 0) await fillSegment(right, mid, end, timestampOf)
    return
  }
  for (const e of events)
    e.timestamp = tsStart + Number(((e.blockNumber - start) * seconds) / blocks)
}

/**
 * Sets `timestamp` on every event (blocks ≤ `toBlock`, the newest block the caller may read).
 * Anchors below the scan's first block are real blocks too, so nothing is extrapolated.
 */
export async function fillTimestamps(
  events: readonly SwapEvent[],
  toBlock: bigint,
  span: bigint,
  timestampOf: TimestampOf,
): Promise<void> {
  const segments = new Map<bigint, SwapEvent[]>()
  for (const e of events) {
    const start = (e.blockNumber / span) * span
    const group = segments.get(start)
    if (group === undefined) segments.set(start, [e])
    else group.push(e)
  }
  for (const [start, group] of segments) {
    const end = start + span < toBlock ? start + span : toBlock
    await fillSegment(group, start, end, timestampOf)
  }
}
