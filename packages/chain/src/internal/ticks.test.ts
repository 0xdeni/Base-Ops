import { MAX_TICK, MIN_TICK } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import {
  bitmapPosition,
  coveragePct,
  decodeGrossNet,
  ticksForPctMove,
  ticksInWord,
  wordOfTick,
  wordRange,
  wordTickBounds,
} from './ticks.js'

describe('tick coverage', () => {
  it('covers at least max(2·bandPct, 10) % each side', () => {
    expect(coveragePct(5)).toBe(10)
    expect(coveragePct(2)).toBe(10)
    expect(coveragePct(8)).toBe(16)
  })

  it('converts percent moves to ticks with ln(1 ± x) / ln 1.0001', () => {
    expect(ticksForPctMove(10)).toEqual({ up: 954, down: 1054 })
    expect(ticksForPctMove(1)).toEqual({ up: 100, down: 101 })
    expect(() => ticksForPctMove(0)).toThrow(RangeError)
    expect(() => ticksForPctMove(100)).toThrow(RangeError)
  })
})

describe('word / bit math', () => {
  it('uses floor division on the compressed tick, also for negative ticks', () => {
    expect(wordOfTick(0, 10)).toBe(0)
    expect(wordOfTick(2559, 10)).toBe(0)
    expect(wordOfTick(2560, 10)).toBe(1)
    expect(wordOfTick(-1, 10)).toBe(-1)
    expect(wordOfTick(-2560, 10)).toBe(-1)
    expect(wordOfTick(-2561, 10)).toBe(-2)
    expect(bitmapPosition(-10, 10)).toEqual({ word: -1, bit: 255 })
    expect(bitmapPosition(-2560, 10)).toEqual({ word: -1, bit: 0 })
    expect(bitmapPosition(120, 60)).toEqual({ word: 0, bit: 2 })
  })

  it('maps set bits back to tick = (word · 256 + bit) · tickSpacing', () => {
    expect(ticksInWord(0, 0b101n, 60)).toEqual([0, 120])
    expect(ticksInWord(-1, (1n << 255n) | 1n, 10)).toEqual([-2560, -10])
    expect(ticksInWord(3, 0n, 1)).toEqual([])
    for (const tick of [-887220, -60, 0, 60, 887220]) {
      const { word, bit } = bitmapPosition(tick, 60)
      expect(ticksInWord(word, 1n << BigInt(bit), 60)).toEqual([tick])
    }
  })

  it('selects the words covering the band and reports their edges as bounds', () => {
    expect(wordRange(0, 10, 5)).toEqual({ wordLo: -1, wordHi: 0 })
    expect(wordRange(-5, 10, 20)).toEqual({ wordLo: -2, wordHi: 1 })
    expect(wordTickBounds(-1, 0, 10)).toEqual({ tickLowerBound: -2560, tickUpperBound: 2559 })
    expect(wordTickBounds(-2, 1, 10)).toEqual({ tickLowerBound: -5120, tickUpperBound: 5119 })
    // Clamped at the ends of the tick space.
    expect(wordRange(MIN_TICK, 1, 5).wordLo).toBe(wordOfTick(MIN_TICK, 1))
    expect(wordRange(MAX_TICK, 1, 5).wordHi).toBe(wordOfTick(MAX_TICK, 1))
    const edge = wordTickBounds(wordOfTick(MIN_TICK, 1), wordOfTick(MAX_TICK, 1), 1)
    expect(edge).toEqual({ tickLowerBound: MIN_TICK, tickUpperBound: MAX_TICK })
  })

  it('decodes (liquidityGross, liquidityNet) from the first two tuple entries', () => {
    expect(decodeGrossNet([5n, -3n, 1n, 2n])).toEqual({ liquidityGross: 5n, liquidityNet: -3n })
    expect(() => decodeGrossNet([5n])).toThrow(TypeError)
    expect(() => decodeGrossNet('nope')).toThrow(TypeError)
  })
})
