/**
 * Range-keyed snapshot cache. `readPositions` is called once per pool with the same block range,
 * and every pool of a position manager needs the same (pool-agnostic) logs and per-token reads, so
 * they are fetched once per manager and range and filtered per pool. Only the most recent range per
 * manager is kept; a failed fetch is evicted so the next call retries.
 */
import type { Address } from '@depthwatch/core'
import type { BlockRange, RangeSnapshot } from './types.js'

export function rangeSnapshot<T>(
  cache: Map<Address, RangeSnapshot<T>>,
  manager: Address,
  range: BlockRange,
  fetch: () => Promise<T[]>,
): Promise<T[]> {
  const rangeKey = `${range.fromBlock}:${range.toBlock}`
  const cached = cache.get(manager)
  if (cached && cached.rangeKey === rangeKey) return cached.records
  const records = fetch().catch((err: unknown) => {
    if (cache.get(manager)?.records === records) cache.delete(manager)
    throw err
  })
  cache.set(manager, { rangeKey, records })
  return records
}
