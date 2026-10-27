import type { Address, TokenInfo } from '@depthwatch/core'
import type { SqlContext } from '../context.js'
import { colNumber, colText, jsonList, normalizeAddress, type Row, toCount } from '../sql.js'

const UPSERT = `INSERT INTO tokens (address, symbol, name, decimals) VALUES (?, ?, ?, ?)
  ON CONFLICT(address) DO UPDATE SET
    symbol = excluded.symbol, name = excluded.name, decimals = excluded.decimals`

const SELECT = 'SELECT address, symbol, name, decimals FROM tokens'

export function rowToToken(row: Row): TokenInfo {
  return {
    address: colText(row, 'address') as Address,
    symbol: colText(row, 'symbol'),
    name: colText(row, 'name'),
    decimals: colNumber(row, 'decimals'),
  }
}

export class TokensRepo {
  constructor(private readonly ctx: SqlContext) {}

  /** Inserts or overwrites every token (keyed by lowercase address). Returns the number written. */
  upsertMany(tokens: readonly TokenInfo[]): number {
    if (tokens.length === 0) return 0
    return this.ctx.transaction(() => {
      for (const token of tokens) this.upsertOne(token)
      return tokens.length
    })
  }

  upsertOne(token: TokenInfo): void {
    this.ctx.run(UPSERT, [
      normalizeAddress(token.address),
      token.symbol,
      token.name,
      token.decimals,
    ])
  }

  get(address: string): TokenInfo | undefined {
    const row = this.ctx.get(`${SELECT} WHERE address = ?`, [normalizeAddress(address)])
    return row ? rowToToken(row) : undefined
  }

  /** One query for any number of addresses; missing tokens are simply absent from the map. */
  getMany(addresses: readonly string[]): Map<Address, TokenInfo> {
    const out = new Map<Address, TokenInfo>()
    if (addresses.length === 0) return out
    const rows = this.ctx.all(
      `${SELECT} WHERE address IN (SELECT value FROM json_each(?)) ORDER BY address`,
      [jsonList(addresses.map(normalizeAddress))],
    )
    for (const row of rows) {
      const token = rowToToken(row)
      out.set(token.address, token)
    }
    return out
  }

  all(): TokenInfo[] {
    return this.ctx.all(`${SELECT} ORDER BY address`).map(rowToToken)
  }

  count(): number {
    const row = this.ctx.get('SELECT COUNT(*) AS n FROM tokens')
    return row ? toCount(colNumber(row, 'n')) : 0
  }
}
