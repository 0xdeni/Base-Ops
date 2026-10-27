/**
 * Request accounting of `depthwatch start`: providers from host names only, Alchemy units from the
 * measured table, per-step differences and day totals with a monthly pace.
 */
import { describe, expect, it } from 'vitest'
import {
  ALCHEMY_CU_OTHER,
  ALCHEMY_FREE_CU_PER_MONTH,
  alchemyCuOf,
  providerOf,
  RequestMeter,
  usageSince,
} from './meter.js'

const ALCHEMY = 'https://base-mainnet.g.alchemy.com/v2/secret-key'
const BASE = 'https://mainnet.base.org'
const T0 = Date.UTC(2026, 9, 25, 0, 0, 0)
const HOUR = 3_600_000

describe('providerOf', () => {
  it('recognises Alchemy and Base by host name, and nothing else', () => {
    expect(providerOf(ALCHEMY)).toBe('alchemy')
    expect(providerOf(BASE)).toBe('base-public')
    expect(providerOf('https://rpc.ankr.com/base/token')).toBe('other')
    expect(providerOf('https://alchemy.com.evil.example/v2')).toBe('other')
    expect(providerOf('not a url')).toBe('other')
    expect(providerOf(undefined)).toBe('other')
  })
})

describe('RequestMeter', () => {
  it('counts per endpoint and method and prices only the Alchemy endpoint', () => {
    const meter = new RequestMeter({ main: ALCHEMY, logs: BASE }, T0)
    expect(meter.providers).toEqual({ main: 'alchemy', logs: 'base-public' })
    const before = meter.usage()
    meter.record({ endpoint: 'main', method: 'eth_call' })
    meter.record({ endpoint: 'main', method: 'eth_call' })
    meter.record({ endpoint: 'main', method: 'eth_getBlockByNumber' })
    meter.record({ endpoint: 'main', method: 'eth_getCode' })
    meter.record({ endpoint: 'logs', method: 'eth_getLogs' })
    const step = usageSince(before, meter.usage())
    expect(step).toEqual({
      requests: 5,
      main: 4,
      logs: 1,
      alchemyCu: 26 + 26 + 16 + ALCHEMY_CU_OTHER,
      methods: {
        'main eth_call': 2,
        'main eth_getBlockByNumber': 1,
        'main eth_getCode': 1,
        'logs eth_getLogs': 1,
      },
    })
    expect(meter.fields(step)).toEqual({ requests: 5, main: 4, logs: 1, alchemyCu: 94 })
    expect(alchemyCuOf('eth_getLogs')).toBe(75)
  })

  it('prices eth_getLogs on Alchemy and reports no units without an Alchemy endpoint', () => {
    const alchemyOnly = new RequestMeter({ main: ALCHEMY, logs: ALCHEMY }, T0)
    alchemyOnly.record({ endpoint: 'logs', method: 'eth_getLogs' })
    expect(alchemyOnly.usage().alchemyCu).toBe(75)
    const other = new RequestMeter({ main: BASE, logs: BASE }, T0)
    other.record({ endpoint: 'main', method: 'eth_call' })
    expect(other.pricesCu).toBe(false)
    expect(other.fields(other.usage())).toEqual({ requests: 1, main: 1, logs: 0 })
  })

  it('closes a UTC day once, with the pace of a month at that rate', () => {
    const meter = new RequestMeter({ main: ALCHEMY, logs: BASE }, T0 + 12 * HOUR)
    for (let i = 0; i < 1_000; i++) meter.record({ endpoint: 'main', method: 'eth_call' })
    expect(meter.closeDay(T0 + 23 * HOUR)).toBeUndefined()
    const day = meter.closeDay(T0 + 24 * HOUR + 60_000)
    expect(day).toMatchObject({ day: '2026-10-25', fromMs: T0 + 12 * HOUR, toMs: T0 + 24 * HOUR })
    if (day === undefined) throw new Error('no day total')
    // 26 000 units in the 12 hours seen: 52 000 a day, 1.56 M a 30-day month.
    expect(meter.dayFields(day)).toEqual({
      day: '2026-10-25',
      requests: 1_000,
      main: 1_000,
      logs: 0,
      alchemyCu: 26_000,
      alchemyCuMonthPace: 1_560_000,
      alchemyFreeTierPct: Math.round((1_560_000 * 100) / ALCHEMY_FREE_CU_PER_MONTH),
    })
    expect(meter.closeDay(T0 + 25 * HOUR)).toBeUndefined()
    meter.record({ endpoint: 'logs', method: 'eth_getLogs' })
    expect(meter.today(T0 + 25 * HOUR)).toMatchObject({
      day: '2026-10-26',
      usage: { requests: 1, logs: 1, alchemyCu: 0 },
    })
  })

  it('leaves the pace out of a day seen for less than an hour', () => {
    const meter = new RequestMeter({ main: ALCHEMY, logs: BASE }, T0 + 23.5 * 3_600_000)
    meter.record({ endpoint: 'main', method: 'eth_call' })
    const day = meter.closeDay(T0 + 24 * HOUR)
    if (day === undefined) throw new Error('no day total')
    expect(meter.dayFields(day)).not.toHaveProperty('alchemyCuMonthPace')
  })
})
