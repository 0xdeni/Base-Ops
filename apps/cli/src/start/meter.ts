/**
 * Request accounting of `depthwatch start`: every JSON-RPC request the chain reader sends
 * (`ChainReader` `onRequest`), counted per endpoint and method, with an estimate of the compute
 * units an Alchemy endpoint bills for them. The scheduler logs the usage of each step and one
 * line per UTC day, so the owner can follow the budget in the host's log viewer.
 *
 * The unit prices are the ones measured for this project (docs/ARCHITECTURE.md "Running as a
 * service"): `eth_getLogs` 75, `eth_call` 26 (a multicall is one `eth_call`), a block header 16.
 * Methods not in that table (`eth_getCode` of a seed's creation-block search) are counted at the
 * `eth_call` price. Only requests to an Alchemy URL are priced; other endpoints are counted only.
 */
import type { RpcEndpoint, RpcRequestEvent } from '@depthwatch/chain'
import type { LogFields } from '../log.js'

export const ALCHEMY_CU: Readonly<Record<string, number>> = Object.freeze({
  eth_getLogs: 75,
  eth_call: 26,
  eth_getBlockByNumber: 16,
})
/** Price of a method the table does not list: the `eth_call` price. */
export const ALCHEMY_CU_OTHER = 26
/** Alchemy's free tier, roughly, per month. */
export const ALCHEMY_FREE_CU_PER_MONTH = 30_000_000

const DAY_MS = 86_400_000
const MONTH_MS = 30 * DAY_MS
/** A day total projects a monthly pace only over at least this much time. */
const PACE_MIN_MS = 3_600_000

export type Provider = 'alchemy' | 'base-public' | 'other'

/** The provider behind an endpoint URL, from its host name alone (the URL may carry a key). */
export function providerOf(url: string | undefined): Provider {
  if (url === undefined) return 'other'
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host === 'alchemy.com' || host.endsWith('.alchemy.com')) return 'alchemy'
    if (host === 'mainnet.base.org') return 'base-public'
  } catch {
    return 'other'
  }
  return 'other'
}

export function alchemyCuOf(method: string): number {
  return ALCHEMY_CU[method] ?? ALCHEMY_CU_OTHER
}

export interface Usage {
  requests: number
  main: number
  logs: number
  /** Estimated Alchemy compute units (requests to Alchemy endpoints only). */
  alchemyCu: number
  /** Requests per `<endpoint> <method>`, e.g. `main eth_call`. */
  methods: Record<string, number>
}

export interface DayTotal {
  /** UTC date, `YYYY-MM-DD`. */
  day: string
  usage: Usage
  /** The part of the day the meter saw: from its start (or the meter's creation) to `toMs`. */
  fromMs: number
  toMs: number
}

const emptyUsage = (): Usage => ({ requests: 0, main: 0, logs: 0, alchemyCu: 0, methods: {} })

function copyUsage(usage: Usage): Usage {
  return { ...usage, methods: { ...usage.methods } }
}

/** `to − from`, field by field. */
export function usageSince(from: Usage, to: Usage): Usage {
  const methods: Record<string, number> = {}
  for (const [key, n] of Object.entries(to.methods)) {
    const delta = n - (from.methods[key] ?? 0)
    if (delta > 0) methods[key] = delta
  }
  return {
    requests: to.requests - from.requests,
    main: to.main - from.main,
    logs: to.logs - from.logs,
    alchemyCu: to.alchemyCu - from.alchemyCu,
    methods,
  }
}

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS

export class RequestMeter {
  readonly providers: Readonly<Record<RpcEndpoint, Provider>>
  private readonly total = emptyUsage()
  private dayMark: Usage
  private day: string
  private dayFrom: number

  constructor(urls: { main: string | undefined; logs: string | undefined }, nowMs: number) {
    this.providers = { main: providerOf(urls.main), logs: providerOf(urls.logs) }
    this.dayMark = emptyUsage()
    this.day = utcDay(nowMs)
    this.dayFrom = nowMs
  }

  /** True when an endpoint is Alchemy, so compute units are worth reporting. */
  get pricesCu(): boolean {
    return this.providers.main === 'alchemy' || this.providers.logs === 'alchemy'
  }

  /** The chain reader's `onRequest`. */
  readonly record = (event: RpcRequestEvent): void => {
    const total = this.total
    total.requests++
    total[event.endpoint]++
    const key = `${event.endpoint} ${event.method}`
    total.methods[key] = (total.methods[key] ?? 0) + 1
    if (this.providers[event.endpoint] === 'alchemy') total.alchemyCu += alchemyCuOf(event.method)
  }

  /** Everything counted so far (a copy). */
  usage(): Usage {
    return copyUsage(this.total)
  }

  /** The log fields of `usage`: requests per endpoint and, with an Alchemy endpoint, its units. */
  fields(usage: Usage): LogFields {
    const fields: LogFields = { requests: usage.requests, main: usage.main, logs: usage.logs }
    if (this.pricesCu) fields.alchemyCu = usage.alchemyCu
    return fields
  }

  /** The current UTC day's usage so far. */
  today(nowMs: number): DayTotal {
    return {
      day: this.day,
      usage: usageSince(this.dayMark, this.total),
      fromMs: this.dayFrom,
      toMs: nowMs,
    }
  }

  /**
   * The finished day's total once `nowMs` is on a later UTC day (requests counted since the last
   * call are booked on the finished day), else undefined.
   */
  closeDay(nowMs: number): DayTotal | undefined {
    if (utcDay(nowMs) === this.day) return undefined
    const end = dayStart(nowMs)
    const total = this.today(end)
    this.dayMark = copyUsage(this.total)
    this.day = utcDay(nowMs)
    this.dayFrom = end
    return total
  }

  /** The log fields of a day total, with the monthly pace of its Alchemy units. */
  dayFields(total: DayTotal): LogFields {
    const fields: LogFields = { day: total.day, ...this.fields(total.usage) }
    const spanMs = total.toMs - total.fromMs
    if (this.pricesCu && spanMs >= PACE_MIN_MS) {
      const pace = Math.round((total.usage.alchemyCu * MONTH_MS) / spanMs)
      fields.alchemyCuMonthPace = pace
      fields.alchemyFreeTierPct = Math.round((pace * 100) / ALCHEMY_FREE_CU_PER_MONTH)
    }
    return fields
  }
}
