import { describe, expect, it } from 'vitest'
import {
  MANDATE_LIMITS,
  MandateValidationError,
  maskWebhookUrl,
  mergeRegistration,
  parseMandate,
  toPublicMandate,
} from './mandate.js'
import { DEFAULT_MANDATE_KPIS, MANDATE_ID_PATTERN } from './types.js'

const now = 1_700_000_000
const addr1 = '0x00000000000000000000000000000000000000a1'
const addr2 = '0x00000000000000000000000000000000000000b2'

const minimal = {
  id: 'demo-slipstream-weth-usdc',
  name: 'Demo mandate',
  poolId: 'aerodrome-slipstream:0x00000000000000000000000000000000000000c1',
  marketMaker: 'MM Co',
  addresses: [addr1],
  kpis: { minDepthUsd: 25_000 },
}

const POOL_ID_PROBLEM =
  'poolId must be <dex>:<0x pool address>, or uniswap-v4:<0x pool id of 64 hex digits>, with ' +
  '<dex> one of uniswap-v3, uniswap-v4, aerodrome-v2, aerodrome-slipstream, aero-v2, aero-slipstream'

function problemsOf(input: unknown): string[] {
  try {
    parseMandate(input, now)
  } catch (e) {
    if (e instanceof MandateValidationError) return [...e.problems]
    throw e
  }
  throw new Error('expected parseMandate to throw')
}

