import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolSummary } from '../../api/types.js'
import { DEMO_POOLS, summary } from './chartFixtures.js'
import { FIELD_HEIGHT, FIELD_MIN_SIDE, SquareField } from './SquareField.js'
import {
  type FieldPool,
  skyline,
  squareAt,
  squareField,
  step,
  stepOrder,
} from './squareFieldModel.js'

afterEach(cleanup)

const NB = ' '

/** A long tail like Base's: a few deep pools, dozens of thin ones, and pools with no depth. */
function world(): PoolSummary[] {
  const thin = Array.from({ length: 60 }, (_, i) => {
    const p = summary(
      `uniswap-v3:0xt${i}`,
      ['WETH', `T${i}`],
      'uniswap-v3',
      40 + i * 37,
      60 + i * 41,
    )
    return i % 3
      ? p
      : { ...p, health: { ...p.health, rated: false, grade: null, unratedReason: 'thin' as const } }
  })
  const empty = Array.from({ length: 9 }, (_, i) => {
    const p = summary(`aerodrome-v2:0xz${i}`, ['AERO', `Z${i}`], 'aerodrome-v2', 0, 0)
    return i < 4 ? p : { ...p, depth2Usd: null, depth2DownUsd: null, depth2UpUsd: null }
  })
  return [...DEMO_POOLS, ...thin, ...empty]
}

const asField = (pools: readonly PoolSummary[]) =>
  pools.map((p) => ({ ...p, id: p.pool.id, depth: p.depth2Usd }))

describe('squareField (visual-v4 §5.9.2)', () => {
  const pools = asField(world())
  const W = 737
  const H = 420
  const m = squareField(pools, W, H, { min: 5 })

  it('draws every square with its area over its depth equal to one k (within 1 %)', () => {
    expect(m.k).toBeGreaterThan(0)
    for (const q of m.squares) expect((q.s * q.s) / q.depth / m.k).toBeCloseTo(1, 2)
    for (const q of m.squares.filter((x) => x.s >= 20))
      expect(Math.abs((q.s * q.s) / q.depth - m.k) / m.k).toBeLessThan(0.01)
  })

  it('merges the pools under the minimum side into one square whose area is their total', () => {
    const merged = m.squares.filter((q) => q.kind === 'merged')
    expect(merged).toHaveLength(1)
    const q = merged[0]!
    if (q.kind !== 'merged') throw new Error('not merged')
    const sum = q.pools.reduce((t, p) => t + (p.depth ?? 0), 0)
    expect(q.depth).toBeCloseTo(sum, 6)
    expect(Math.abs(q.s * q.s - sum * m.k) / (sum * m.k)).toBeLessThan(0.01)
    expect(m.merged).toEqual({
      count: q.pools.length,
      depth: q.depth,
      max: Math.max(...q.pools.map((p) => p.depth ?? 0)),
    })
    // Each merged pool alone would have drawn under the minimum side.
    for (const p of q.pools) expect(Math.sqrt((p.depth ?? 0) * m.k)).toBeLessThan(5)
    for (const x of m.squares) if (x.kind === 'pool') expect(x.s).toBeGreaterThanOrEqual(5)
  })

  it('leaves out pools with no depth and counts them', () => {
    expect(m.zero).toBe(9)
    const drawn = m.squares.reduce((n, q) => n + (q.kind === 'pool' ? 1 : q.pools.length), 0)
    expect(drawn + m.zero).toBe(pools.length)
    const ids = new Set(
      m.squares.flatMap((q) => (q.kind === 'pool' ? [q.pool.id] : q.pools.map((p) => p.id))),
    )
    for (const p of pools) if (!(p.depth && p.depth > 0)) expect(ids.has(p.id)).toBe(false)
    expect(m.total).toBeCloseTo(
      pools.reduce((t, p) => t + (p.depth ?? 0), 0),
      6,
    )
  })

  it('packs largest first from the bottom left, inside the field, without overlaps', () => {
    const first = m.squares[0]!
    expect(first.x).toBe(0)
    expect(first.y + first.s).toBeCloseTo(H, 6)
    for (let i = 1; i < m.squares.length; i++)
      expect(m.squares[i]!.s).toBeLessThanOrEqual(m.squares[i - 1]!.s)
    for (const q of m.squares) {
      expect(q.x).toBeGreaterThanOrEqual(0)
      expect(q.y).toBeGreaterThanOrEqual(-1e-6)
      expect(q.x + q.s).toBeLessThanOrEqual(W + 1e-6)
      expect(q.y + q.s).toBeLessThanOrEqual(H + 1e-6)
    }
    for (let i = 0; i < m.squares.length; i++)
      for (let j = i + 1; j < m.squares.length; j++) {
        const a = m.squares[i]!
        const b = m.squares[j]!
        const apart = a.x + a.s <= b.x || b.x + b.s <= a.x || a.y + a.s <= b.y || b.y + b.s <= a.y
        expect(apart).toBe(true)
      }
  })

  it('takes the largest scale that fits: 5 % more no longer does', () => {
    const top = Math.max(...m.squares.map((q) => H - q.y))
    expect(top).toBeGreaterThan(H * 0.9)
    const bigger = squareField(pools, W, H, { min: 5 })
    expect(bigger.k).toBeCloseTo(m.k, 12)
    const grown = m.squares.map((q) => q.s * Math.sqrt(1.05))
    const sky = skyline(grown, W, 3)
    const height = Math.max(...sky.map((p, i) => p.y + (grown[i] ?? 0)))
    expect(height).toBeGreaterThan(H)
  })

  it('places skyline squares on the lowest run of columns, leftmost first', () => {
    expect(skyline([10, 10, 10], 30, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ])
    expect(skyline([20, 10, 10], 30, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ])
  })

  it('finds the square under a point, and steps the rated pools by depth', () => {
    const q = m.squares[3]!
    expect(squareAt(m.squares, q.x + q.s / 2, q.y + q.s / 2)).toBe(3)
    expect(squareAt(m.squares, W + 50, -50)).toBe(-1)
    const order = stepOrder(m.squares, (p) => p.health.rated)
    expect(order[0]).toBe(0)
    for (const i of order) {
      const s = m.squares[i]!
      expect(s.kind === 'pool' && s.pool.health.rated).toBe(true)
    }
    expect(step(order, -1, 1)).toBe(order[0])
    expect(step(order, -1, -1)).toBe(order[order.length - 1])
    expect(step(order, order[0]!, -1)).toBe(order[0])
    expect(step(order, order[0]!, 1)).toBe(order[1])
  })

  it('draws nothing in an empty or unmeasured field', () => {
    const none = squareField<FieldPool>([{ id: 'a', depth: 0 }], 300, 200, { min: 5 })
    expect(none.squares).toEqual([])
    expect(none.zero).toBe(1)
    expect(squareField<FieldPool>([{ id: 'a', depth: 5 }], 0, 200, { min: 5 }).squares).toEqual([])
  })
})

