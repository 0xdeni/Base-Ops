import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint, MmSampleDto } from '../../api/types.js'
import { linear } from '../../lib/scale.js'
import { MarketMakerTable } from './ChartTables.js'
import { samples } from './chartFixtures.js'
import { MarketMakerChart } from './MarketMakerChart.js'
import { bandSpan, LABEL_GAP, mmScaleMax, mmYLabels, sampleStatus } from './mmModel.js'
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
    height: 160,
    value: (p) => p.depth2Usd,
    format: (v) => (v === null ? '—' : `$${(v / 1e6).toFixed(2)}M`),
    tick: (v) => `$${v / 1e6}M`,
    band: [10_100_000, 10_600_000],
    bandLabel: 'p10 to median, 7 d',
  },
  {
    key: 'spread',
    label: 'Spread at $10K',
    height: 120,
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

describe('SmallMultiples', () => {
  const pts = history(85)
  const day = 86_400
  const end = pts[84]!.timestamp

  it('draws one image per multiple on a shared time axis', () => {
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
      'Depth ±2 % over 24 hours: latest $10.00M.',
      'Spread at $10K over 24 hours: latest 10.3 bps.',
    ])
    const axis = [...container.querySelectorAll('.ts-axis text')].map((t) => t.textContent)
    expect(axis.every((l) => /^\d\d:00$/.test(l ?? ''))).toBe(true)
    expect(container.querySelectorAll('.mult-band')).toHaveLength(1)
    expect(screen.getByText('p10 to median, 7 d')).toBeTruthy()
  })

  it('draws a reference line in the y domain, labelled in the right pad (a KPI)', () => {
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
    const line = container.querySelector('.mult-ref')
    expect(line).toBeTruthy()
    const y = Number(line?.getAttribute('y1'))
    // The spread sits near 10 bps, far under the KPI: the KPI still lies inside the plot.
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(84)
    expect(screen.getByText('KPI 40.0').getAttribute('class')).toContain('is-strong')
    expect(container.querySelectorAll('.mult-ref')).toHaveLength(1)
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
    const axis = [...container.querySelectorAll('.ts-axis text')].map((t) => t.textContent)
    expect(axis).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  })

  it('scrubs with the arrow keys: the heads rewrite and the time replaces "now"', () => {
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
    const heads = () => [...container.querySelectorAll('.mult-head .mt')].map((e) => e.textContent)
    expect(heads()).toEqual(['now', 'now'])
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[84])
    expect(heads()).toEqual(['now', 'now'])
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[83])
    expect(heads()).toEqual([`22${NB}Oct, 22:00`, `22${NB}Oct, 22:00`])
    expect(container.querySelectorAll('.xh')).toHaveLength(2)
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

describe('market-maker scales', () => {
  const pts = samples('ooobbbbbbbbooo')

  it('sets the symmetric max at ceil(max(1.25 × KPI, values) × 1.08 / step) × step', () => {
    // max(62.5K, 60K) × 1.08 = 67.5K, rounded up to the 20K step: 80K.
    expect(mmScaleMax(50_000, pts, false)).toBe(80_000)
    const big = pts.map((p) => ({
      ...p,
      attribution: { ...p.attribution, poolDepthUpUsd: 200_000 },
    }))
    expect(mmScaleMax(50_000, big, false)).toBe(80_000)
    expect(mmScaleMax(50_000, big, true)).toBe(250_000)
  })

  // The desktop plot: 340 px tall, top 8, bottom 28.
  const yOf = (M: number) => linear(-M, M, 340 - 28, 8)

  // The phone plot: 240 px tall, top 8, bottom 28.
  const yPhone = (M: number) => linear(-M, M, 240 - 28, 8)
  const gaps = (labels: readonly { v: number }[], fy: (v: number) => number) => {
    const ys = labels.map((l) => fy(l.v)).sort((a, b) => a - b)
    return ys.slice(1).map((y, i) => y - (ys[i] ?? 0))
  }

  it('ticks at 0.5× and 1.5× the KPI, evenly around it (visual-v3.md §5.9)', () => {
    for (const fy of [yOf(80_000), yPhone(80_000)]) {
      const labels = mmYLabels(50_000, 80_000, fy)
      expect(labels.map((l) => l.text)).toEqual([
        'KPI $50K',
        'KPI $50K',
        '0',
        '$25K',
        '$25K',
        '$75K',
        '$75K',
      ])
      expect(labels.filter((l) => l.strong).map((l) => l.v)).toEqual([50_000, -50_000])
      for (const g of gaps(labels, fy)) expect(g).toBeGreaterThanOrEqual(LABEL_GAP)
    }
  })

  it('reads top to bottom $75K, KPI $50K, $25K, 0 on the demo scale', () => {
    const M = mmScaleMax(50_000, pts, false)
    const fy = yOf(M)
    const order = mmYLabels(50_000, M, fy)
      .sort((a, b) => fy(a.v) - fy(b.v))
      .map((l) => l.text)
    expect(order).toEqual(['$75K', 'KPI $50K', '$25K', '0', '$25K', 'KPI $50K', '$75K'])
  })

  it('skips multiples within 0.2 M of the KPI: $500K and $750K around $250K', () => {
    for (const M of [1_100_000, 1_200_000]) {
      const labels = mmYLabels(250_000, M, yOf(M))
      expect(labels.filter((l) => !l.strong && l.v > 0).map((l) => l.text)).toEqual([
        '$500K',
        '$750K',
      ])
    }
  })

  it('never labels a multiple its two figures would round ($125K is not "$130K")', () => {
    const labels = mmYLabels(250_000, 400_000, yOf(400_000))
    expect(labels.map((l) => l.text)).not.toContain('$130K')
    for (const l of labels.filter((x) => !x.strong && x.v > 0))
      expect(Number(l.v.toPrecision(2))).toBe(l.v)
  })

  it('merges KPI and zero into one label when the whole pool sets the scale (DV2)', () => {
    const wide = samples('ooobbbbbbbbooo').map((p) => ({
      ...p,
      attribution: { ...p.attribution, poolDepthUpUsd: 6_100_000, poolDepthDownUsd: 5_400_000 },
    }))
    const M = mmScaleMax(250_000, wide, true)
    const fy = yOf(M)
    const labels = mmYLabels(250_000, M, fy)
    expect(labels[0]).toEqual({ v: 0, text: 'KPI ±$250K', strong: true })
    expect(labels.filter((l) => l.text === '0' || l.text === 'KPI $250K')).toEqual([])
    for (const g of gaps(labels, fy)) expect(g).toBeGreaterThanOrEqual(LABEL_GAP)
    expect(labels.some((l) => !l.strong && l.v > 0)).toBe(true)
    expect(labels.some((l) => !l.strong && l.v < 0)).toBe(true)
  })

  it('keeps magnitude ticks below 0.97 M and at most two per side', () => {
    for (const M of [80_000, 250_000, 1_200_000, 6_600_000]) {
      const mags = mmYLabels(50_000, M, yOf(M)).filter((l) => !l.strong && l.v > 0)
      expect(mags.length).toBeLessThanOrEqual(2)
      for (const l of mags) expect(l.v).toBeLessThan(M * 0.97)
    }
  })

  it('spans a band over its samples’ intervals', () => {
    expect(bandSpan({ start: 7200, end: 14_400 }, 7200)).toEqual([3600, 18_000])
  })

  it('words the scrub status', () => {
    expect(sampleStatus(pts[4]!)).toEqual({ tone: 'bad', text: 'Breached, both sides' })
    expect(sampleStatus(pts[0]!)).toEqual({ tone: 'ok', text: 'Within KPI' })
    expect(sampleStatus({ withinKpi: null, breaches: [] }).text).toBe('Not evaluable')
  })
})

describe('MarketMakerChart', () => {
  const pts = samples('oooobbbbbbbbooooooooobbbsss')
  const from = pts[0]!.timestamp
  const to = pts[pts.length - 1]!.timestamp

  function renderChart(onScrub = vi.fn(), wholePool = false) {
    return render(
      <MarketMakerChart
        points={pts}
        kpi={50_000}
        registeredAt={from + 7200 * 3}
        domain={[from, to]}
        windowLabel="7 days"
        wholePool={wholePool}
        onScrub={onScrub}
        controls={<span>controls</span>}
      >
        <MarketMakerTable points={pts} window="7d" from={from} />
      </MarketMakerChart>,
    )
  }

  it('draws the KPI on both sides, one band per breach episode and the registration line', () => {
    const { container } = renderChart()
    expect(container.querySelectorAll('.mm-band')).toHaveLength(2)
    expect(container.querySelectorAll('.mm-kpi')).toHaveLength(2)
    expect(screen.getAllByText(`KPI $50K`)).toHaveLength(2)
    expect(screen.getAllByText('$25K')).toHaveLength(2)
    expect(screen.getAllByText('$75K')).toHaveLength(2)
    expect(screen.getByText(/^Registered 16.Oct$/)).toBeTruthy()
    expect(container.querySelector('.mm-ctx-line')).toBeNull()
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Market-maker depth per side over 7 days against the $50K KPI. 2 breach episodes shown as shaded bands. Latest: buy side $60K, sell side $7.63K. Use the arrow keys to step through samples.',
    )
    expect(screen.getByText('controls')).toBeTruthy()
  })

  it('adds the whole pool as context lines', () => {
    const { container } = renderChart(vi.fn(), true)
    expect(container.querySelectorAll('.mm-ctx-line')).toHaveLength(2)
  })

  it('scrubs with the arrow keys, reports the sample and captions it in UTC', () => {
    const onScrub = vi.fn()
    const { container } = renderChart(onScrub)
    const img = screen.getByRole('img')
    const cap = () => container.querySelector('.scrub-cap')?.textContent
    expect(cap()).toBe('')
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[pts.length - 1], true)
    expect(cap()).toBe(`Breached, sell side18${NB}Oct, 04:00${NB}UTC`)
    for (let i = 0; i < 6; i++) fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(onScrub).toHaveBeenLastCalledWith(pts[pts.length - 7], false)
    expect(cap()).toMatch(/^Within KPI/)
    expect(container.querySelectorAll('.xd')).toHaveLength(2)
    fireEvent.keyDown(img, { key: 'Escape' })
    expect(onScrub).toHaveBeenLastCalledWith(null, false)
    expect(cap()).toBe('')
  })

  it('shows per-day rows under Show data for 7 d (ia-v3 §4.6)', () => {
    renderChart()
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }))
    expect(screen.getByText('Day (UTC)')).toBeTruthy()
    const rows = screen.getAllByRole('row')
    // Header, then 18 Oct (3 samples), 17 Oct (12), 16 Oct (12).
    expect(rows).toHaveLength(4)
    expect(rows[1]?.textContent).toBe(`18${NB}Oct$7.62K$60K0 of 3`)
  })

  it('lists samples for 24 h, newest first', () => {
    render(<MarketMakerTable points={pts as MmSampleDto[]} window="24h" from={to - 86_400} />)
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(14)
    expect(rows[1]?.textContent).toBe(`18${NB}Oct, 04:00$7.63K$60KBreached, sell side`)
  })
})
