/**
 * Tick-bitmap walk shared by Uniswap v3, Slipstream and Uniswap v4.
 *
 * The bitmap is indexed by the compressed tick `c = floor(tick / tickSpacing)`; `word = c >> 8`,
 * `bit = c mod 256`, and a set bit means `tick = (word · 256 + bit) · tickSpacing` is initialised.
 * `readTicks` covers at least max(2·bandPct, 10) % each side of the current price, rounded out to
 * whole words, reads every word via multicall, then every set tick via multicall, and reports the
 * covered word edges as the state's tick bounds.
 */
import { MAX_TICK, MIN_TICK, type TickData } from '@depthwatch/core'
import type { ReaderContext } from './context.js'
import { type ContractCall, expectResult, multicallBatched } from './multicall.js'

const LN_1_0001 = Math.log(1.0001)

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b)
}

/** Percent of price to cover on each side for a given concentration band. */
export function coveragePct(bandPct: number): number {
  return Math.max(2 * bandPct, 10)
}

/** Ticks needed to move the price up by `pct` % and down by `pct` % (ln(1 ± x) / ln 1.0001). */
export function ticksForPctMove(pct: number): { up: number; down: number } {
  if (!(pct > 0) || pct >= 100) throw new RangeError(`ticksForPctMove: pct out of range ${pct}`)
  const x = pct / 100
  return {
    up: Math.ceil(Math.log(1 + x) / LN_1_0001),
    down: Math.ceil(-Math.log(1 - x) / LN_1_0001),
  }
}

export function wordOfTick(tick: number, tickSpacing: number): number {
  return floorDiv(tick, tickSpacing) >> 8
}

/** Inclusive word range covering `coveragePct(bandPct)` around `tick`, clamped to valid ticks. */
export function wordRange(
  tick: number,
  tickSpacing: number,
  bandPct: number,
): { wordLo: number; wordHi: number } {
  const { up, down } = ticksForPctMove(coveragePct(bandPct))
  const minWord = wordOfTick(MIN_TICK, tickSpacing)
  const maxWord = wordOfTick(MAX_TICK, tickSpacing)
  return {
    wordLo: Math.max(minWord, wordOfTick(tick - down, tickSpacing)),
    wordHi: Math.min(maxWord, wordOfTick(tick + up, tickSpacing)),
  }
}

/** Ticks whose bits are set in `bitmap` for word `word`, ascending. */
export function ticksInWord(word: number, bitmap: bigint, tickSpacing: number): number[] {
  const out: number[] = []
  if (bitmap === 0n) return out
  for (let bit = 0; bit < 256; bit++) {
    if ((bitmap >> BigInt(bit)) & 1n) out.push((word * 256 + bit) * tickSpacing)
  }
  return out
}

/** Known-complete tick interval for words [wordLo, wordHi]: first tick of wordLo … last tick of wordHi. */
export function wordTickBounds(
  wordLo: number,
  wordHi: number,
  tickSpacing: number,
): { tickLowerBound: number; tickUpperBound: number } {
  return {
    tickLowerBound: Math.max(MIN_TICK, wordLo * 256 * tickSpacing),
    tickUpperBound: Math.min(MAX_TICK, (wordHi + 1) * 256 * tickSpacing - 1),
  }
}

/** Word index and bit of an aligned tick (inverse of `ticksInWord`); used by fixtures. */
export function bitmapPosition(tick: number, tickSpacing: number): { word: number; bit: number } {
  const c = floorDiv(tick, tickSpacing)
  return { word: c >> 8, bit: ((c % 256) + 256) % 256 }
}

export interface TickSource {
  bitmapCall(word: number): ContractCall
  tickCall(tick: number): ContractCall
  /** Pull (liquidityGross, liquidityNet) out of the decoded `ticks()`/`getTickInfo()` tuple. */
  decodeTick(result: unknown): { liquidityGross: bigint; liquidityNet: bigint }
}

export interface TickWalk {
  ticks: TickData[]
  tickLowerBound: number
  tickUpperBound: number
}

export async function readTicks(
  ctx: ReaderContext,
  source: TickSource,
  tick: number,
  tickSpacing: number,
  bandPct: number,
  blockNumber: bigint,
): Promise<TickWalk> {
  if (!(tickSpacing > 0)) throw new RangeError(`readTicks: invalid tickSpacing ${tickSpacing}`)
  const { wordLo, wordHi } = wordRange(tick, tickSpacing, bandPct)
  const words: number[] = []
  for (let w = wordLo; w <= wordHi; w++) words.push(w)
  const bitmaps = await multicallBatched(
    ctx,
    words.map((w) => source.bitmapCall(w)),
    blockNumber,
  )
  const tickIndices: number[] = []
  words.forEach((w, i) => {
    const bitmap = expectResult(bitmaps[i], `tickBitmap(${w})`) as bigint
    tickIndices.push(...ticksInWord(w, bitmap, tickSpacing))
  })
  const infos = await multicallBatched(
    ctx,
    tickIndices.map((t) => source.tickCall(t)),
    blockNumber,
  )
  const ticks: TickData[] = tickIndices.map((index, i) => {
    const { liquidityGross, liquidityNet } = source.decodeTick(
      expectResult(infos[i], `ticks(${index})`),
    )
    return { index, liquidityGross, liquidityNet }
  })
  ticks.sort((a, b) => a.index - b.index)
  return { ticks, ...wordTickBounds(wordLo, wordHi, tickSpacing) }
}

/** First two outputs of v3 `ticks`, Slipstream `ticks` and v4 `getTickInfo` are (gross, net). */
export function decodeGrossNet(result: unknown): { liquidityGross: bigint; liquidityNet: bigint } {
  if (!Array.isArray(result) || typeof result[0] !== 'bigint' || typeof result[1] !== 'bigint')
    throw new TypeError('tick info: expected (liquidityGross, liquidityNet, …) tuple')
  return { liquidityGross: result[0], liquidityNet: result[1] }
}
