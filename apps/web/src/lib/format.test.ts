import { DEXES } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { DEX_SHORT } from '../components/charts/butterflyModel.js'
import {
  abs,
  ago,
  amount,
  bps,
  cantAbsorb,
  count,
  DASH,
  DEX_LABEL,
  dated,
  day,
  fee,
  feeText,
  full,
  gradeTone,
  group,
  hours,
  pairLabel,
  pct,
  poolDesc,
  price,
  ratio,
  SNAPSHOT_CLOCK,
  score,
  scoreExact,
  share,
  shareOf,
  spreadText,
  tokenAmount,
  tokenText,
  uptime,
  usd,
  usdTick,
  when,
} from './format.js'

const NB = ' '
/** Expected strings mark the no-break spaces (U+00A0) that glue units with "~". */
const nb = (s: string) => s.replaceAll('~', NB)

describe('usd (N1): 3 significant figures, trailing zeros kept, bare .0 dropped', () => {
  it('keeps trailing zeros so neighbours read alike', () => {
    expect(usd(5_100_000)).toBe('$5.10M')
    expect(usd(6_080_000)).toBe('$6.08M')
    expect(usd(7_400)).toBe('$7.40K')
    expect(usd(7_380)).toBe('$7.38K')
    expect(usd(26_100_000)).toBe('$26.1M')
    expect(usd(31_512)).toBe('$31.5K')
  })
  it('drops a bare .0 before the suffix for round values', () => {
    expect(usd(50_000)).toBe('$50K')
    expect(usd(1_000_000)).toBe('$1M')
    expect(usd(260_000)).toBe('$260K')
    expect(usd(999_950)).toBe('$1M')
    expect(usd(1_500_000_000)).toBe('$1.50B')
  })
  it('shows whole dollars from $1 to $1,000', () => {
    expect(usd(412)).toBe('$412')
    expect(usd(412.4)).toBe('$412')
    expect(usd(1)).toBe('$1')
    expect(usd(0.996)).toBe('$1')
    expect(usd(0)).toBe('$0')
    expect(usd(999.6)).toBe('$1K')
  })
  it('keeps the cents under a dollar and says "<$0.01" under half a cent, never "$0"', () => {
    expect(usd(0.42)).toBe('$0.42')
    expect(usd(0.994)).toBe('$0.99')
    expect(usd(0.0123)).toBe('$0.01')
    expect(usd(0.005)).toBe('$0.01')
    expect(usd(0.0049)).toBe('<$0.01')
    expect(usd(1e-9)).toBe('<$0.01')
    expect(usd(-0.42)).toBe('−$0.42')
    expect(usd(-0.001)).toBe('−<$0.01')
  })
  it('never prints $0 for a non-zero value: the live pools the first run measured', () => {
    // TVL, ±2 % depth, 24 h volume and token prices of pools of the first Base mainnet run
    const live = [
      7.009230009703718e-17, // aerodrome-v2:0x18064845…, TVL
      6.9865255788984635e-19, // the same pool's ±2 % depth
      1.3300829002353208e-8,
      7.281415899006061e-7,
      0.00000112032456918898,
      0.000144267748585843, // uniswap-v3:0x3c6f1d8e…, 24 h volume
      0.0008999473689104882, // DEGEN in USD
      0.004651684070139573, // BRETT in USD
    ]
    for (const v of live) {
      expect(usd(v), String(v)).toBe('<$0.01')
      expect(usd(-v)).toBe('−<$0.01')
    }
    expect(usd(0.024059952176524395)).toBe('$0.02') // aerodrome-v2:0x656a19ae…, TVL
    expect(usd(0.03332168285464274)).toBe('$0.03')
    expect(usd(0.00574595045783362)).toBe('$0.01')
    for (const v of [...live, 0.024, 0.5, 3.2, 412.4, 5_000, 5e6]) {
      expect(usd(v)).not.toMatch(/^\$0$|\$0\.00|e[+-]?\d/)
    }
  })
  it('puts "<$0.01" into the sentence that quotes it', () => {
    expect(`${usd(6.9865255788984635e-19)} sits within 2 % of the price on Base.`).toBe(
      '<$0.01 sits within 2 % of the price on Base.',
    )
  })
  it('uses the true minus and the dash for unknowns', () => {
    expect(usd(-12_300)).toBe('−$12.3K')
    expect(usd(null)).toBe(DASH)
    expect(usd(undefined)).toBe(DASH)
    expect(usd(Number.NaN)).toBe(DASH)
  })
  it('never prints a lowercase k, a bare .0 or $0.00 (N1 regex)', () => {
    const values = [1, 999, 1000, 1001, 9999, 10_000, 99_999, 100_000, 1e6, 12_345_678, 1e9]
    for (const v of values) expect(usd(v)).not.toMatch(/\$\d+(\.\d)?k|\.0[KMB]|\$0\.00/)
  })
})

