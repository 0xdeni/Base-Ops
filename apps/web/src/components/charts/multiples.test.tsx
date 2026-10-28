import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '../../api/types.js'
import { bracketLabel, dataRange, fittedDomain, printsLevel, seriesYDomain } from './Multiple.js'
import { type MultipleSeries, SmallMultiples } from './SmallMultiples.js'
import { seriesRuns } from './seriesRuns.js'

afterEach(cleanup)

const NB = ' '
const T0 = 1_792_108_800 // 16 Oct 2026, 00:00 UTC

function history(n: number, at: (i: number) => Partial<HistoryPoint> = () => ({})): HistoryPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    timestamp: T0 + i * 7200,
    price: 2460,
    depth2Usd: 10_000_000 + (i % 6) * 250_000,
    spread10kBps: 10.3 + (i % 2) * 0.1,
    tvlUsd: null,
    health: 88,
    ...at(i),
  }))
}

const SERIES: MultipleSeries<HistoryPoint>[] = [
  {
    key: 'depth',
    label: 'Depth ±2 %',
    value: (p) => p.depth2Usd,
    format: (v) => (v === null ? '—' : `$${(v / 1e6).toFixed(2)}M`),
    tick: (v) => `$${v / 1e6}M`,
    band: [10_100_000, 10_600_000],
    bandLabel: 'p10 to median, 7 d',
  },
  {
    key: 'spread',
    label: 'Spread at $10K',
    value: (p) => p.spread10kBps,
    format: (v) => (v === null ? '—' : `${v.toFixed(1)} bps`),
    tick: (v) => v.toFixed(1),
    minSpan: 0.2,
  },
]

describe('seriesRuns (CH5: gaps are never interpolated)', () => {
  it('splits at unknown values and at long silences, and bridges them with dashed segments', () => {
    const pts = history(10, (i) => (i === 3 ? { depth2Usd: null } : {}))
    pts[8]!.timestamp += 7200 * 5
    pts[9]!.timestamp += 7200 * 5
    const runs = seriesRuns(pts, (p) => p.depth2Usd)
    expect(runs.solid.map((r) => r.length)).toEqual([3, 4, 2])
    expect(runs.gaps).toHaveLength(2)
    expect(runs.gaps[0]?.[0].timestamp).toBe(pts[2]?.timestamp)
    expect(runs.gaps[0]?.[1].timestamp).toBe(pts[4]?.timestamp)
  })
})

