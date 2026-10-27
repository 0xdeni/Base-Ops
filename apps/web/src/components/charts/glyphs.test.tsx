import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { BulletGraph, bulletFractions, depthBullet } from './BulletGraph.js'
import { SNAPSHOT, samples } from './chartFixtures.js'
import { HealthBar, healthFill, healthLabel, weakestPart } from './HealthBar.js'
import { glyphWidth, RowDepthGlyph } from './RowDepthGlyph.js'
import { ShareBar, shareParts } from './ShareBar.js'
import { lollipopAxis, lollipopLabel, SpreadLollipop } from './SpreadLollipop.js'
import {
  MEANINGFUL_GAP_SCORE,
  MEANINGFUL_GAP_TURNOVER,
  TurnoverGlyph,
  turnoverLabel,
} from './TurnoverGlyph.js'
import { stripCells, stripLabel, UptimeStrip } from './UptimeStrip.js'

afterEach(cleanup)

const NB = ' '
const style = (el: Element | null | undefined, name: string) =>
  (el as HTMLElement | null)?.style.getPropertyValue(name)

describe('UptimeStrip (CH8)', () => {
  it('draws one cell per sample: neutral within KPI, marked when breached, hollow unevaluable', () => {
    const pts = samples('oobbuo')
    const { container } = render(<UptimeStrip points={pts} />)
    const cells = [...container.querySelectorAll('.strip i')]
    expect(cells.map((c) => c.className)).toEqual(['', '', 'b', 'b', 'u', ''])
    expect(cells[0]?.getAttribute('title')).toBe(`16${NB}Oct, 00:00${NB}UTC`)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '3 of 5 samples within KPI, 1 not evaluable',
    )
    expect(container.querySelector('.strip-axis')?.textContent).toBe(`16${NB}Oct, 00:00${NB}UTCnow`)
  })

  it('counts like the uptime: "36 of 84 samples within KPI"', () => {
    const pattern = 'o'.repeat(36) + 'b'.repeat(48)
    expect(stripLabel(samples(pattern))).toBe('36 of 84 samples within KPI')
  })

  it('groups neighbours when the strip is too narrow, never averaging a breach away', () => {
    const pts = samples(`${'o'.repeat(179)}b${'o'.repeat(180)}`)
    const cells = stripCells(pts, 343)
    expect(cells.length).toBeLessThanOrEqual(Math.floor(343 / 3))
    expect(cells.filter((c) => c.kind === 'bad')).toHaveLength(1)
    expect(cells.reduce((n, c) => n + c.samples, 0)).toBe(360)
    expect(stripCells(pts, 1200)).toHaveLength(360)
  })
})