describe('chart ticks keep 2 significant figures', () => {
  it('formats ticks', () => {
    expect(usdTick(0)).toBe('0')
    expect(usdTick(5_000_000)).toBe('$5M')
    expect(usdTick(25_000)).toBe('$25K')
    expect(usdTick(12_500)).toBe('$13K')
  })
})

describe('shares, uptime, ratios and scores', () => {
  it('reads a share above 0 and below 1 % as "under 1 %" (N4)', () => {
    expect(shareOf(0.001)).toBe(nb('under 1~%'))
    expect(shareOf(0.0099)).toBe(nb('under 1~%'))
    expect(shareOf(0)).toBe(nb('0~%'))
    expect(shareOf(0.43)).toBe(nb('43~%'))
    expect(shareOf(null)).toBe(DASH)
    expect(share(0.534)).toBe(nb('53~%'))
  })
  it('gives uptime 1 decimal and drops a whole .0 (N4)', () => {
    expect(uptime(0.9638)).toBe(nb('96.4~%'))
    expect(uptime(1)).toBe(nb('100~%'))
    expect(uptime(0.429)).toBe(nb('42.9~%'))
    expect(uptime(0)).toBe(nb('0~%'))
  })
  it('writes ratios with ×, 1 decimal below 10 (N5)', () => {
    expect(ratio(1.62)).toBe('1.6×')
    expect(ratio(50.8)).toBe('51×')
    expect(ratio(9.96)).toBe('10×')
  })
  it('floors scores so the number never contradicts its letter (N6)', () => {
    expect(score(79.99)).toBe('79')
    expect(score(79.6)).toBe('79')
    expect(score(88.2)).toBe('88')
    expect(score(100)).toBe('100')
    expect(score(null)).toBe(DASH)
    expect(scoreExact(88.24)).toBe('88.2')
  })
  it('maps grades to tones (C4)', () => {
    expect(['A', 'B', 'C', 'D', 'F'].map((g) => gradeTone(g as 'A'))).toEqual([
      'ok',
      'ok',
      'warn',
      'bad',
      'bad',
    ])
  })
})

