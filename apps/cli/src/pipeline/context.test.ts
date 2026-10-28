/**
 * The concurrency helpers every step reads the chain through, under the stop signal of
 * `depthwatch start`: once it aborts no further item starts, the items in flight settle, and the
 * helper ends with the signal's reason, so a step never goes on to store what it has.
 */
import { describe, expect, it } from 'vitest'
import {
  assertSomethingStored,
  mapConcurrent,
  settleConcurrent,
  throwIfStopped,
} from './context.js'

describe('assertSomethingStored', () => {
  it('is an error only when every item failed and nothing was stored', () => {
    const failed = [
      { item: 'uniswap-v3:0xab', error: 'HTTP 401' },
      { item: 'uniswap-v3:0xcd', error: 'HTTP 401' },
    ]
    expect(() => assertSomethingStored('snapshot', failed, 0)).toThrow(
      'snapshot: every item failed (2), nothing stored; uniswap-v3:0xab: HTTP 401',
    )
    expect(() => assertSomethingStored('snapshot', failed, 1)).not.toThrow()
    expect(() => assertSomethingStored('snapshot', [], 0)).not.toThrow()
  })
})

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('mapConcurrent / settleConcurrent under a stop signal', () => {
  it('keep the input order and settle every item without a signal', async () => {
    const results = await mapConcurrent([3, 1, 2], 2, async (n) => {
      await tick()
      return n * 10
    })
    expect(results).toEqual([30, 10, 20])
    const settled = await settleConcurrent([1, 2, 3], 2, String, async (n) => {
      if (n === 2) throw new Error('two')
      return n
    })
    expect(settled.ok).toEqual([1, 3])
    expect(settled.failed).toEqual([{ item: '2', error: new Error('two') }])
  })

  it('start no further item once the signal aborts and end with its reason', async () => {
    const controller = new AbortController()
    const reason = new Error('stop')
    const started: number[] = []
    const settled = settleConcurrent(
      [1, 2, 3, 4, 5],
      2,
      String,
      async (n) => {
        started.push(n)
        await tick()
        // The stop lands while items 1 and 2 are in flight; both end as the reader would.
        if (n === 1) controller.abort(reason)
        if (controller.signal.aborted) throw new Error(`${n} cut off`)
        return n
      },
      controller.signal,
    )
    await expect(settled).rejects.toBe(reason)
    // Two workers: items 1 and 2 were in flight when the run stopped; 3 to 5 never started.
    expect(started).toEqual([1, 2])
    await expect(mapConcurrent([1, 2], 2, async (n) => n, controller.signal)).rejects.toBe(reason)
  })

  it('throwIfStopped throws the reason once aborted and nothing before', () => {
    const controller = new AbortController()
    expect(() => throwIfStopped({ signal: controller.signal })).not.toThrow()
    expect(() => throwIfStopped({})).not.toThrow()
    controller.abort(new Error('stop'))
    expect(() => throwIfStopped({ signal: controller.signal })).toThrow('stop')
  })
})
