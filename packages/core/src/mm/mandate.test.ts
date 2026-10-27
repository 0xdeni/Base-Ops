import { describe, expect, it } from 'vitest'
import { MandateValidationError, maskWebhookUrl, parseMandate, toPublicMandate } from './mandate.js'
import { DEFAULT_MANDATE_KPIS, MANDATE_ID_PATTERN } from './types.js'

const now = 1_700_000_000
const addr1 = '0x00000000000000000000000000000000000000a1'
const addr2 = '0x00000000000000000000000000000000000000b2'

const minimal = {
  id: 'demo-slipstream-weth-usdc',
  name: 'Demo mandate',
  poolId: 'aerodrome-slipstream:0xpool',
  marketMaker: 'MM Co',
  addresses: [addr1],
  kpis: { minDepthUsd: 25_000 },
}

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
      parseMandate({ ...minimal, alertWebhookUrl: 'http://127.0.0.1:8080/x' }, now).alertWebhookUrl,
    ).toBe('http://127.0.0.1:8080/x')
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
      'poolId must be a non-empty string',
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
    for (const alertAfterSamples of [0, -1, 1.5, '3', null]) {
      expect(problemsOf({ ...minimal, alertAfterSamples })).toEqual([
        'alertAfterSamples must be an integer ≥ 1',
      ])
    }
    expect(parseMandate({ ...minimal, alertAfterSamples: 10 }, now).alertAfterSamples).toBe(10)
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
