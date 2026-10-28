import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PoolSnapshotDto } from '../../api/types.js'
import { DepthCurveTable } from './ChartTables.js'
import { placeChartTip } from './ChartTooltip.js'
import { SNAPSHOT, USDC, WETH } from './chartFixtures.js'
import {
  areaPath,
  asymmetryNote,
  clampTickX,
  curveGeometry,
  curveLabel,
  curvePoints,
  nearestPoint,
  outPath,
  twoPct,
} from './curveModel.js'
import { DepthCurve } from './DepthCurve.js'

afterEach(cleanup)

const NB = ' '

function exhausted(): PoolSnapshotDto {
  const depth = SNAPSHOT.depth.map((d) =>
    d.pct === 5 ? { ...d, up: { ...d.up, reached: false } } : d,
  )
  return { ...SNAPSHOT, depth }
}

describe('curve data (CH3)', () => {
  const points = curvePoints(SNAPSHOT, WETH, USDC)

  it('reads the measured levels as stored, sell side negative, left to right', () => {
    expect(points.map((p) => p.pct)).toEqual([-5, -2, -1, 1, 2, 5])
    expect(points.find((p) => p.pct === -2)?.usd).toBe(5_102_004.52)
    expect(points.find((p) => p.pct === 2)?.usd).toBe(6_079_641.56)
  })

  it('names the token traded at each level, at ≤ 4 significant figures (N11)', () => {
    expect(points.find((p) => p.pct === -2)?.amount).toBe(`2,074${NB}WETH`)
    // Every side names its token, USDC at $1.00 included, so the tooltip keeps one shape (DV2-04).
    expect(points.find((p) => p.pct === 2)?.amount).toBe(`6.080M${NB}USDC`)
    const quoted = curvePoints({ ...SNAPSHOT, token1Usd: 0.98 }, WETH, USDC)
    expect(quoted.find((p) => p.pct === 2)?.amount).toBe(`6.080M${NB}USDC`)
  })

  it('leaves out an unpriced side instead of drawing a misleading shape', () => {
    const unpriced = {
      ...SNAPSHOT,
      depthUsd: SNAPSHOT.depthUsd.map((d) => ({ ...d, upUsd: null })),
    }
    const pts = curvePoints(unpriced, WETH, USDC)
    expect(pts.every((p) => p.side === 'sell')).toBe(true)
    expect(curveLabel(pts)).toContain('Buy side: no USD price')
  })

  it('places points on a log x and a linear y from 0, topped at ceil(1.06 × max / step) × step', () => {
    const g = curveGeometry(points, 1200, false)
    expect(g.H).toBe(340)
    expect(g.top).toBe(72)
    expect(g.base).toBe(312)
    // max $14.3M × 1.06 = $15.2M over 5 steps: the round step at or above $3.04M is $5M.
    expect(g.step).toBe(5_000_000)
    expect(g.yMax).toBe(20_000_000)
    expect(g.yTicks).toEqual([10_000_000, 20_000_000])
    expect(g.fy(0)).toBe(g.base)
    expect(g.fy(g.yMax)).toBe(72)
    // x = cx ± log(1 + |p|) / log 6 × (W / 2 − 10): ±5 % lands 10 px inside the edge.
    expect(g.fx(5)).toBeCloseTo(1190, 6)
    expect(g.fx(-5)).toBeCloseTo(10, 6)
    expect(g.fx(2)).toBeCloseTo(600 + (Math.log(3) / Math.log(6)) * 590, 6)
    expect(g.sell[0]).toEqual([600, 312])
    expect(g.sell).toHaveLength(4)
    const phone = curveGeometry(points, 343, true)
    expect([phone.H, phone.top, phone.base]).toEqual([240, 16, 212])
  })

  it('closes each side’s flat area to the baseline at its outermost point, never past ±5 %', () => {
    const g = curveGeometry(points, 1200, false)
    const d = areaPath(g.buy, g.exhausted.buy, g.base)
    expect(d.startsWith('M600.00 312.00')).toBe(true)
    expect(d.endsWith(`L${g.fx(5).toFixed(2)} 312.00Z`)).toBe(true)
    expect(outPath(g.buy, g.exhausted.buy)).toBe('')
    const wider = {
      ...SNAPSHOT,
      depthUsd: [...SNAPSHOT.depthUsd, { pct: 10, upUsd: 1, downUsd: 1, totalUsd: 2 }],
    }
    expect(curvePoints(wider, WETH, USDC).map((p) => p.pct)).toEqual([-5, -2, -1, 1, 2, 5])
  })

  it('marks where a side runs out of liquidity: the area stops, a dashed segment goes on', () => {
    const g = curveGeometry(curvePoints(exhausted(), WETH, USDC), 1200, false)
    expect(g.exhausted).toEqual({ sell: -1, buy: 3 })
    const area = areaPath(g.buy, g.exhausted.buy, g.base)
    expect(area.endsWith(`L${g.fx(2).toFixed(2)} 312.00Z`)).toBe(true)
    expect(outPath(g.buy, g.exhausted.buy).split('L')).toHaveLength(2)
  })

  it('snaps the pointer to the nearest measured point', () => {
    const g = curveGeometry(points, 1200, false)
    expect(nearestPoint(points, g.fx, g.fx(2) + 20)).toBe(4)
    expect(nearestPoint(points, g.fx, 0)).toBe(0)
  })

  it('keeps x tick labels 16 px inside the edges', () => {
    expect(clampTickX(1199, 1200)).toBe(1184)
    expect(clampTickX(2, 1200)).toBe(16)
  })

  it('finds the ±2 % points for the direct labels', () => {
    expect(twoPct(points, 'sell')?.usd).toBe(5_102_004.52)
    expect(twoPct(points, 'buy')?.usd).toBe(6_079_641.56)
  })

  it('states the asymmetry of the ±2 % depth in Show data', () => {
    expect(asymmetryNote(SNAPSHOT)).toBe(
      `Buying meets 19${NB}% more depth than selling at ±2${NB}%.`,
    )
    const flipped = {
      ...SNAPSHOT,
      depthUsd: SNAPSHOT.depthUsd.map((d) => ({ ...d, upUsd: d.downUsd, downUsd: d.upUsd })),
    }
    expect(asymmetryNote(flipped)).toBe(
      `Selling meets 19${NB}% more depth than buying at ±2${NB}%.`,
    )
  })
})