describe('bps, prices, amounts and fees', () => {
  it('gives bps 1 decimal below 100 and an integer from 100 (N3)', () => {
    expect(bps(10.44)).toBe(nb('10.4~bps'))
    expect(bps(187.4)).toBe(nb('187~bps'))
    expect(bps(99.96)).toBe(nb('100~bps'))
    expect(bps(1234.5)).toBe(nb('1,235~bps'))
    expect(bps(9999.4)).toBe(nb('9,999~bps'))
  })
  it("never prints a spread of 10,000 bps or more as a number: the first run's offenders", () => {
    // $10K spreads the first Base mainnet run stored (core now answers null for these)
    const live = [
      1.449e24, // aerodrome-v2:0x18064845…, TVL of 7e-17 USD
      2.77e19,
      7.874e16, // 17 digits
      6.105e15,
      2.678e14,
      1.933e12,
      3.563e10,
      7.764e9,
      6.14e9,
      1.0103e4, // the smallest of them: aerodrome-v2:0xb4885bc6…, TVL $32K
    ]
    for (const v of live) {
      expect(bps(v), String(v)).toBe(DASH)
      expect(spreadText(v, 10_000), String(v)).toBe(nb('Can’t absorb $10K'))
    }
    expect(bps(9999.6)).toBe(DASH) // rounds to 10,000
    expect(bps(10_000)).toBe(DASH)
    expect(bps(-1.449e24)).toBe(DASH)
  })
  it('never prints more than 4 significant digits (N3)', () => {
    for (let v = 0.05; v < 20_000; v *= 1.37) {
      const text = bps(v)
      const digits = text.replace(/[^0-9]/g, '')
      expect(digits.length, `${v} → ${text}`).toBeLessThanOrEqual(4)
    }
  })
  it('words a spread that cannot be absorbed where the spread would be', () => {
    expect(cantAbsorb(10_000)).toBe(nb('Can’t absorb $10K'))
    expect(cantAbsorb(1_000)).toBe(nb('Can’t absorb $1K'))
    expect(spreadText(139.69, 10_000)).toBe(nb('140~bps'))
    expect(spreadText(null, 10_000)).toBe(nb('Can’t absorb $10K'))
    expect(spreadText(9_999, 100_000)).toBe(nb('9,999~bps'))
    expect(spreadText(10_000, 100_000)).toBe(nb('Can’t absorb $100K'))
  })
  it('prices: 2 decimals from 1, 4 significant digits below (N2)', () => {
    expect(price(2460.3249)).toBe('2,460.32')
    expect(price(0.00040651)).toBe('0.0004065')
    expect(price(0)).toBe('0')
    expect(price(0.99996)).toBe('1.00')
    expect(price(0.99994)).toBe('0.9999')
    expect(price(-0.99996)).toBe('−1.00')
  })
  it('never uses exponent notation: tiny prices are written out at 4 significant digits', () => {
    expect(price(0.00000387)).toBe('0.00000387')
    expect(price(3.87e-6)).toBe('0.00000387')
    expect(price(0.00000038712)).toBe('0.0000003871')
    expect(price(1e-7)).toBe('0.0000001')
    expect(price(-3.87e-9)).toBe('−0.00000000387')
    // the sell leg of the first run's dust pool, and the smallest price a pool held (tick floor)
    expect(price(1.3547807691578489e-21)).toBe('0.000000000000000000001355')
    expect(price(2.9389568101428185e-39)).toBe(`0.${'0'.repeat(38)}2939`)
    for (let e = -60; e <= 25; e += 1) {
      const text = price(1.2345 * 10 ** e)
      expect(text, `1.2345e${e}`).not.toMatch(/e[+-]?\d/i)
      expect(text.replaceAll(/[^1-9]/g, '').length, text).toBeGreaterThan(0)
    }
    // at most 4 significant digits under 1
    expect(price(0.000012345678).replace(/^0\.0*/, '')).toBe('1235')
  })
  it('keeps token amounts at 4 significant figures through BigInt (N11)', () => {
    expect(amount('406512345678901234', 18)).toBe('0.4065')
    expect(amount('812345678', 6)).toBe('812.3')
    expect(amount('31512000000', 6)).toBe('31,510')
    expect(amount('1234567000000', 6)).toBe('1.235M')
    expect(amount('0', 18)).toBe('0')
    expect(amount('12.5', 6)).toBe(DASH)
    const usdc = { address: '0x83', symbol: 'USDC', name: 'USD Coin', decimals: 6 } as const
    expect(tokenAmount('1250000000', usdc)).toBe(nb('1,250~USDC'))
  })
  it('writes fees and the pool description with no-break spaces', () => {
    expect(fee(500)).toBe(nb('0.05~%'))
    expect(fee(3000)).toBe(nb('0.3~%'))
    expect(fee(10_000)).toBe(nb('1~%'))
    expect(poolDesc({ dex: 'aerodrome-slipstream', feePips: 500 })).toBe(
      nb('Aerodrome Slipstream, 0.05~% dynamic'),
    )
    expect(poolDesc({ dex: 'aerodrome-v2', feePips: 3000, stable: true })).toBe(
      nb('Aerodrome v2, 0.3~%, stable pair'),
    )
    expect(poolDesc({ dex: 'aero-v2', feePips: 500, stable: true })).toBe(
      nb('Aero v2, 0.05~%, stable pair'),
    )
  })
  it('marks the fee of both Slipstreams dynamic, and only theirs', () => {
    const fees = DEXES.map((dex) => feeText({ dex, feePips: 465 }))
    expect(fees).toEqual([
      nb('0.0465~%'),
      nb('0.0465~%'),
      nb('0.0465~%'),
      nb('0.0465~% dynamic'),
      nb('0.0465~%'),
      nb('0.0465~% dynamic'),
    ])
    expect(poolDesc({ dex: 'aero-slipstream', feePips: 2055 })).toBe(
      nb('Aero Slipstream, 0.2055~% dynamic'),
    )
  })
  it('names a token by its label, or by its symbol from a server that sends none', () => {
    const old = { symbol: 'AERO', label: 'AERO (Aerodrome)' }
    const aero = { symbol: 'AERO', label: 'AERO (Aero)' }
    expect(tokenText(old)).toBe('AERO (Aerodrome)')
    expect(tokenText({ symbol: 'AERO' })).toBe('AERO')
    expect(pairLabel(aero, { symbol: 'USDC', label: 'USDC' })).toBe('AERO (Aero) / USDC')
    expect(pairLabel({ symbol: 'WETH' }, { symbol: 'USDC' })).toBe('WETH / USDC')
  })
  it('gives every DEX a long and a short name, each one its own', () => {
    const long = DEXES.map((dex) => DEX_LABEL[dex])
    const short = DEXES.map((dex) => DEX_SHORT[dex])
    expect(new Set(long).size).toBe(DEXES.length)
    expect(new Set(short).size).toBe(DEXES.length)
    expect(long).toEqual([
      'Uniswap v3',
      'Uniswap v4',
      'Aerodrome v2',
      'Aerodrome Slipstream',
      'Aero v2',
      'Aero Slipstream',
    ])
    expect(short.slice(3)).toEqual(['Aerodrome CL', 'Aero v2', 'Aero CL'])
  })
  it('groups counts and block numbers (BigInt for blocks)', () => {
    expect(count(1284)).toBe('1,284')
    expect(group('52950000')).toBe('52,950,000')
    expect(group('9007199254740993')).toBe('9,007,199,254,740,993')
    expect(group('0x10')).toBe(DASH)
    expect(group(null)).toBe(DASH)
  })
  it('signs moves with + and the true minus (N9)', () => {
    expect(pct(2)).toBe(nb('+2~%'))
    expect(pct(-5)).toBe(nb('−5~%'))
    expect(pct(0)).toBe(nb('0~%'))
  })
})