describe('parseMandate', () => {
  it('applies the defaults to a minimal registration', () => {
    expect(parseMandate(minimal, now)).toEqual({
      ...minimal,
      kpis: { minDepthUsd: 25_000, ...DEFAULT_MANDATE_KPIS },
      alertWebhookUrl: null,
      alertAfterSamples: 3,
      active: true,
      createdAt: now,
      notes: null,
    })
  })

  it('keeps every explicit field, trims strings, lowercases and de-duplicates addresses', () => {
    const full = parseMandate(
      {
        ...minimal,
        name: '  Demo mandate  ',
        marketMaker: ' MM Co ',
        addresses: [addr1.toUpperCase().replace('0X', '0x'), addr2, addr1],
        kpis: {
          minDepthUsd: 1,
          bandPct: 1,
          maxSpreadBps: 25,
          spreadNotionalUsd: 1_000,
          targetUptime: 1,
        },
        alertWebhookUrl: 'https://example.com/hooks/mm',
        alertAfterSamples: 1,
        active: false,
        createdAt: 1_699_999_999.9,
        notes: ' first mandate ',
        unknown: 'ignored',
      },
      now,
    )
    expect(full).toEqual({
      id: minimal.id,
      name: 'Demo mandate',
      poolId: minimal.poolId,
      marketMaker: 'MM Co',
      addresses: [addr1, addr2],
      kpis: {
        minDepthUsd: 1,
        bandPct: 1,
        maxSpreadBps: 25,
        spreadNotionalUsd: 1_000,
        targetUptime: 1,
      },
      alertWebhookUrl: 'https://example.com/hooks/mm',
      alertAfterSamples: 1,
      active: false,
      createdAt: 1_699_999_999,
      notes: 'first mandate',
    })
    expect(parseMandate({ ...minimal, alertWebhookUrl: null, notes: null }, now).notes).toBeNull()
    expect(
      parseMandate({ ...minimal, kpis: { minDepthUsd: 1, maxSpreadBps: null } }, now).kpis
        .maxSpreadBps,
    ).toBeNull()
    expect(
      parseMandate({ ...minimal, alertWebhookUrl: 'http://hooks.example.com:8080/x' }, now)
        .alertWebhookUrl,
    ).toBe('http://hooks.example.com:8080/x')
  })

  it('rejects anything but an object', () => {
    for (const input of [null, undefined, 42, 'mandate', [minimal]]) {
      expect(() => parseMandate(input, now)).toThrow(MandateValidationError)
      expect(problemsOf(input)).toEqual(['mandate must be a JSON object'])
    }
  })

  it('reports every problem at once', () => {
    const problems = problemsOf({
      id: 'Bad Id',
      name: '   ',
      marketMaker: 7,
      addresses: ['0x1234', addr1, 'nope'],
      alertWebhookUrl: 'ftp://example.com',
      alertAfterSamples: 0,
      active: 'yes',
      createdAt: -1,
      notes: 3,
    })
    expect(problems).toEqual([
      `id must match ${MANDATE_ID_PATTERN}`,
      'name must be a non-empty string',
      POOL_ID_PROBLEM,
      'marketMaker must be a non-empty string',
      'addresses[0] must be a 0x-prefixed 20-byte hex address',
      'addresses[2] must be a 0x-prefixed 20-byte hex address',
      'kpis must be an object with minDepthUsd',
      'alertWebhookUrl must be null or an http(s) URL',
      'alertAfterSamples must be an integer ≥ 1',
      'active must be a boolean',
      'createdAt must be a unix timestamp in seconds',
      'notes must be null or a string',
    ])
    const err = (() => {
      try {
        parseMandate({}, now)
      } catch (e) {
        return e
      }
      return null
    })()
    expect(err).toBeInstanceOf(MandateValidationError)
    expect((err as MandateValidationError).name).toBe('MandateValidationError')
    expect((err as Error).message).toMatch(/^invalid mandate: id must match/)
  })

  it('validates the id pattern and the addresses', () => {
    for (const id of ['ab', 'a'.repeat(41), '-abc', 'abc_def', 'ABC']) {
      expect(problemsOf({ ...minimal, id })).toEqual([`id must match ${MANDATE_ID_PATTERN}`])
    }
    expect(parseMandate({ ...minimal, id: 'a1-' }, now).id).toBe('a1-')
    expect(parseMandate({ ...minimal, id: 'x'.repeat(40) }, now).id).toBe('x'.repeat(40))
    expect(problemsOf({ ...minimal, addresses: [] })).toEqual([
      'addresses must be a non-empty array of 0x addresses',
    ])
    expect(problemsOf({ ...minimal, addresses: addr1 })).toEqual([
      'addresses must be a non-empty array of 0x addresses',
    ])
    expect(problemsOf({ ...minimal, addresses: [`${addr1}0`] })).toEqual([
      'addresses[0] must be a 0x-prefixed 20-byte hex address',
    ])
  })

  it('lowercases the pool id and checks its DEX and length', () => {
    const v3 = 'uniswap-v3:0xD0B53D9277642d899DF5C87A3966A349A798F224'
    expect(parseMandate({ ...minimal, poolId: ` ${v3} ` }, now).poolId).toBe(v3.toLowerCase())
    const v4 = `uniswap-v4:0x${'AB'.repeat(32)}`
    expect(parseMandate({ ...minimal, poolId: v4 }, now).poolId).toBe(v4.toLowerCase())
    const address = '0x00000000000000000000000000000000000000c1'
    for (const dex of ['aero-v2', 'aero-slipstream'])
      expect(parseMandate({ ...minimal, poolId: `${dex}:${address}` }, now).poolId).toBe(
        `${dex}:${address}`,
      )
    for (const poolId of [
      'not a pool at all',
      `uniswap-v9:${address}`,
      address,
      `:${address}`,
      'uniswap-v3:0x1',
      `uniswap-v3:0x${'ab'.repeat(32)}`,
      `uniswap-v4:${address}`,
      `aerodrome-v2:${address}0`,
      `aerodrome-v2:${address.slice(2)}`,
      `aero-v2:0x${'ab'.repeat(32)}`,
      `aero-slipstream:0x${'ab'.repeat(32)}`,
      `aero:${address}`,
      `uniswap-v3:${address}:extra`,
      '',
      42,
      undefined,
    ]) {
      expect(problemsOf({ ...minimal, poolId }), String(poolId)).toEqual([POOL_ID_PROBLEM])
    }
  })

  it('holds the strings and the address list to MANDATE_LIMITS', () => {
    const at = (field: 'name' | 'marketMaker', length: number) =>
      parseMandate({ ...minimal, [field]: 'x'.repeat(length) }, now)[field]
    expect(at('name', MANDATE_LIMITS.name)).toHaveLength(120)
    expect(at('marketMaker', MANDATE_LIMITS.marketMaker)).toHaveLength(120)
    expect(problemsOf({ ...minimal, name: 'x'.repeat(121) })).toEqual([
      'name must be at most 120 characters',
    ])
    expect(problemsOf({ ...minimal, marketMaker: 'x'.repeat(121) })).toEqual([
      'marketMaker must be at most 120 characters',
    ])
    const notes = 'n'.repeat(MANDATE_LIMITS.notes)
    expect(parseMandate({ ...minimal, notes: ` ${notes} ` }, now).notes).toBe(notes)
    expect(problemsOf({ ...minimal, notes: `${notes}n` })).toEqual([
      'notes must be at most 2000 characters',
    ])
    const addresses = (count: number) =>
      Array.from({ length: count }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`)
    expect(
      parseMandate({ ...minimal, addresses: addresses(MANDATE_LIMITS.addresses) }, now).addresses,
    ).toHaveLength(50)
    // One problem for an oversized list, not one per entry.
    expect(problemsOf({ ...minimal, addresses: [...addresses(20_000), 'nope'] })).toEqual([
      'addresses must list at most 50 addresses',
    ])
  })

  it('validates each KPI', () => {
    const kpi = (kpis: unknown) => problemsOf({ ...minimal, kpis })
    expect(kpi({})).toEqual(['kpis.minDepthUsd must be a number > 0'])
    expect(kpi({ minDepthUsd: 0 })).toEqual(['kpis.minDepthUsd must be a number > 0'])
    expect(kpi({ minDepthUsd: '5' })).toEqual(['kpis.minDepthUsd must be a number > 0'])
    expect(kpi({ minDepthUsd: Number.POSITIVE_INFINITY })).toEqual([
      'kpis.minDepthUsd must be a number > 0',
    ])
    for (const bandPct of [0, 100, -1, 'wide', Number.NaN]) {
      expect(kpi({ minDepthUsd: 1, bandPct })).toEqual([
        'kpis.bandPct must be a number between 0 and 100 (exclusive)',
      ])
    }
    expect(
      parseMandate({ ...minimal, kpis: { minDepthUsd: 1, bandPct: 99.9 } }, now).kpis.bandPct,
    ).toBe(99.9)
    expect(kpi({ minDepthUsd: 1, maxSpreadBps: 0 })).toEqual([
      'kpis.maxSpreadBps must be null or a number > 0',
    ])
    expect(kpi({ minDepthUsd: 1, maxSpreadBps: '10' })).toEqual([
      'kpis.maxSpreadBps must be null or a number > 0',
    ])
    expect(kpi({ minDepthUsd: 1, spreadNotionalUsd: 0 })).toEqual([
      'kpis.spreadNotionalUsd must be a number > 0',
    ])
    for (const targetUptime of [0, 1.01, -0.5, null]) {
      expect(kpi({ minDepthUsd: 1, targetUptime })).toEqual([
        'kpis.targetUptime must be a number in (0, 1]',
      ])
    }
    expect(kpi({ minDepthUsd: 0, bandPct: 0, targetUptime: 2 })).toHaveLength(3)
  })

  it('validates the alert settings', () => {
    for (const alertWebhookUrl of ['not a url', 'ftp://host/x', 'mailto:a@b.c', 12]) {
      expect(problemsOf({ ...minimal, alertWebhookUrl })).toEqual([
        'alertWebhookUrl must be null or an http(s) URL',
      ])
    }
    // Delivery is a request from the indexer's network: no local or private host, no user info.
    expect(problemsOf({ ...minimal, alertWebhookUrl: 'http://127.0.0.1:8080/x' })).toEqual([
      'alertWebhookUrl must name a public host, not localhost or a loopback, private, link-local, carrier-grade NAT or unique-local address',
    ])
    expect(problemsOf({ ...minimal, alertWebhookUrl: 'https://u:p@hooks.example.com/x' })).toEqual([
      'alertWebhookUrl must not carry a username or password',
    ])
    for (const alertAfterSamples of [0, -1, 1.5, '3', null]) {
      expect(problemsOf({ ...minimal, alertAfterSamples })).toEqual([
        'alertAfterSamples must be an integer ≥ 1',
      ])
    }
    expect(parseMandate({ ...minimal, alertAfterSamples: 10 }, now).alertAfterSamples).toBe(10)
  })
})

describe('mergeRegistration', () => {
  const existing = parseMandate({ ...minimal, active: false, createdAt: 1_600_000_000 }, now)

  it('keeps the stored active flag and createdAt unless the registration sets them', () => {
    const input = { ...minimal, kpis: { minDepthUsd: 1 } }
    const merged = mergeRegistration(parseMandate(input, now), existing, input)
    expect(merged).toMatchObject({
      active: false,
      createdAt: 1_600_000_000,
      kpis: { minDepthUsd: 1 },
    })
    const resumed = { ...minimal, active: true, createdAt: 1_650_000_000 }
    expect(mergeRegistration(parseMandate(resumed, now), existing, resumed)).toMatchObject({
      active: true,
      createdAt: 1_650_000_000,
    })
  })

  it('stores a new id as parsed', () => {
    const parsed = parseMandate(minimal, now)
    expect(mergeRegistration(parsed, undefined, minimal)).toBe(parsed)
    expect(parsed).toMatchObject({ active: true, createdAt: now })
  })
})

describe('public mandate view', () => {
  const secretUrl = 'https://hooks.slack.com/services/T000/B000/s3cr3t-token?x=1#frag'
  const registration = {
    id: 'acme-weth-usdc',
    name: 'ACME',
    poolId: 'uniswap-v3:0x0000000000000000000000000000000000000001',
    marketMaker: 'ACME Markets',
    addresses: ['0xAbCdEf0000000000000000000000000000000001'],
    kpis: { minDepthUsd: 50_000 },
    notes: 'n',
  }

  it('replaces the webhook URL by a boolean and keeps every other field', () => {
    const withHook = parseMandate({ ...registration, alertWebhookUrl: secretUrl }, 1_700_000_000)
    const without = parseMandate(registration, 1_700_000_000)
    const view = toPublicMandate(withHook)
    expect(view.alertWebhookConfigured).toBe(true)
    expect(toPublicMandate(without).alertWebhookConfigured).toBe(false)
    expect(JSON.stringify(view)).not.toContain('s3cr3t')
    expect('alertWebhookUrl' in view).toBe(false)
    const { alertWebhookUrl: _hidden, ...rest } = withHook
    const { alertWebhookConfigured: _flag, ...viewRest } = view
    expect(viewRest).toEqual(rest)
  })

  it('does not share arrays or objects with the stored mandate', () => {
    const mandate = parseMandate(registration, 1)
    const view = toPublicMandate(mandate)
    expect(view.addresses).not.toBe(mandate.addresses)
    expect(view.kpis).not.toBe(mandate.kpis)
  })

  it('masks a webhook URL to scheme, host and port', () => {
    expect(maskWebhookUrl(secretUrl)).toBe('https://hooks.slack.com/…')
    expect(maskWebhookUrl('http://user:pw@127.0.0.1:8080/hook?t=1')).toBe('http://127.0.0.1:8080/…')
    expect(maskWebhookUrl('not a url')).toBe('…')
  })
})
