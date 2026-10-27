/** The Pools caption's count, announced politely: rated pools, and the unrated ones when open. */
import { describe, expect, it } from 'vitest'
import { poolsCount, showUnratedLabel } from './poolsText.js'

describe('poolsCount', () => {
  it('counts the rated pools, or "Showing N of M rated" under a filter', () => {
    expect(poolsCount(15, 15, false)).toBe('15 rated pools')
    expect(poolsCount(1, 15, false)).toBe('1 rated pool')
    expect(poolsCount(2, 15, true)).toBe('Showing 2 of 15 rated')
    expect(poolsCount(2, undefined, true)).toBe('2 rated pools')
  })

  it('adds the unrated pools on screen, as a share of the unrated total until all are shown', () => {
    expect(poolsCount(15, 15, false, { shown: 0, total: 442 })).toBe('15 rated pools')
    expect(poolsCount(15, 15, false, { shown: 50, total: 442 })).toBe(
      '15 rated pools, plus 50 of 442 unrated',
    )
    expect(poolsCount(15, 15, false, { shown: 442, total: 442 })).toBe(
      '15 rated pools, plus 442 unrated',
    )
    expect(poolsCount(2, 15, true, { shown: 1, total: 1 })).toBe(
      'Showing 2 of 15 rated, plus 1 unrated',
    )
  })
})

describe('showUnratedLabel', () => {
  it('is singular for one pool', () => {
    expect(showUnratedLabel(1)).toBe('Show 1 unrated pool')
    expect(showUnratedLabel(442)).toBe('Show 442 unrated pools')
  })
})