describe('placeChartTip (CH2)', () => {
  const vp = { width: 1440, height: 900 }
  it('sits 18 px beside the point, vertically centred', () => {
    expect(placeChartTip(700, 300, 160, 80, vp, 'right')).toEqual({ left: 718, top: 260 })
    expect(placeChartTip(700, 300, 160, 80, vp, 'left')).toEqual({ left: 522, top: 260 })
  })

  it('flips when it would leave the viewport', () => {
    expect(placeChartTip(1400, 300, 160, 80, vp, 'right').left).toBe(1222)
    expect(placeChartTip(40, 300, 160, 80, vp, 'left').left).toBe(58)
    expect(placeChartTip(40, 20, 160, 80, vp, 'left').top).toBe(8)
  })
})

describe('DepthCurve', () => {
  function renderCurve(snapshot = SNAPSHOT) {
    return render(
      <DepthCurve snapshot={snapshot} token0={WETH} token1={USDC}>
        <DepthCurveTable snapshot={snapshot} token0={WETH} token1={USDC} />
      </DepthCurve>,
    )
  }

  it('is one image with a full summary and exactly two direct labels at ±2 %', () => {
    const { container } = renderCurve()
    const img = screen.getByRole('img')
    expect(img.getAttribute('aria-label')).toContain(
      `Sell side: $2.64M to move −1${NB}%, $5.10M to move −2${NB}%, $10.5M to move −5${NB}%`,
    )
    const labels = [...container.querySelectorAll('.cv-lab')].map((e) => e.textContent)
    expect(labels).toEqual([`Sell −2${NB}%$5.10M`, `Buy +2${NB}%$6.08M`])
    const ticks = [...container.querySelectorAll('.ax')].map((e) => e.textContent)
    expect(ticks).toEqual(expect.arrayContaining(['$10M', '$20M', `−5${NB}%`, 'Mid', `+5${NB}%`]))
    // The phone readout row carries the same two values.
    expect(container.querySelector('.cv-read')?.textContent).toBe(
      `Sell −2${NB}%$5.10MBuy +2${NB}%$6.08M`,
    )
  })

  it('fills each side flat, with ringed square points and the ±2 % band', () => {
    const { container } = renderCurve()
    expect(container.querySelectorAll('.cv-areas path.cv-area')).toHaveLength(2)
    expect(container.querySelector('pattern, mask, linearGradient')).toBeNull()
    const pts = container.querySelectorAll('rect.cv-pt')
    expect(pts).toHaveLength(6)
    expect(pts[0]?.getAttribute('width')).toBe('12')
    expect(pts[0]?.getAttribute('rx')).toBe('3')
    expect(container.querySelector('rect.cv-band')).toBeTruthy()
    expect(screen.getByText(/^Straight lines join measured points only/)).toBeTruthy()
  })

  it('steps through the points with the arrow keys and opens the tooltip; Escape clears', () => {
    const { container } = renderCurve()
    const img = screen.getByRole('img')
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(container.querySelector('[aria-live]')?.textContent).toBe(
      `+5${NB}%, buy side: $14.3M, 14.34M${NB}USDC spent, reached`,
    )
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    const tip = document.querySelector('.tip.chart-tip')
    expect(tip?.textContent).toContain(`+2${NB}%, buy side`)
    // Both sides list Depth, the token traded, then Price: the tooltip keeps one shape.
    expect(tip?.textContent).toContain(`Spent6.080M${NB}USDC`)
    expect(tip?.querySelectorAll('.tt-row')).toHaveLength(3)
    expect(tip?.textContent).toContain('Reached')
    for (let i = 0; i < 3; i++) fireEvent.keyDown(img, { key: 'ArrowLeft' })
    const sold = document.querySelector('.tip.chart-tip')?.textContent
    expect(sold).toContain(`Sold2,074${NB}WETH`)
    expect(container.querySelector('.xh')).toBeTruthy()
    // The selected point grows from 12 to 16 px.
    expect(container.querySelector('rect.cv-pt.is-on')?.getAttribute('width')).toBe('16')
    fireEvent.keyDown(img, { key: 'Escape' })
    expect(document.querySelector('.tip.chart-tip')).toBeNull()
    expect(container.querySelector('.xh')).toBeNull()
  })

  it('draws an exhausted side dashed with "Liquidity runs out"', () => {
    const { container } = renderCurve(exhausted())
    expect(container.querySelector('.cv-out.buy')).toBeTruthy()
    expect(screen.getByText('Liquidity runs out')).toBeTruthy()
  })

  it('shows the per-level table and the asymmetry under Show data, on a block', () => {
    renderCurve()
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }))
    const row = screen.getByText(/^±2.%$/).closest('tr')
    expect(row?.textContent).toBe(`±2${NB}%$5.10M2,074$6.08M6.080MReached`)
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['Move', 'Sell side', 'WETH sold', 'Buy side', 'USDC spent', 'Price'])
    expect(screen.getByText(/Buying meets 19/)).toBeTruthy()
    expect(screen.getByRole('table').closest('.band-data')).toBeTruthy()
  })

  it('says so in a sentence when neither side is priced', () => {
    const none = {
      ...SNAPSHOT,
      depthUsd: SNAPSHOT.depthUsd.map((d) => ({ ...d, upUsd: null, downUsd: null })),
    }
    renderCurve(none)
    expect(screen.getByText(/Neither WETH nor USDC has a USD price/)).toBeTruthy()
  })
})
