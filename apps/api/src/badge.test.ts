import type { ScorecardStatus, UptimeWindow } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { BADGE_COLOURS, badgeMessage, formatUptimePct, LABEL_COLOUR, renderBadge } from './badge.js'

/** WCAG 2.x contrast ratio of white text on `#rrggbb`. */
function contrastWithWhite(hex: string): number {
  const channel = (i: number): number => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
  return 1.05 / (luminance + 0.05)
}

function uptime(d7: number | null): { h24: UptimeWindow; d7: UptimeWindow; d30: UptimeWindow } {
  const w = (windowHours: number, value: number | null): UptimeWindow => ({
    windowHours,
    samples: value === null ? 0 : 10,
    withinKpi: value === null ? 0 : Math.round(value * 10),
    uptime: value,
  })
  return { h24: w(24, d7), d7: w(168, d7), d30: w(720, d7) }
}

describe('formatUptimePct', () => {
  it('rounds to one decimal and drops a trailing .0', () => {
    expect(formatUptimePct(1)).toBe('100%')
    expect(formatUptimePct(0.96385)).toBe('96.4%')
    expect(formatUptimePct(0.24)).toBe('24%')
    expect(formatUptimePct(0)).toBe('0%')
    expect(formatUptimePct(0.99996)).toBe('100%')
  })

  it('shows n/a without samples', () => {
    expect(formatUptimePct(null)).toBe('n/a')
    expect(formatUptimePct(Number.NaN)).toBe('n/a')
  })
})

describe('renderBadge', () => {
  it('reads "depthwatch | <status> · 7d <uptime>%"', () => {
    const svg = renderBadge({ status: 'ok', uptime: uptime(0.9638) })
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?><svg ')).toBe(true)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('>depthwatch</text>')
    expect(svg).toContain('>ok · 7d 96.4%</text>')
    expect(svg).toContain('<title>depthwatch: ok · 7d 96.4%</title>')
    expect(badgeMessage('ok', 0.9638)).toBe('ok · 7d 96.4%')
  })

  it.each<[ScorecardStatus, number | null, string]>([
    ['ok', 1, BADGE_COLOURS.ok],
    ['breached', 0.24, BADGE_COLOURS.breached],
    ['no-data', null, BADGE_COLOURS['no-data']],
    ['inactive', 0.5, BADGE_COLOURS.inactive],
  ])('colours %s', (status, d7, colour) => {
    const svg = renderBadge({ status, uptime: uptime(d7) })
    expect(svg).toContain(`fill="${colour}"`)
    expect(svg).toContain(`>${badgeMessage(status, d7)}</text>`)
  })

  it('uses the visual.md §6 colours, each carrying white 11 px text at 4.5:1 or more', () => {
    expect({ label: LABEL_COLOUR, ...BADGE_COLOURS }).toEqual({
      label: '#2a3140',
      ok: '#1c7a4c',
      breached: '#b8232f',
      'no-data': '#5c6573',
      inactive: '#5c6573',
    })
    const svg = renderBadge({ status: 'ok', uptime: uptime(1) })
    expect(svg).toContain(`fill="${LABEL_COLOUR}"`)
    for (const colour of [LABEL_COLOUR, ...Object.values(BADGE_COLOURS)])
      expect(contrastWithWhite(colour), colour).toBeGreaterThanOrEqual(4.5)
  })

  it('uses green, red and grey for ok, breached and no-data', () => {
    expect(BADGE_COLOURS.ok).toMatch(/^#[0-9a-f]{6}$/)
    expect(BADGE_COLOURS.ok).not.toBe(BADGE_COLOURS.breached)
    expect(BADGE_COLOURS['no-data']).toBe(BADGE_COLOURS.inactive)
    expect(renderBadge({ status: 'no-data', uptime: uptime(null) })).toContain('no-data · 7d n/a')
  })

  it('sizes the badge to its text and keeps the two halves adjacent', () => {
    const svg = renderBadge({ status: 'breached', uptime: uptime(0) })
    const width = Number(/<svg[^>]* width="(\d+)"/.exec(svg)?.[1])
    const left = Number(/<rect width="(\d+)" height="20" fill=/.exec(svg)?.[1])
    const right = Number(/<rect x="\d+" width="(\d+)"/.exec(svg)?.[1])
    expect(left).toBeGreaterThan(0)
    expect(right).toBeGreaterThan(left)
    expect(width).toBe(left + right)
    expect(svg).toContain(`<rect x="${left}" width="${right}"`)
    expect(svg).toContain('height="20"')
  })

  it('is well-formed XML with no unescaped characters', () => {
    const svg = renderBadge({ status: 'ok', uptime: uptime(1) })
    expect(svg).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/)
    expect((svg.match(/<svg/g) ?? []).length).toBe(1)
    expect(svg.endsWith('</svg>')).toBe(true)
  })
})