describe('SmallMultiples (visual-v4 §5.9.6)', () => {
  const pts = history(85)
  const day = 86_400
  const end = pts[84]!.timestamp
  const ticksOf = (c: HTMLElement, i = 0) =>
    [...(c.querySelectorAll('.sm')[i]?.querySelectorAll('svg text.chart-text') ?? [])]
      .filter((t) => Number(t.getAttribute('y')) > 100)
      .map((t) => t.textContent)

  it('draws one image per multiple with its range in words, a 3 px line and square points', () => {
    const { container } = render(
      <SmallMultiples
        points={pts}
        series={SERIES}
        domain={[end - day, end]}
        windowLabel="24 hours"
      />,
    )
    const imgs = screen.getAllByRole('img')
    expect(imgs.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Depth ±2 % over 24 hours: between $10.00M and $11.25M, latest $10.00M.',
      'Spread at $10K over 24 hours: between 10.3 bps and 10.4 bps, latest 10.3 bps.',
    ])
    expect(container.querySelectorAll('.sm')).toHaveLength(2)
    expect(container.querySelectorAll('.sm')[0]?.querySelectorAll('rect.sm-pt')).toHaveLength(13)
    expect(container.querySelectorAll('.sm-band')).toHaveLength(1)
    expect(screen.getByText('p10 to median, 7 d')).toBeTruthy()
    expect(ticksOf(container).every((l) => /^\d\d:00$/.test(l ?? ''))).toBe(true)
    // The head carries the latest value.
    expect(container.querySelector('.sm-h b')?.textContent).toBe('$10.00M')
  })

  it('labels the cropped y range with its maximum and minimum at the bracket’s ends', () => {
    const { container } = render(
      <SmallMultiples
        points={pts}
        series={SERIES}
        domain={[end - day, end]}
        windowLabel="24 hours"
      />,
    )
    const range = container.querySelectorAll('.sm')[0]?.querySelector('.sm-range')
    const [top, bottom] = [...(range?.querySelectorAll('text') ?? [])].map((t) => t.textContent)
    expect([top, bottom]).toEqual(['$11.25M', '$10M'])
    const line = range?.querySelector('line')
    expect(Number(line?.getAttribute('y1'))).toBeLessThan(Number(line?.getAttribute('y2')))
    // The spread's ends take its tick format, which tells them apart.
    const spread = [
      ...(container.querySelectorAll('.sm')[1]?.querySelectorAll('.sm-range text') ?? []),
    ]
    expect(spread.map((t) => t.textContent)).toEqual(['10.4', '10.3'])
  })

  it('draws a series that moves less than its precision level at mid-height, with one label', () => {
    const flat = history(5, (i) => ({ spread10kBps: i === 0 ? 60.227 : 60.226 }))
    const spread: MultipleSeries<HistoryPoint> = {
      key: 'spread',
      label: 'Spread at $10K',
      value: (p) => p.spread10kBps,
      format: (v) => (v === null ? '—' : `${v.toFixed(1)} bps`),
      minSpan: 0.02,
    }
    const { container } = render(
      <SmallMultiples
        points={flat}
        series={[spread]}
        domain={[flat[0]!.timestamp, flat[4]!.timestamp]}
        windowLabel="24 hours"
      />,
    )
    // The plot runs from y 10 to y 102 (132 − 30): the line stays within 10 % of it, mid-height.
    const ys = [...container.querySelectorAll('rect.sm-pt')].map(
      (r) => Number(r.getAttribute('y')) + 5,
    )
    expect(ys).toHaveLength(5)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.1 * 92)
    expect(Math.abs((Math.max(...ys) + Math.min(...ys)) / 2 - 56)).toBeLessThan(0.1 * 92)
    const range = container.querySelector('.sm-range')
    expect([...(range?.querySelectorAll('text') ?? [])].map((t) => t.textContent)).toEqual([
      '60.2 bps',
    ])
    expect(range?.querySelector('line')).toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Spread at $10K over 24 hours: 60.2 bps throughout, latest 60.2 bps.',
    )
  })

  it('fits the x axis to the samples, with ticks every 15 minutes under 2 hours', () => {
    const t0 = T0 + 10 * 3600 + 39 * 60
    const short = [0, 12, 24, 39, 51].map((m, i) => ({
      ...history(1)[0]!,
      timestamp: t0 + m * 60,
      depth2Usd: 800_000 + i * 5_000,
    }))
    const { container } = render(
      <SmallMultiples
        points={short}
        series={[SERIES[0]!]}
        domain={[t0 + 51 * 60 - day, t0 + 51 * 60]}
        windowLabel="24 hours"
      />,
    )
    expect(ticksOf(container)).toEqual(['10:45', '11:00', '11:15', '11:30'])
    const xs = [...container.querySelectorAll('rect.sm-pt')].map(
      (r) => Number(r.getAttribute('x')) + 5,
    )
    expect(xs[0]).toBeCloseTo(8, 6)
    expect(xs[4]).toBeCloseTo(720 - 76, 6)
  })

  it('says so in a sentence when the window holds fewer than 2 snapshots', () => {
    render(
      <SmallMultiples
        points={pts.slice(0, 1)}
        series={SERIES}
        domain={[T0 - day, T0]}
        windowLabel="24 hours"
      />,
    )
    expect(screen.getByText('Fewer than 2 snapshots in this window.')).toBeTruthy()
  })

  it('draws a reference line in the y domain, labelled at its left (a KPI)', () => {
    const withKpi: MultipleSeries<HistoryPoint>[] = [
      { ...SERIES[1]!, reference: { value: 40, label: 'KPI 40.0' } },
    ]
    const { container } = render(
      <SmallMultiples
        points={pts}
        series={withKpi}
        domain={[end - day, end]}
        windowLabel="24 hours"
      />,
    )
    const line = container.querySelector('.sm-ref')
    expect(line).toBeTruthy()
    const y = Number(line?.getAttribute('y1'))
    // The spread sits near 10 bps, far under the KPI: the KPI still lies inside the plot.
    expect(y).toBeGreaterThanOrEqual(10)
    expect(y).toBeLessThan(132 - 30)
    expect(screen.getByText('KPI 40.0').getAttribute('class')).toContain('is-strong')
  })

  it('switches to weekday ticks on the 7 d window', () => {
    const { container } = render(
      <SmallMultiples
        points={pts}
        series={SERIES}
        domain={[T0, end]}
        windowLabel="7 days"
        instant
      />,
    )
    expect(ticksOf(container)).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
  })

  it('scrubs with the arrow keys: the heads rewrite and the time shows', () => {
    const onScrub = vi.fn()
    const { container } = render(
      <SmallMultiples
        points={pts}
        series={SERIES}
        domain={[end - day, end]}
        windowLabel="24 hours"
        onScrub={onScrub}
      />,
    )
    const group = screen.getByRole('group')
    const times = () => [...container.querySelectorAll('.sm-h .mt')].map((e) => e.textContent)
    expect(times()).toEqual([])
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[84])
    expect(times()).toEqual([])
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[83])
    expect(times()).toEqual([` 22${NB}Oct, 22:00`, ` 22${NB}Oct, 22:00`])
    expect(container.querySelectorAll('.xh')).toHaveLength(2)
    expect(container.querySelectorAll('rect.sm-pt.is-on')).toHaveLength(2)
    expect(container.querySelector('[aria-live]')?.textContent).toContain(
      `22${NB}Oct, 22:00${NB}UTC`,
    )
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(onScrub).toHaveBeenLastCalledWith(null)
    expect(container.querySelectorAll('.xh')).toHaveLength(0)
  })

  it('only steps through the samples inside the window', () => {
    const onScrub = vi.fn()
    render(
      <SmallMultiples
        points={pts}
        series={SERIES}
        domain={[end - day, end]}
        windowLabel="24 hours"
        onScrub={onScrub}
      />,
    )
    const group = screen.getByRole('group')
    for (let i = 0; i < 40; i++) fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[72])
  })
})

