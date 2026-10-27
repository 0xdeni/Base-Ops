import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PoolSnapshotDto } from '../../api/types.js'
import { DepthCurveTable } from './ChartTables.js'
import { placeChartTip } from './ChartTooltip.js'
import { SNAPSHOT, USDC, WETH } from './chartFixtures.js'
import {
  asymmetryNote,
  clampTickX,
  curveGeometry,
  curveLabel,
  curvePoints,
  nearestPoint,
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

  it('places points on a log x and a zero-based y with a nice top', () => {
    const g = curveGeometry(points, 1200, false)
    expect(g.H).toBe(340)
    expect(g.base).toBe(310)
    expect(g.ytop).toBe(15_000_000)
    expect(g.yTicks).toEqual([5_000_000, 10_000_000, 15_000_000])
    expect(g.fy(0)).toBe(g.base)
    expect(g.fy(15_000_000)).toBe(36)
    expect(g.fx(5)).toBeCloseTo(1196, 6)
    expect(g.sell[0]).toEqual([600, 310])
    expect(g.sell).toHaveLength(4)
    expect(curveGeometry(points, 343, true).H).toBe(240)
  })

  it('marks where a side runs out of liquidity', () => {
    const g = curveGeometry(curvePoints(exhausted(), WETH, USDC), 1200, false)
    expect(g.exhausted).toEqual({ sell: -1, buy: 3 })
  })

  it('snaps the pointer to the nearest measured point', () => {
    const g = curveGeometry(points, 1200, false)
    expect(nearestPoint(points, g.fx, g.fx(2) + 20)).toBe(4)
    expect(nearestPoint(points, g.fx, 0)).toBe(0)
  })

  it('keeps x tick labels 14 px inside the edges', () => {
    expect(clampTickX(1199, 1200)).toBe(1186)
    expect(clampTickX(2, 1200)).toBe(14)
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
  it('sits 16 px beside the point, away from the direct label, vertically centred', () => {
    expect(placeChartTip(700, 300, 160, 80, vp, 'right')).toEqual({ left: 716, top: 260 })
    expect(placeChartTip(700, 300, 160, 80, vp, 'left')).toEqual({ left: 524, top: 260 })
  })

  it('flips when it would leave the viewport', () => {
    expect(placeChartTip(1400, 300, 160, 80, vp, 'right').left).toBe(1224)
    expect(placeChartTip(40, 300, 160, 80, vp, 'left').left).toBe(56)
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
    const labels = [...container.querySelectorAll('.chart-label')].map((e) => e.textContent)
    expect(labels).toEqual(['$5.10M', '$6.08M'])
    const ticks = [...container.querySelectorAll('.chart-text')].map((e) => e.textContent)
    expect(ticks).toEqual(
      expect.arrayContaining(['$5M', '$10M', '$15M', `−5${NB}%`, 'Mid', `+5${NB}%`]),
    )
  })

  it('fills each side with the field of light: a halftone pattern under a ramp mask', () => {
    const { container } = renderCurve()
    const patterns = container.querySelectorAll('pattern')
    expect(patterns).toHaveLength(3)
    expect(container.querySelector('mask g, g[mask]')).toBeTruthy()
    expect(container.querySelectorAll('g[mask] path')).toHaveLength(2)
  })

  it('steps through the points with the arrow keys and opens the tooltip; Escape clears', () => {
    const { container } = renderCurve()
    const img = screen.getByRole('img')
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    expect(container.querySelector('[aria-live]')?.textContent).toBe(
      `+5${NB}%, buy side: $14.3M, 14.34M${NB}USDC spent, reached`,
    )
    fireEvent.keyDown(img, { key: 'ArrowLeft' })
    const tip = document.querySelector('.tip.is-chart')
    expect(tip?.textContent).toContain(`+2${NB}%, buy side`)
    // Both sides list Depth, the token traded, then Price: the tooltip keeps one shape (DV2-04).
    expect(tip?.textContent).toContain(`Spent6.080M${NB}USDC`)
    expect(tip?.querySelectorAll('.tt-row')).toHaveLength(3)
    expect(tip?.textContent).toContain('Reached')
    for (let i = 0; i < 3; i++) fireEvent.keyDown(img, { key: 'ArrowLeft' })
    const sold = document.querySelector('.tip.is-chart')?.textContent
    expect(sold).toContain(`Sold2,074${NB}WETH`)
    expect(document.querySelectorAll('.tip.is-chart .tt-row')).toHaveLength(3)
    expect(container.querySelector('.xh')).toBeTruthy()
    expect(container.querySelector('circle[r="5"]')).toBeTruthy()
    fireEvent.keyDown(img, { key: 'Escape' })
    expect(document.querySelector('.tip.is-chart')).toBeNull()
    expect(container.querySelector('.xh')).toBeNull()
  })

  it('draws an exhausted side dashed with "Liquidity runs out"', () => {
    const { container } = renderCurve(exhausted())
    expect(container.querySelector('.c-line.buy.is-exhausted')).toBeTruthy()
    expect(screen.getByText('Liquidity runs out')).toBeTruthy()
  })

  it('shows the per-level table and the asymmetry under Show data', () => {
    renderCurve()
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }))
    const row = screen.getByText(/^±2.%$/).closest('tr')
    expect(row?.textContent).toBe(`±2${NB}%$5.10M2,074$6.08M6.080M`)
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(heads).toEqual(['Move', 'Sell side', 'WETH sold', 'Buy side', 'USDC spent'])
    expect(screen.getByText(/Buying meets 19/)).toBeTruthy()
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
