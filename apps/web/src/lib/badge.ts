/**
 * The scorecard badge as the API renders it (`apps/api/src/badge.ts`): "depthwatch | <status> ·
 * 7d <uptime>%", green for `ok`, red for `breached`, grey otherwise. The dashboard may not import
 * the API package, so the renderer is repeated here, byte for byte, for the mock client and for
 * the embed preview: what the mock serves is exactly what the API would.
 */
import type { ScorecardStatus, UptimeWindow } from '@depthwatch/core'

export const BADGE_CONTENT_TYPE = 'image/svg+xml'

const LABEL = 'depthwatch'
/** Badge colours (docs/design/visual.md §6): white 11 px text clears 4.5:1 on every part. */
export const LABEL_COLOUR = '#2a3140'
export const BADGE_COLOURS: Readonly<Record<ScorecardStatus, string>> = Object.freeze({
  ok: '#1c7a4c',
  breached: '#b8232f',
  'no-data': '#5c6573',
  inactive: '#5c6573',
})

/** Average glyph width of 11 px Verdana / DejaVu Sans, the fonts README badges assume. */
const CHAR_WIDTH = 6.4
const PADDING = 6
const HEIGHT = 20
const FONT = 'Verdana,DejaVu Sans,Geneva,sans-serif'

/** `0.9638` → `96.4%`, `1` → `100%`, null → `n/a`. */
export function formatUptimePct(uptime: number | null): string {
  if (uptime === null || !Number.isFinite(uptime)) return 'n/a'
  const pct = Math.round(uptime * 1000) / 10
  return `${pct}%`
}

/** The right-hand text of the badge: `<status> · 7d <uptime>`. */
export function badgeMessage(status: ScorecardStatus, uptime7d: number | null): string {
  return `${status} · 7d ${formatUptimePct(uptime7d)}`
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function textWidth(text: string): number {
  return Math.ceil(text.length * CHAR_WIDTH + 2 * PADDING)
}

/** The badge SVG document for a scorecard summary (its status and 7 d uptime). */
export function renderBadge(summary: {
  status: ScorecardStatus
  uptime: { d7: Pick<UptimeWindow, 'uptime'> }
}): string {
  const message = badgeMessage(summary.status, summary.uptime.d7.uptime)
  const leftWidth = textWidth(LABEL)
  const rightWidth = textWidth(message)
  const width = leftWidth + rightWidth
  const colour = BADGE_COLOURS[summary.status]
  const title = escapeXml(`${LABEL}: ${message}`)
  const textY = 14
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}">`,
    `<title>${title}</title>`,
    `<clipPath id="r"><rect width="${width}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>`,
    '<g clip-path="url(#r)">',
    `<rect width="${leftWidth}" height="${HEIGHT}" fill="${LABEL_COLOUR}"/>`,
    `<rect x="${leftWidth}" width="${rightWidth}" height="${HEIGHT}" fill="${colour}"/>`,
    '</g>',
    `<g fill="#fff" text-anchor="middle" font-family="${FONT}" font-size="11">`,
    `<text x="${leftWidth / 2}" y="${textY}">${escapeXml(LABEL)}</text>`,
    `<text x="${leftWidth + rightWidth / 2}" y="${textY}">${escapeXml(message)}</text>`,
    '</g>',
    '</svg>',
  ].join('')
}

/** An `<img src>` value carrying the SVG inline, so the preview needs no second request. */
export function svgDataUri(svg: string): string {
  return `data:${BADGE_CONTENT_TYPE};charset=utf-8,${encodeURIComponent(svg)}`
}