describe('times (N10): relative under 24 h, absolute UTC after', () => {
  const now = Date.UTC(2025, 9, 23, 0, 2) / 1000
  it('reads relative times with a no-break space', () => {
    expect(ago(now - 120, now)).toBe(nb('2~min ago'))
    expect(ago(now - 10, now)).toBe(nb('1~min ago'))
    expect(ago(now - 3 * 3600, now)).toBe(nb('3~h ago'))
    expect(when(now - 14 * 3600, now)).toBe(nb('14~h ago'))
  })
  it('switches to the full UTC time after a day', () => {
    const ts = Date.UTC(2025, 9, 21, 4, 0) / 1000
    expect(abs(ts)).toBe(nb('21~Oct, 04:00'))
    expect(full(ts)).toBe(nb('21~Oct, 04:00~UTC'))
    expect(ago(ts, now)).toBe(nb('21~Oct, 04:00~UTC'))
    expect(day(ts)).toBe(nb('21~Oct'))
  })
  it('gives absolute times only on the snapshot clock, and the year where a snapshot is dated', () => {
    expect(ago(now - 120, SNAPSHOT_CLOCK)).toBe(nb('23~Oct, 00:00~UTC'))
    expect(when(now - 3 * 3600, SNAPSHOT_CLOCK)).toBe(nb('22~Oct, 21:02~UTC'))
    expect(ago(null, SNAPSHOT_CLOCK)).toBe(DASH)
    expect(dated(now)).toBe(nb('23~Oct~2025, 00:02~UTC'))
    expect(dated(undefined)).toBe(DASH)
  })
  it('writes durations in hours, then days', () => {
    expect(hours(14)).toBe(nb('14~h'))
    expect(hours(72)).toBe(nb('3~d'))
  })
})
