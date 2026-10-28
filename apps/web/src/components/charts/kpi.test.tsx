import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { KpiChart } from './KpiChart.js'
import { kpiLabel, kpiModel, shortfallText, sideTitle, wordsFit } from './kpiModel.js'

afterEach(cleanup)

describe('kpiModel (visual-v4 §5.9.4)', () => {
  it('puts both halves on one scale: 1.25 × the larger of the KPI and the two sides', () => {
    const m = kpiModel(386_000, 425_000, 400_000)
    expect(m.S).toBe(1.25 * 425_000)
    expect(m.sell.w).toBeCloseTo(386_000 / m.S, 12)
    expect(m.buy.w).toBeCloseTo(425_000 / m.S, 12)
    expect(m.sell.kpiW).toBeCloseTo(400_000 / m.S, 12)
    expect(m.buy.kpiW).toBe(m.sell.kpiW)
    expect(kpiModel(7_600, 60_000, 50_000).S).toBe(75_000)
    expect(kpiModel(7_600, 9_000, 50_000).S).toBe(62_500)
  })

  it('makes the shortfall KPI minus value, from the bar’s end to the KPI line', () => {
    const m = kpiModel(386_000, 425_000, 400_000)
    expect(m.sell.below).toBe(true)
    expect(m.sell.shortfall).toBe(14_000)
    expect(m.sell.shortW).toBeCloseTo(m.sell.kpiW - m.sell.w, 12)
    expect((m.sell.shortW * m.S).toFixed(6)).toBe((14_000).toFixed(6))
  })

  it('draws a shortfall only below the KPI: none at or above it, none for an unknown side', () => {
    const m = kpiModel(386_000, 425_000, 400_000)
    expect(m.buy.below).toBe(false)
    expect(m.buy.shortfall).toBeNull()
    expect(m.buy.shortW).toBe(0)
    const at = kpiModel(400_000, 400_000, 400_000)
    expect([at.sell.shortfall, at.buy.shortfall]).toEqual([null, null])
    const unknown = kpiModel(null, 425_000, 400_000)
    expect(unknown.sell).toMatchObject({ below: false, shortfall: null, shortW: 0, w: 0 })
  })

  it('words the figure, its caption and each side', () => {
    const m = kpiModel(386_000, 425_000, 400_000)
    expect(kpiLabel(m)).toBe(
      'Sell side $386K, below the $400K KPI by $14K. Buy side $425K, within it.',
    )
    expect(shortfallText(m)).toBe('Shortfall against the KPI: $14K')
    expect(shortfallText(kpiModel(500_000, 425_000, 400_000))).toBeNull()
    expect(shortfallText(kpiModel(7_600, 7_400, 50_000))).toBe(
      'Shortfall against the KPI: $42.4K on the sell side, $42.6K on the buy side',
    )
    expect(sideTitle(m.sell)).toBe('Sell side, below KPI')
    expect(sideTitle(m.buy)).toBe('Buy side')
    expect(sideTitle(kpiModel(null, 1, 1).sell)).toBe('Sell side, not checkable')
    expect(kpiLabel(kpiModel(null, 425_000, 400_000))).toBe(
      'Sell side has no USD price, so it cannot be checked. Buy side $425K, within the $400K KPI.',
    )
  })

  it('moves a side’s words under the bars when its bar is too short for them', () => {
    const m = kpiModel(7_600, 60_000, 50_000)
    expect(wordsFit(m.buy, 640, 52, false)).toBe(true)
    expect(wordsFit(m.sell, 640, 52, false)).toBe(false)
  })
})

describe('KpiChart', () => {
  it('is one image whose label carries both sides and the shortfall', () => {
    render(<KpiChart sell={386_000} buy={425_000} kpi={400_000} latestOnly />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Sell side $386K, below the $400K KPI by $14K. Buy side $425K, within it.',
    )
  })

  it('hatches the shortfall on the side below its KPI only', () => {
    const { container } = render(<KpiChart sell={386_000} buy={425_000} kpi={400_000} latestOnly />)
    const short = container.querySelectorAll('.short')
    expect(short).toHaveLength(1)
    expect(short[0]?.closest('.kpi-h')?.classList.contains('s')).toBe(true)
    const m = kpiModel(386_000, 425_000, 400_000)
    const el = short[0] as HTMLElement
    expect(Number.parseFloat(el.style.right)).toBeCloseTo(m.sell.w * 100, 2)
    expect(Number.parseFloat(el.style.width)).toBeCloseTo(m.sell.shortW * 100, 2)
    expect(container.querySelector('.kpi-cap')?.textContent).toBe(
      'Shortfall against the KPI: $14KPer-side depth is stored for the latest snapshot only.',
    )
    expect(container.querySelectorAll('.kpi-line')).toHaveLength(2)
    expect([...container.querySelectorAll('.kpi-lab')].map((e) => e.textContent)).toEqual([
      'KPI $400K',
      'KPI $400K',
    ])
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(2)
  })

  it('draws no hatch and no shortfall caption when both sides are within the KPI', () => {
    const { container } = render(<KpiChart sell={500_000} buy={425_000} kpi={400_000} />)
    expect(container.querySelector('.short')).toBeNull()
    expect(container.querySelector('.kpi-cap')).toBeNull()
  })

  it('inks the stretch of the KPI line inside a bar that holds it, on that side only', () => {
    const { container } = render(<KpiChart sell={386_000} buy={425_000} kpi={400_000} />)
    const inside = [...container.querySelectorAll('.kpi-line-in')]
    expect(inside.map((e) => e.closest('.kpi-h')?.classList.contains('b'))).toEqual([true])
    const m = kpiModel(386_000, 425_000, 400_000)
    expect(Number.parseFloat((inside[0] as HTMLElement).style.left)).toBeCloseTo(
      m.buy.kpiW * 100,
      2,
    )
  })

  it('sets a KPI label outward from its line when the line sits near the spine', () => {
    const near = render(<KpiChart sell={800_000} buy={990_000} kpi={250_000} />)
    const labs = [...near.container.querySelectorAll('.kpi-lab')]
    expect(labs.map((e) => e.classList.contains('is-out'))).toEqual([true, true])
    near.unmount()
    const far = render(<KpiChart sell={386_000} buy={425_000} kpi={400_000} />)
    expect(far.container.querySelectorAll('.kpi-lab.is-out')).toHaveLength(0)
  })

  it('reads the values inside the bars in ink, or under them when a bar is too short', () => {
    const { container } = render(<KpiChart sell={7_600} buy={60_000} kpi={50_000} />)
    expect(container.querySelector('.kpi-h.b .kpi-in')?.textContent).toBe('Buy side$60K')
    expect(container.querySelector('.kpi-h.s .kpi-in')).toBeNull()
    expect(container.querySelector('.kpi-under .kpi-out')?.textContent).toBe(
      'Sell side, below KPI$7.60K',
    )
  })
})
