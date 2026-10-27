import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import {
  butterflyLabel,
  butterflyModel,
  GAP_TIGHT_SHARE,
  gapMarkerTight,
  pickButterflyRows,
  rowLinkLabel,
  strataBoundaries,
} from './butterflyModel.js'
import { ButterflyTable } from './ChartTables.js'
import { DEMO_POOLS, GAP_POOL_ID, summary } from './chartFixtures.js'
import { DepthButterfly } from './DepthButterfly.js'

afterEach(cleanup)

const NB = ' '

describe('butterfly geometry (CH4)', () => {
  const m = butterflyModel(DEMO_POOLS, DEMO_POOLS)

  it('sets one shared scale by the larger total side', () => {
    expect(m.total.sell).toBeCloseTo(11_765_468, 0)
    expect(m.total.buy).toBeCloseTo(14_305_299, 0)
    expect(m.max).toBe(m.total.buy)
    expect(m.ticks).toEqual([5_000_000, 10_000_000])
  })

  it('draws the $31.5K gap pool narrower than 4 px next to $6.1M on a 500 px side', () => {
    const track = 500
    const gap = m.rows.find((r) => r.id === GAP_POOL_ID)
    const deepest = m.rows[0]
    expect((gap?.buyW ?? 1) * track).toBeLessThan(4)
    expect((deepest?.buyW ?? 0) * track).toBeGreaterThan(200)
    // Every row is a fraction of the same maximum.
    expect(deepest?.buyW).toBeCloseTo(6_079_641 / m.max, 9)
  })

  it('stacks the strata outward from the spine in row order', () => {
    const sell = m.strata.sell
    expect(sell[0]?.o).toBe(0)
    for (let i = 1; i < sell.length; i++)
      expect(sell[i]?.o).toBeCloseTo((sell[i - 1]?.o ?? 0) + (sell[i - 1]?.w ?? 0), 12)
    const last = sell[sell.length - 1]
    expect((last?.o ?? 0) + (last?.w ?? 0)).toBeCloseTo(m.total.sell / m.max, 12)
  })

  it('adds one "other pools" stratum for pools not listed', () => {
    const rows = DEMO_POOLS.slice(0, 3)
    const part = butterflyModel(rows, DEMO_POOLS)
    expect(part.strata.buy).toHaveLength(4)
    expect(part.total).toEqual(m.total)
  })

  it('skips the canvas gap after a stratum under 3 px', () => {
    const boundaries = strataBoundaries(m.strata.sell, 500)
    // Six strata, five boundaries; the one after the $15.9K gap pool has nothing after it.
    expect(boundaries).toHaveLength(5)
    const tiny = strataBoundaries(
      [
        { o: 0, w: 0.001 },
        { o: 0.001, w: 0.5 },
      ],
      500,
    )
    expect(tiny).toEqual([])
  })

  it('reads an unpriced side as nothing, never as 0', () => {
    const pools = [summary('uniswap-v3:0x1', ['A', 'B'], 'uniswap-v3', null, 1000), ...DEMO_POOLS]
    const model = butterflyModel(pools, pools)
    expect(model.rows[0]?.sellW).toBe(0)
    expect(model.rows[0]?.sell).toBeNull()
    expect(rowLinkLabel(model.rows[0]!, 'Base')).toContain('— sell side')
  })

  it('lists the 7 deepest pools plus the gap pool (ia-v3 §4.1)', async () => {
    const client = createMockClient({ now: 1_760_000_000 })
    const pools = (await client.pools({ limit: 200 })).items
    const gap = (await client.gaps()).items[0]?.pool.pool.id
    const rows = pickButterflyRows(pools, gap)
    expect(rows).toHaveLength(8)
    expect(rows.slice(0, 7).map((p) => p.depth2Usd)).toEqual(
      [...pools]
        .map((p) => p.depth2Usd)
        .sort((a, b) => (b ?? 0) - (a ?? 0))
        .slice(0, 7),
    )
    expect(rows[7]?.pool.id).toBe(gap)
    expect(pickButterflyRows(DEMO_POOLS, GAP_POOL_ID)).toHaveLength(6)
  })

  it('summarises the scope and every pool for assistive tech', () => {
    const label = butterflyLabel(m, 'Base')
    expect(label).toMatch(/^Base: \$11\.8M on the sell side and \$14\.3M on the buy side/)
    expect(label).toContain('USDC / AERO on Aerodrome v2, $15.9K sell side, $15.6K buy side')
  })
})

function renderButterfly(props: Partial<Parameters<typeof DepthButterfly>[0]> = {}) {
  return render(
    <MemoryRouter>
      <DepthButterfly
        pools={DEMO_POOLS}
        gap={{ poolId: GAP_POOL_ID, turnoverRatio: 50.8 }}
        {...props}
      >
        <ButterflyTable pools={DEMO_POOLS} gapPoolId={GAP_POOL_ID} />
      </DepthButterfly>
    </MemoryRouter>,
  )
}