describe('SpreadLollipop', () => {
  it('shares one bps axis from 0 with nice ticks, the last one carrying the unit', () => {
    expect(lollipopAxis(SNAPSHOT.spreads)).toEqual({ max: 15, ticks: [0, 5, 10] })
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={SNAPSHOT.spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.dp-last')?.textContent).toBe(`15${NB}bps`)
    expect(container.querySelector('.dp-last .gloss')).toBeTruthy()
    const tracks = [...container.querySelectorAll('.dp-track')]
    expect(Number(style(tracks[2], '--x'))).toBeCloseTo(13.83 / 15, 9)
    // Past 72 % of the axis the value sits left of its dot.
    expect(container.querySelectorAll('.dp-val.to-left')).toHaveLength(1)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Effective spread: $1K costs 10.0${NB}bps, $10K costs 10.4${NB}bps, $100K costs 13.8${NB}bps.`,
    )
  })

  it('shows a notional the pool cannot absorb as a hollow point labelled "Can’t absorb"', () => {
    const spreads = SNAPSHOT.spreads.map((s) =>
      s.notionalUsd === 100_000 ? { ...s, spreadBps: null, feasible: false } : s,
    )
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('.dp-hollow')).toHaveLength(1)
    expect(screen.getByText('Can’t absorb')).toBeTruthy()
    expect(lollipopLabel(spreads)).toContain('$100K can’t be absorbed')
    expect(lollipopAxis(spreads).max).toBe(15)
  })

  it('treats a stored spread of 10,000 bps or more as one the pool cannot absorb', () => {
    // the first live run stored 1.4e24 bps for a pool of 7e-17 USD
    const spreads = SNAPSHOT.spreads.map((s) =>
      s.notionalUsd === 100_000 ? { ...s, spreadBps: 1.449e24, feasible: true } : s,
    )
    const { container } = render(
      <MemoryRouter>
        <SpreadLollipop spreads={spreads} />
      </MemoryRouter>,
    )
    expect(container.querySelectorAll('.dp-hollow')).toHaveLength(1)
    expect(screen.getByText('Can’t absorb')).toBeTruthy()
    expect(lollipopLabel(spreads)).toContain('$100K can’t be absorbed')
    expect(lollipopLabel(spreads)).not.toMatch(/\d{5,}/)
    expect(lollipopAxis(spreads).max).toBe(15) // the axis ignores it
  })
})

describe('HealthBar (CH8)', () => {
  const c = { depth: 33.1, spread: 22.4, concentration: 5.5, persistence: 19.2 }

  it('fills each segment to its component ÷ weight and names the weakest', () => {
    expect(healthFill(c, 'depth')).toBeCloseTo(33.1 / 35, 9)
    expect(healthFill({ ...c, spread: 40 }, 'spread')).toBe(1)
    expect(weakestPart(c)).toBe('concentration')
    expect(healthLabel(c)).toBe(
      'Depth 33.1 of 35, Spread 22.4 of 25, Concentration 5.5 of 20, Persistence 19.2 of 20',
    )
  })

  it('shows names with weights, not the score (ia-v3 §4.3)', () => {
    const { container } = render(<HealthBar components={c} />)
    const names = [...container.querySelectorAll('.hbar-names > span')].map((s) => s.textContent)
    expect(names).toEqual(['Depth 35', 'Spread 25', 'Concentration 20', 'Persistence 20'])
    expect(container.querySelector('.hbar-names .weak')?.textContent).toBe('Concentration 20')
    expect(container.textContent).not.toContain('80')
  })

  it('has an 80 × 4 table variant without names', () => {
    const { container } = render(<HealthBar components={c} mini />)
    expect(container.querySelector('.hbar.mini')).toBeTruthy()
    expect(container.querySelector('.hbar-names')).toBeNull()
  })
})

describe('ShareBar', () => {
  it('splits the bar into the top LP, the next two and everyone else', () => {
    const p = shareParts(0.53, 0.93)
    expect(p.top).toBe(0.53)
    expect(p.next).toBeCloseTo(0.4, 9)
    expect(p.rest).toBeCloseTo(0.07, 9)
    expect(shareParts(0.6, 0.5)).toEqual({ top: 0.6, next: 0, rest: 0.4 })
    render(<ShareBar top1Share={0.53} top3Share={0.93} owners={4} bandPct={5} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      `Top LP 53${NB}%, next two 40${NB}%, everyone else 7${NB}%`,
    )
    expect(screen.getByText(/^4 owners within ±5/)).toBeTruthy()
  })
})

describe('TurnoverGlyph', () => {
  it('ticks the 3× threshold at core’s own gap score', () => {
    expect(MEANINGFUL_GAP_TURNOVER).toBe(3)
    expect(MEANINGFUL_GAP_SCORE).toBeCloseTo(23.86, 2)
    expect(turnoverLabel(85.29)).toBe('Gap score 85 of 100; 3× turnover is 24')
    const { container } = render(<TurnoverGlyph gapScore={85.29} />)
    expect(Number(style(container.querySelector('.meter'), '--v'))).toBeCloseTo(0.8529, 9)
    expect(container.querySelector('.gap-meter .num')?.textContent).toBe('85')
  })

  it('draws rows under 3× quiet and an unknown score as a dash', () => {
    const { container } = render(<TurnoverGlyph gapScore={null} quiet />)
    expect(container.querySelector('.gap-meter.quiet')).toBeTruthy()
    expect(container.querySelector('.num')?.textContent).toBe('—')
  })
})

describe('BulletGraph', () => {
  it('scales depth bullets to 1.5× the KPI, so the tick sits at two thirds', () => {
    const f = bulletFractions(depthBullet(7_820, 50_000))
    expect(f.t).toBeCloseTo(2 / 3, 9)
    expect(f.v).toBeCloseTo(7_820 / 75_000, 9)
    expect(bulletFractions(depthBullet(200_000, 50_000)).v).toBe(1)
    expect(bulletFractions(depthBullet(null, 50_000)).v).toBe(0)
  })

  it('is an image with a sentence', () => {
    const { container } = render(
      <BulletGraph value={0.429} target={0.95} label="7 day uptime 42.9 % against a 95 % target" />,
    )
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toBe('7 day uptime 42.9 % against a 95 % target')
    expect(style(container.querySelector('.bullet'), '--t')).toBe('0.95')
  })
})

describe('RowDepthGlyph (CH8)', () => {
  it('draws each side to max(1, v / max × 38) px on the table’s shared scale', () => {
    expect(glyphWidth(6_079_641, 6_079_641)).toBe(38)
    expect(glyphWidth(15_592, 6_079_641)).toBe(1)
    expect(glyphWidth(null, 6_079_641)).toBe(0)
    expect(glyphWidth(0, 6_079_641)).toBe(0)
    const { container } = render(<RowDepthGlyph sell={3_000_000} buy={6_000_000} max={6_000_000} />)
    const [sell, buy] = [...container.querySelectorAll('rect')]
    expect(sell?.getAttribute('x')).toBe('21.00')
    expect(sell?.getAttribute('width')).toBe('19.00')
    expect(buy?.getAttribute('width')).toBe('38.00')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
