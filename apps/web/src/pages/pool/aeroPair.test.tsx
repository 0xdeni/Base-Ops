/**
 * A pool whose two tokens share a symbol (the Aero v2 stable AERO (Aero)/AERO (Aerodrome) pool):
 * every header, axis label, note and amount unit of the Pool page names its token by the API's
 * `label`, so the page never reads "AERO sold" or "AERO per AERO". The fee row says where its fee
 * was read.
 */
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import { tokenInfo } from '../../api/mockPools.js'
import { curvePoints, emptyNote } from '../../components/charts/curveModel.js'
import { NB, tokenAmount, unitText } from '../../lib/format.js'
import { NOW, renderPool, V3_WETH_USDC } from './testing.js'

afterEach(cleanup)

const AERO = tokenInfo('AERO')
const AERO_AERODROME = tokenInfo('AERO_AERODROME')
const PAIR = { token0: AERO, token1: AERO_AERODROME }

describe('Pool page: an AERO/AERO pool', () => {
  it('names each AERO in the data tables, the spread note and the price axis', async () => {
    renderPool(V3_WETH_USDC, { meta: PAIR })
    await screen.findByRole('heading', { level: 1, name: 'AERO (Aero) / AERO (Aerodrome)' })
    for (const button of screen.getAllByRole('button', { name: /^(Show data|Details)$/ }))
      fireEvent.click(button, { detail: 0 })
    const heads = [...document.querySelectorAll('th')].map((th) => th.textContent)
    expect(heads).toContain('AERO (Aero) sold')
    expect(heads).toContain('AERO (Aerodrome) spent')
    expect(heads).not.toContain('AERO sold')
    expect(
      screen.getByText('Average prices in AERO (Aerodrome) per AERO (Aero), fees included.'),
    ).toBeTruthy()
    expect(await screen.findByText('Price, AERO (Aerodrome) per AERO (Aero)')).toBeTruthy()
  })

  it('labels the amount units only when the two tokens share a symbol', async () => {
    const { latest } = await createMockClient({ now: NOW }).pool(V3_WETH_USDC)
    if (latest === null) throw new Error('mock pool without a snapshot')
    const units = (token0: typeof AERO, token1: typeof AERO) =>
      curvePoints(latest, token0, token1).map((p) => p.amount.split(NB).slice(1).join(NB))
    expect(new Set(units(AERO, AERO_AERODROME))).toEqual(
      new Set(['AERO (Aero)', 'AERO (Aerodrome)']),
    )
    const plain = { ...tokenInfo('USDC'), label: 'USDC' }
    expect(new Set(units(AERO, plain))).toEqual(new Set(['AERO', 'USDC']))
    expect(unitText(AERO_AERODROME, AERO)).toBe('AERO (Aerodrome)')
    expect(unitText(AERO_AERODROME, plain)).toBe('AERO')
    expect(tokenAmount('1250000000000000000000', AERO, AERO_AERODROME)).toBe(
      `1,250${NB}AERO (Aero)`,
    )
    expect(
      emptyNote(curvePoints(latest, AERO, AERO_AERODROME).slice(0, 1), AERO, AERO_AERODROME),
    ).toContain('AERO (Aerodrome) has no USD price')
  })
})

describe('Pool page: where a dynamic fee was read', () => {
  const AERO_CL = 'aero-slipstream:0x9e2b4d6f8a1c3e5b7d9f0a2c4e6b8d1f3a5c7e92'
  const aboutRow = (term: string) =>
    [...document.querySelectorAll('.about dt')].find((dt) => dt.textContent === term)
      ?.nextElementSibling?.textContent

  it('shows the latest snapshot’s fee when it has one, else the reading at discovery', async () => {
    const { latest } = await createMockClient({ now: NOW }).pool(AERO_CL)
    if (latest === null) throw new Error('mock pool without a snapshot')
    renderPool(AERO_CL, { patch: { latest: { ...latest, feePips: 2_055 } } })
    await screen.findByRole('heading', { level: 1 })
    expect(aboutRow('Fee')).toBe(`0.2055${NB}%, dynamic (read at the latest snapshot)`)
    cleanup()
    renderPool(AERO_CL, { patch: { latest: { ...latest, feePips: null } } })
    await screen.findByRole('heading', { level: 1 })
    expect(aboutRow('Fee')).toBe(`0.0465${NB}%, dynamic (read at discovery)`)
  })
})
