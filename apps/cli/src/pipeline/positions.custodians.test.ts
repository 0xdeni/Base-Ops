import { SYNTHETIC_GAUGES, SYNTHETIC_POOL_IDS } from '@depthwatch/chain'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../config.js'
import { createDemoChain } from '../demo.js'
import { createPipelineContext } from './context.js'
import { discoverStep } from './discover.js'
import { positionsStep, storedCustodians } from './positions.js'
import { scoreStep } from './score.js'
import { snapshotStep } from './snapshot.js'

const SLIP = SYNTHETIC_POOL_IDS.wethUsdcSlipstream
const V3 = SYNTHETIC_POOL_IDS.wethUsdcV3

describe('a Slipstream gauge holds staked positions: a custodian, not an owner', () => {
  it('positions records the gauge, the snapshot leaves its positions uncovered, the score sees it', async () => {
    const db = openDatabase(IN_MEMORY)
    try {
      const chain = createDemoChain()
      const latest = await chain.getLatestBlock()
      const ctx = createPipelineContext({
        db,
        chain,
        config: loadConfig({}),
        now: () => latest.timestamp,
      })
      await discoverStep(ctx)
      const pools = [SLIP, V3].map((id) => db.pools.get(id)).filter((p) => p !== undefined)
      await positionsStep(ctx, { pools })
      expect(storedCustodians(db, SLIP)).toEqual([SYNTHETIC_GAUGES.wethUsdcSlipstream])
      expect(storedCustodians(db, V3)).toEqual([])

      const gauge = SYNTHETIC_GAUGES.wethUsdcSlipstream
      // The NFPM reports the gauge as the owner of the staked NFT.
      expect(db.positions.forPool(SLIP).filter((p) => p.owner === gauge)).toHaveLength(1)

      await snapshotStep(ctx)
      const slip = db.snapshots.latestForPool(SLIP)?.concentration?.owners
      const v3 = db.snapshots.latestForPool(V3)?.concentration?.owners
      // Three depositors' own positions; the staked one is uncovered, not a fourth "owner".
      expect(slip?.count).toBe(3)
      expect(slip?.coverage).toBeGreaterThan(0.8)
      expect(slip?.coverage).toBeLessThan(0.9)
      expect(v3?.coverage).toBe(1)

      await scoreStep(ctx)
      const slipHealth = db.scores.get(SLIP)?.health
      expect(slipHealth?.concentrationBasis).toBe('ranges')
      expect(slipHealth?.notes).toContain('owner data covers 87 % of in-band liquidity')
      expect(db.scores.get(V3)?.health.concentrationBasis).toBe('owners')
    } finally {
      db.close()
    }
  }, 30_000)
})
