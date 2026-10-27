import { describe, expect, it } from 'vitest'
import {
  BADGE_COLOURS,
  badgeMessage,
  formatUptimePct,
  LABEL_COLOUR,
  renderBadge,
  svgDataUri,
} from './badge.js'

describe('badge renderer (mirror of apps/api/src/badge.ts)', () => {
  it('formats the 7 d uptime like the API', () => {
    expect(formatUptimePct(0.9638)).toBe('96.4%')
    expect(formatUptimePct(1)).toBe('100%')
    expect(formatUptimePct(0)).toBe('0%')
    expect(formatUptimePct(null)).toBe('n/a')
    expect(badgeMessage('no-data', null)).toBe('no-data · 7d n/a')
  })

  it('renders a two-part SVG coloured by status', () => {
    const svg = renderBadge({ status: 'breached', uptime: { d7: { uptime: 0.5 } } })
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?><svg xmlns=')).toBe(true)
    expect(svg).toContain('<title>depthwatch: breached · 7d 50%</title>')
    expect(svg).toContain(`fill="${BADGE_COLOURS.breached}"`)
    expect(svg).toContain('role="img"')
    expect(renderBadge({ status: 'ok', uptime: { d7: { uptime: 1 } } })).toContain(
      `fill="${BADGE_COLOURS.ok}"`,
    )
    expect(renderBadge({ status: 'inactive', uptime: { d7: { uptime: null } } })).toContain(
      `fill="${BADGE_COLOURS['no-data']}"`,
    )
  })

  it('uses the visual.md §6 badge colours, the same as the API', () => {
    expect({ label: LABEL_COLOUR, ...BADGE_COLOURS }).toEqual({
      label: '#2a3140',
      ok: '#1c7a4c',
      breached: '#b8232f',
      'no-data': '#5c6573',
      inactive: '#5c6573',
    })
    expect(renderBadge({ status: 'ok', uptime: { d7: { uptime: 1 } } })).toContain(
      `fill="${LABEL_COLOUR}"`,
    )
  })

  it('inlines the SVG as a data URI', () => {
    expect(svgDataUri('<svg/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  })
})