describe('Gap marker in the value lane (DV2-07)', () => {
  // A one-pool scope whose gap pool's buy side is the scale (buyW = 1), as on a token page.
  const GAP_ONLY = [summary('aerodrome-v2:0xgap', ['AERO', 'USDC'], 'aerodrome-v2', 15_600, 15_900)]
  const renderTight = () =>
    render(
      <MemoryRouter>
        <DepthButterfly
          pools={GAP_ONLY}
          gap={{ poolId: 'aerodrome-v2:0xgap', turnoverRatio: 50.8 }}
          scope="AERO"
        />
      </MemoryRouter>,
    )

  it('takes the short leader only when the gap row nearly fills the scale', () => {
    expect(gapMarkerTight(1)).toBe(true)
    expect(gapMarkerTight(0.9)).toBe(true)
    expect(gapMarkerTight(GAP_TIGHT_SHARE)).toBe(false)
    expect(gapMarkerTight(0.002)).toBe(false)
  })

  it('marks the gap row tight when its buy bar is the scale (buyW = 1)', () => {
    expect(butterflyModel(GAP_ONLY, GAP_ONLY).rows[0]?.buyW).toBe(1)
    const { container } = renderTight()
    expect(container.querySelector('.bf-gap')?.classList.contains('is-tight')).toBe(true)
    cleanup()
    // On Base's scale the $15.9K gap pool is a sliver: the full 44 px leader stays.
    const { container: base } = renderButterfly()
    expect(base.querySelector('.bf-gap')?.classList.contains('is-tight')).toBe(false)
  })

  it('ends the lens when the pointer reaches a tight marker, so the word is there to click', () => {
    // jsdom has no PointerEvent: a MouseEvent that carries `pointerType` stands in.
    class TestPointerEvent extends MouseEvent {
      pointerType: string
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerType = init.pointerType ?? 'mouse'
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    // A mouse on a fine pointer: the only path that lenses on hover.
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('pointer: fine'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }))
    try {
      const { container } = renderTight()
      const fig = container.querySelector('figure.bfly') as HTMLElement
      fireEvent.pointerOver(container.querySelector('.bf-side.buy .bf-bar') as HTMLElement, {
        pointerType: 'mouse',
      })
      expect(fig.classList.contains('is-lens')).toBe(true)
      fireEvent.pointerOver(container.querySelector('.bf-gap-link') as HTMLElement, {
        pointerType: 'mouse',
      })
      expect(fig.classList.contains('is-lens')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('DepthButterfly', () => {
  it('labels only the total row, whose two values sum to the answer (ia-v3 §4.1)', () => {
    const { container } = renderButterfly()
    const totals = [...container.querySelectorAll('.tot-val')].map((e) => e.textContent)
    expect(totals).toEqual(['$11.8M', '$14.3M'])
    expect(screen.getByText('All of Base')).toBeTruthy()
    expect(screen.getByText('6 pools')).toBeTruthy()
    expect(screen.getByText('One scale for every pool')).toBeTruthy()
    expect(container.querySelectorAll('.bfly-row')).toHaveLength(6)
  })

  it('links every row to its pool and the gap marker to /gaps', () => {
    renderButterfly()
    const link = screen.getByRole('link', { name: /^USDC \/ AERO, Aerodrome v2/ })
    expect(link.getAttribute('href')).toBe('/pools/aerodrome-v2%3A0xd59e')
    expect(link.getAttribute('aria-label')).toContain(`under 1${NB}% of Base’s depth`)
    const gap = screen.getByRole('link', {
      name: /Liquidity gap: USDC \/ AERO trades 51× its depth/,
    })
    expect(gap.getAttribute('href')).toBe('/gaps')
  })

  it('lenses a row on focus, instantly, and ends the lens when focus leaves', () => {
    const { container } = renderButterfly()
    const fig = container.querySelector('figure.bfly') as HTMLElement
    const link = screen.getByRole('link', { name: /^WETH \/ USDC, Uniswap v3/ })
    fireEvent.focus(link)
    expect(fig.classList.contains('is-lens')).toBe(true)
    expect(fig.classList.contains('is-instant')).toBe(true)
    const rows = container.querySelectorAll('.bfly-row')
    expect(rows[1]?.classList.contains('is-on')).toBe(true)
    expect(rows[0]?.classList.contains('is-on')).toBe(false)
    expect(container.querySelector('.tot-cap-l')?.textContent).toBe(`this pool: 20${NB}%`)
    expect(container.querySelectorAll('.tot-lens.on')).toHaveLength(2)
    fireEvent.blur(link, { relatedTarget: document.body })
    expect(fig.classList.contains('is-lens')).toBe(false)
    expect(container.querySelector('.tot-cap-l')?.textContent).toBe('6 pools')
  })

  it('reads a sliver pool as "under 1 %", never "0 %" (N4)', () => {
    const { container } = renderButterfly()
    fireEvent.focus(screen.getByRole('link', { name: /^USDC \/ AERO/ }))
    expect(container.querySelector('.tot-cap-l')?.textContent).toBe(`this pool: under 1${NB}%`)
  })

  it('keeps the intro class only for the first view', () => {
    const { container } = renderButterfly({ intro: true })
    expect(container.querySelector('figure.bfly')?.classList.contains('grow')).toBe(true)
  })

  it('puts the numbers behind a Show data disclosure (CH9)', () => {
    renderButterfly()
    const trigger = screen.getByRole('button', { name: 'Show data' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    const table = screen.getByRole('table')
    const total = within(table).getByText('All of Base').closest('tr')
    expect(total?.textContent).toBe(`All of Base$11.8M$14.3M100${NB}%`)
    expect(within(table).getByText(`Share of Base`)).toBeTruthy()
  })

  it('draws only the spine when nothing is scored', () => {
    const { container } = render(
      <MemoryRouter>
        <DepthButterfly pools={[]} />
      </MemoryRouter>,
    )
    expect(container.querySelector('.bfly.is-empty .bfly-spine')).toBeTruthy()
    expect(container.querySelector('.bf-bar')).toBeNull()
  })

  it('scopes the total to a token on token pages', () => {
    const pools = DEMO_POOLS.slice(0, 2)
    render(
      <MemoryRouter>
        <DepthButterfly pools={pools} scope="WETH" />
      </MemoryRouter>,
    )
    expect(screen.getByText('All of WETH')).toBeTruthy()
    expect(screen.getByText('2 pools')).toBeTruthy()
    expect(screen.getByRole('group').getAttribute('aria-label')).toMatch(/^WETH: \$7\.41M/)
  })
})