// jsdom has no PointerEvent: a MouseEvent that carries `pointerType` stands in.
class TestPointerEvent extends MouseEvent {
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerType = init.pointerType ?? 'mouse'
  }
}
beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent))
afterEach(() => vi.unstubAllGlobals())

describe('SquareField', () => {
  const pools = world()
  // jsdom measures nothing: the field draws at the 720 px fallback width.
  const model = squareField(asField(pools), 720, FIELD_HEIGHT.desktop, {
    min: FIELD_MIN_SIDE.desktop,
  })

  function renderField(inFilter: ((p: PoolSummary) => boolean) | null = null) {
    return render(
      <MemoryRouter initialEntries={['/pools']}>
        <Routes>
          <Route path="/pools" element={<SquareField pools={pools} inFilter={inFilter} />} />
          <Route path="/pools/:id" element={<p>Pool page</p>} />
        </Routes>
      </MemoryRouter>,
    )
  }
  const readout = (c: HTMLElement) => c.querySelector('.lens')?.textContent

  it('draws one square per pool with depth, the merged square and an honest caption', () => {
    const { container } = renderField()
    expect(container.querySelectorAll('a.sq')).toHaveLength(model.squares.length - 1)
    expect(container.querySelectorAll('.sq.merged')).toHaveLength(1)
    expect(container.querySelectorAll('.sq.unrated').length).toBeGreaterThan(0)
    const cap = container.querySelector('.field-cap')?.textContent ?? ''
    expect(cap).toContain(`The ${model.merged?.count} smallest, each under`)
    expect(cap).toContain(`The 9 pools that hold no depth within 2${NB}% are not drawn.`)
    expect(readout(container)).toBe('Point at, focus or tap a square to read its pool.')
    expect(screen.getByRole('group').getAttribute('aria-label')).toMatch(/^Where Base’s depth sits/)
  })

  it('labels the largest square with its pair, venue and share of Base', () => {
    const { container } = renderField()
    const first = container.querySelector('a.sq[data-i="0"]')
    expect(first?.textContent).toContain('WETH / USDC')
    expect(first?.textContent).toContain(`of Base’s depth within 2${NB}%`)
  })

  it('steps through the rated pools with the arrow keys; Escape clears; Enter opens', () => {
    const { container } = renderField()
    const field = screen.getByRole('group')
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(readout(container)).toMatch(/^WETH \/ USDC, Slipstream.0\.05.%\$11\.2M within 2.%/)
    expect(container.querySelector('.sq.hot')?.getAttribute('data-i')).toBe('0')
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(container.querySelector('.sq.hot')?.getAttribute('data-i')).toBe('1')
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(container.querySelector('.sq.hot')).toBeNull()
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(screen.getByText('Pool page')).toBeTruthy()
  })

  it('reads a square on the first tap, with "Open pool"; the merged square only reads', () => {
    const { container } = renderField()
    const field = screen.getByRole('group')
    const q = model.squares[2]!
    fireEvent.pointerDown(field, { pointerType: 'touch' })
    fireEvent.click(field, { clientX: q.x + q.s / 2, clientY: q.y + q.s / 2 })
    expect(container.querySelector('.sq.hot')?.getAttribute('data-i')).toBe('2')
    expect(screen.getByRole('link', { name: 'Open pool' })).toBeTruthy()
    const mi = model.squares.findIndex((x) => x.kind === 'merged')
    const mq = model.squares[mi]!
    fireEvent.click(field, { clientX: mq.x + mq.s / 2, clientY: mq.y + mq.s / 2 })
    expect(readout(container)).toMatch(/smallest pools/)
    expect(readout(container)).toContain('together')
  })

  it('dims squares outside the table’s filter, and the merged square', () => {
    const { container } = renderField((p) => p.pool.dex === 'aerodrome-v2')
    const dim = container.querySelectorAll('.sq.dim')
    expect(container.querySelector('.sq.merged')?.classList.contains('dim')).toBe(true)
    const lit = [...container.querySelectorAll('a.sq:not(.dim)')]
    expect(lit.length).toBeGreaterThan(0)
    for (const a of lit) expect(a.getAttribute('href')).toMatch(/^\/pools\/aerodrome-v2/)
    expect(dim.length).toBe(model.squares.length - lit.length)
  })
})
