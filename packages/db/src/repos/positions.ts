import type { Address, Position } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colBigint, colNumber, colText, normalizeAddress, type Row } from '../sql.js'

const UPSERT = `INSERT INTO positions (
    pool_id, token_id, owner, tick_lower, tick_upper, liquidity, updated_block
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(pool_id, token_id) DO UPDATE SET
    owner = excluded.owner, tick_lower = excluded.tick_lower, tick_upper = excluded.tick_upper,
    liquidity = excluded.liquidity, updated_block = excluded.updated_block`

/** Positions without a token id (no NFT) get a synthetic key; the prefix cannot collide with digits. */
const SYNTHETIC_PREFIX = 'anon:'

export interface ReplacePositionsOptions {
  /** Block the position set was read at; stored on every row. Defaults to 0n. */
  updatedBlock?: bigint
}

export function rowToPosition(row: Row): Position {
  const key = colText(row, 'token_id')
  return {
    owner: colText(row, 'owner') as Address,
    tickLower: colNumber(row, 'tick_lower'),
    tickUpper: colNumber(row, 'tick_upper'),
    liquidity: colBigint(row, 'liquidity'),
    tokenId: key.startsWith(SYNTHETIC_PREFIX) ? null : BigInt(key),
  }
}

export class PositionsRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Atomically replaces the pool's position set. Returns the number of positions stored. */
  replaceForPool(
    poolId: string,
    positions: readonly Position[],
    options: ReplacePositionsOptions = {},
  ): number {
    const updatedBlock = options.updatedBlock ?? 0n
    return this.ctx.transaction(() => {
      this.deleteForPool(poolId)
      positions.forEach((position, index) => {
        const key =
          position.tokenId === null ? `${SYNTHETIC_PREFIX}${index}` : position.tokenId.toString()
        this.ctx.run(UPSERT, [
          poolId,
          key,
          normalizeAddress(position.owner),
          position.tickLower,
          position.tickUpper,
          position.liquidity,
          updatedBlock,
        ])
      })
      return positions.length
    })
  }

  /** Positions ordered by tick range then insertion order. */
  forPool(poolId: string): Position[] {
    return this.ctx
      .all(
        `SELECT token_id, owner, tick_lower, tick_upper, liquidity FROM positions
          WHERE pool_id = ? ORDER BY tick_lower, tick_upper, rowid`,
        [poolId],
      )
      .map(rowToPosition)
  }

  /** Block the stored set was read at; null when the pool has no stored positions. */
  updatedBlock(poolId: string): bigint | null {
    const row = this.ctx.get('SELECT updated_block FROM positions WHERE pool_id = ? LIMIT 1', [
      poolId,
    ])
    return row ? colBigint(row, 'updated_block') : null
  }

  countForPool(poolId: string): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM positions WHERE pool_id = ?', [poolId])
    return row ? colNumber(row, 'n') : 0
  }

  deleteForPool(poolId: string): number {
    return this.ctx.run('DELETE FROM positions WHERE pool_id = ?', [poolId]).changes
  }
}