describe('small multiple scales', () => {
  const pts = history(6)
  it('fits the x domain to the samples, or keeps the window with fewer than 2', () => {
    expect(fittedDomain(pts, [0, 1])).toEqual([T0, T0 + 5 * 7200])
    expect(fittedDomain(pts.slice(0, 1), [7, 9])).toEqual([7, 9])
  })

  it('crops y to the data, padded 12 % of its span, with the reference inside', () => {
    const s = SERIES[0]!
    expect(dataRange(pts, s.value)).toEqual([10_000_000, 11_250_000])
    const plain = { ...s, band: null }
    const [lo, hi] = seriesYDomain(pts, plain)
    expect(lo).toBeCloseTo(10_000_000 - 150_000, 6)
    expect(hi).toBeCloseTo(11_250_000 + 150_000, 6)
    const [, top] = seriesYDomain(pts, { ...plain, reference: { value: 20_000_000, label: 'KPI' } })
    expect(top).toBeGreaterThan(20_000_000)
    expect(seriesYDomain([], plain)).toEqual([0, 1])
  })

  it('centres a series whose ends print the same in at least 10× its span and 2 % of its median', () => {
    const flat = history(2, (i) => ({ depth2Usd: 1_000_000 + i * 100 }))
    const usd = { ...SERIES[0]!, band: null, tick: undefined, format: () => '$1.00M' }
    expect(printsLevel(usd, [1_000_000, 1_000_100])).toBe(true)
    const [lo, hi] = seriesYDomain(flat, usd)
    // 2 % of the $1.00M median beats 10 × the $100 span; 12 % padding on top.
    expect(hi - lo).toBeCloseTo(20_001 * 1.24, 6)
    expect((lo + hi) / 2).toBeCloseTo(1_000_050, 6)
    // A tick that tells the ends apart labels them, and the range stays cropped to the data.
    expect(printsLevel(SERIES[1]!, [10.3, 10.4])).toBe(false)
    expect(bracketLabel(SERIES[1]!, [10.3, 10.4])(10.4)).toBe('10.4')
    expect(bracketLabel({ ...SERIES[1]!, tick: (v) => v.toFixed(0) }, [10.3, 10.4])(10.4)).toBe(
      '10.4 bps',
    )
  })
})
