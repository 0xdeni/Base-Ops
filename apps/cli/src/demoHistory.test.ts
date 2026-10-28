/**
 * The demo history (docs/design/web-v2.md §3): the point grid, the full seven days through the
 * real pipeline within the 20 s budget with the scripted market-maker events at their stated
 * times, and a rerun over the same demo `--db` file rebuilding rather than appending.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYNTHETIC_DEFAULTS, SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import { summarizeScorecard } from '@depthwatch/core'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from './config.js'
import { DEMO_HISTORY, demoHistoryTimestamps, openDemoDatabase, runDemoPipeline } from './demo.js'
import { silentLogger } from './log.js'

const NOW = SYNTHETIC_DEFAULTS.latestTimestamp

describe('demoHistoryTimestamps', () => {
  it('spaces seven days of points 2 h apart, ending at now', () => {
    const points = demoHistoryTimestamps(NOW)
    expect(points).toHaveLength(85)
    expect(points[0]).toBe(NOW - 7 * 86_400)
    expect(points.at(-1)).toBe(NOW)
    expect(points[1]! - points[0]!).toBe(DEMO_HISTORY.stepSeconds)
    expect(demoHistoryTimestamps(NOW, 1)).toEqual([NOW])
    expect(() => demoHistoryTimestamps(NOW, 0)).toThrow(RangeError)
    expect(() => demoHistoryTimestamps(NOW, 1_000)).toThrow(/historyPoints/)
  })
})

describe('demo pipeline: seven days of history', () => {
  it('runs 85 points within the 20 s budget with one Slipstream breach streak and an alternating AERO mandate', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const started = Date.now()
      const result = await runDemoPipeline({ db, config: loadConfig({}), log: silentLogger })
      const ms = Date.now() - started
      expect(ms).toBeLessThan(20_000)
      expect(result.history.timestamps).toHaveLength(DEMO_HISTORY.points)
      // Eight pools: the six of the Uniswap and Aerodrome DEXes and the two Aero ones.
      expect(result.history.snapshots).toBe(8 * DEMO_HISTORY.points)
      for (const id of db.pools.trackedIds()) {
        const score = db.scores.get(id)
        expect(score?.persistence7d.samples).toBe(DEMO_HISTORY.points - 1)
      }
      const flags = (id: string) =>
        db.mmSamples.seriesFor(id, 0).map((s) => (s.withinKpi ? '+' : '-'))
      // Slipstream: within KPI except one streak while its position is dipped (≈ 6 h), then ok.
      const slip = flags('demo-slipstream-weth-usdc').join('')
      expect(slip).toMatch(/^\++-{3}\++$/)
      const breachedAt = db.mmSamples
        .seriesFor('demo-slipstream-weth-usdc', 0)
        .filter((s) => s.withinKpi === false)
        .map((s) => (NOW - s.timestamp) / 3_600)
      expect(breachedAt).toEqual([62, 60, 58])
      const mandates = new Map(result.mandates.map((m) => [m.id, m]))
      const summary = (id: string) => {
        const mandate = mandates.get(id)
        if (mandate === undefined) throw new Error(`no mandate ${id}`)
        return summarizeScorecard(mandate, db.mmSamples.seriesFor(id, 0), NOW)
      }
      expect(summary('demo-slipstream-weth-usdc').status).toBe('ok')
      // AERO: alternates; 7 d uptime between 30 % and 60 %, breached now.
      const aero = summary('demo-aero-usdc-aero')
      expect(aero.status).toBe('breached')
      expect(aero.uptime.d7.uptime ?? 0).toBeGreaterThan(0.3)
      expect(aero.uptime.d7.uptime ?? 1).toBeLessThan(0.6)
      const switches = flags('demo-aero-usdc-aero').filter(
        (flag, i, all) => i > 0 && flag !== all[i - 1],
      )
      expect(switches.length).toBeGreaterThanOrEqual(8)
    } finally {
      db.close()
    }
  }, 60_000)
})

describe('demo history on a reused --db file', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-demo-history-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('rebuilds the history on a rerun over the same demo --db file instead of appending', async () => {
    const config = loadConfig({}, { db: join(dir, 'demo.db') })
    const counts: number[][] = []
    for (let run = 0; run < 2; run++) {
      const db = openDemoDatabase(config)
      try {
        await runDemoPipeline({ db, config, historyPoints: 3 })
        counts.push([
          db.snapshots.count(),
          db.mmSamples.count(),
          db.volume.count(),
          db.positions.countForPool(SYNTHETIC_POOL_IDS.wethUsdcSlipstream),
          db.mmSamples.seriesFor('demo-slipstream-weth-usdc', 0).filter((s) => s.withinKpi).length,
        ])
      } finally {
        db.close()
      }
    }
    expect(counts[0]).toEqual([24, 6, counts[0]?.[2], 4, 3])
    expect(counts[1]).toEqual(counts[0])
  }, 30_000)
})
