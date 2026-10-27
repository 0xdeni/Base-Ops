import { computeHealthScore } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import type { SpreadPoint } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import { costTakeaway, healthTakeaway, spreadAt, spreadCellText } from './poolText.js'

const point = (notionalUsd: number, spreadBps: number | null, feasible = true): SpreadPoint => ({
  notionalUsd,
  spreadBps,
  feasible,
  buyAvgPrice: spreadBps === null ? null : 1,
  sellAvgPrice: spreadBps === null ? null : 1,
})

describe('costTakeaway and the spread cells', () => {
  it('states the largest notional the pool absorbs', () => {
    const spreads = [point(1_000, 10), point(10_000, 13.8), point(100_000, 42)]
    expect(costTakeaway(spreads)).toBe(`A $100K round trip costs 42.0${NB}bps, fees included.`)
    expect(spreadAt(spreads, 10_000)).toBe(13.8)
    expect(spreadCellText(point(10_000, 13.8))).toBe(`13.8${NB}bps`)
  })

  it('says the pool can’t absorb a notional that does not fill', () => {
    const spreads = [point(1_000, 10), point(10_000, null, false), point(100_000, null, false)]
    expect(costTakeaway(spreads)).toBe(
      `The pool can’t absorb $100K; a $1K round trip costs 10.0${NB}bps.`,
    )
    expect(spreadAt(spreads, 10_000)).toBeNull()
    expect(spreadCellText(point(100_000, null, false))).toBe(`Can’t absorb $100K`)
  })

  it('treats a spread of 10,000 bps or more as one it can’t absorb: the first run stored 1.4e24', () => {
    const spreads = [point(1_000, 1.449e24), point(10_000, 1.449e24), point(100_000, 1.449e24)]
    expect(costTakeaway(spreads)).toBe('The pool can’t absorb a $1K round trip.')
    expect(spreadAt(spreads, 10_000)).toBeNull()
    expect(spreadCellText(point(10_000, 1.449e24))).toBe(`Can’t absorb $10K`)
    for (const text of [costTakeaway(spreads), spreadCellText(point(10_000, 1.449e24))]) {
      expect(text).not.toMatch(/\d{5,}|e\+/)
    }
  })

  it('has nothing to say before a snapshot', () => {
    expect(costTakeaway([])).toBe('No round trip was measured in the latest snapshot.')
  })
})

describe('healthTakeaway', () => {
  const inputs = {
    spread10kBps: 20,
    ownerTop1Share: 0.3,
    rangeHhi: 0.3,
    persistence: null,
  }

  it('names the weakest part of a rated pool', () => {
    const health = computeHealthScore({ ...inputs, depth2UpUsd: 20_000, depth2DownUsd: 20_000 })
    expect(health.rated).toBe(true)
    expect(healthTakeaway(health, null, 'concentrated')).toMatch(/is the weak part/)
  })

  it('gives the reason, not a weak part, for a pool with no grade', () => {
    const thin = computeHealthScore({ ...inputs, depth2UpUsd: 800, depth2DownUsd: 900 })
    expect(healthTakeaway(thin, null, 'concentrated')).toBe(
      `Too thin to rate: neither side holds $5K within 2${NB}%.`,
    )
    const oneSided = computeHealthScore({ ...inputs, depth2UpUsd: 900_000, depth2DownUsd: 0 })
    expect(healthTakeaway(oneSided, null, 'concentrated')).toMatch(/^Too thin on one side/)
    const unpriced = computeHealthScore({ ...inputs, depth2UpUsd: null, depth2DownUsd: 1e6 })
    expect(healthTakeaway(unpriced, null, 'concentrated')).toMatch(/^No USD price/)
  })
})
