/**
 * The Gaps table's order. Sorting by Health puts the pools with no grade after the rated ones in
 * both directions, as every other list does (docs/METRICS.md, "Rated and unrated pools"): their
 * totals are not on screen, only the "Not rated" chip is.
 */
import { describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import type { GapItem } from '../../api/types.js'
import { readGapsState, restSentence, sortGaps, writeGapsState } from './gapsModel.js'
import { NOW } from './testing.js'

/** Three real feed items, with `pool.health` replaced and `gap.volume24hUsd` set. */
async function feed(): Promise<GapItem[]> {
  return (await createMockClient({ now: NOW }).gaps({ limit: 100 })).items.slice(0, 5)
}

function withHealth(item: GapItem, total: number, rated: boolean, volume24hUsd: number): GapItem {
  return {
    pool: {
      ...item.pool,
      health: {
        total,
        grade: rated ? 'C' : null,
        rated,
        unratedReason: rated ? null : 'thin',
      },
    },
    gap: { ...item.gap, volume24hUsd },
  }
}

const ids = (items: readonly GapItem[]) => items.map((g) => g.pool.pool.id)

describe('sortGaps by health', () => {
  it('keeps the unrated pools after the rated ones in both directions, each group by total', async () => {
    const [a, b, c, d, e] = await feed()
    if (!a || !b || !c || !d || !e) throw new Error('the mock feed has fewer than five gaps')
    const rated40 = withHealth(a, 40, true, 10)
    const rated70 = withHealth(b, 70, true, 20)
    // unrated pools keep a total, here above every rated one: the total is not a grade
    const unrated95 = withHealth(c, 95, false, 30)
    const unrated20 = withHealth(d, 20, false, 40)
    const rated55 = withHealth(e, 55, true, 50)
    const items = [unrated95, rated40, unrated20, rated70, rated55]

    expect(ids(sortGaps(items, 'health', 'desc'))).toEqual(
      ids([rated70, rated55, rated40, unrated95, unrated20]),
    )
    expect(ids(sortGaps(items, 'health', 'asc'))).toEqual(
      ids([rated40, rated55, rated70, unrated20, unrated95]),
    )
  })

  it('leaves every other column ordered by its value alone', async () => {
    const [a, b, c] = await feed()
    if (!a || !b || !c) throw new Error('the mock feed has fewer than three gaps')
    const small = withHealth(a, 80, true, 10)
    const middle = withHealth(b, 30, false, 20)
    const large = withHealth(c, 60, true, 30)
    expect(ids(sortGaps([small, middle, large], 'volume', 'desc'))).toEqual(
      ids([large, middle, small]),
    )
    expect(ids(sortGaps([large, small, middle], 'volume', 'asc'))).toEqual(
      ids([small, middle, large]),
    )
  })
})

describe('the Gaps URL state', () => {
  it('keeps rows=all with the list and drops it with the table, and the order the other way', () => {
    const all = writeGapsState(new URLSearchParams(), { allRows: true })
    expect(all.toString()).toBe('rows=all')
    expect(readGapsState(all).allRows).toBe(true)
    const table = writeGapsState(all, { view: 'table', sort: 'volume' })
    expect(table.toString()).toBe('view=table&sort=volume')
    expect(writeGapsState(table, { view: 'list' }).toString()).toBe('')
  })

  it('words the quiet rows waiting behind the list', () => {
    expect(restSentence(20)).toBe('20 more pools trade less than 3× their depth.')
    expect(restSentence(1)).toBe('1 more pool trades less than 3× its depth.')
  })
})
