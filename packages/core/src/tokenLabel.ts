/**
 * Display labels for tokens whose symbol is not unique (DESIGN.md, "Shared types"). A symbol is
 * not an identity: the old and the new AERO both answer `symbol()` "AERO", and copycats reuse any
 * symbol. The address is the identity; the label only tells tokens apart on screen.
 */
import type { Address, TokenInfo } from './types.js'

type LabelledToken = Pick<TokenInfo, 'address' | 'symbol' | 'name'>

/** `symbolKey(symbol)` and `symbolNameKey(symbol, name)` → the addresses of the indexed tokens. */
export interface SharedSymbols {
  bySymbol: ReadonlyMap<string, ReadonlySet<Address>>
  bySymbolName: ReadonlyMap<string, ReadonlySet<Address>>
}

/** The symbol trimmed and lowercased: "AERO", " aero" and "Aero" share one key. */
export function symbolKey(symbol: string): string {
  return symbol.trim().toLowerCase()
}

/** Symbol and name together, each trimmed and lowercased. */
export function symbolNameKey(symbol: string, name: string): string {
  return JSON.stringify([symbolKey(symbol), name.trim().toLowerCase()])
}

function add(index: Map<string, Set<Address>>, key: string, address: Address): void {
  const set = index.get(key) ?? new Set<Address>()
  set.add(address)
  index.set(key, set)
}

/** The index `tokenLabel` reads, built over a token set (the API uses the tokens of scored pools). */
export function buildSharedSymbols(tokens: readonly LabelledToken[]): SharedSymbols {
  const bySymbol = new Map<string, Set<Address>>()
  const bySymbolName = new Map<string, Set<Address>>()
  for (const token of tokens) {
    const address = token.address.toLowerCase() as Address
    add(bySymbol, symbolKey(token.symbol), address)
    add(bySymbolName, symbolNameKey(token.symbol, token.name), address)
  }
  return { bySymbol, bySymbolName }
}

/** True when `index` holds an address other than `address` under `key`. */
function heldByOther(
  index: ReadonlyMap<string, ReadonlySet<Address>>,
  key: string,
  address: string,
): boolean {
  for (const other of index.get(key) ?? []) if (other !== address) return true
  return false
}

/** `0x3f5b…a4ee`: the first four and the last four hex digits. */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * The token's symbol when no other indexed address shares it; otherwise "SYMBOL (name)" when no
 * other indexed address shares symbol and name; otherwise "SYMBOL (0x3f5b…a4ee)". The token itself
 * need not be indexed, so a token outside the set is still told apart from the ones inside it.
 */
export function tokenLabel(token: LabelledToken, shared: SharedSymbols): string {
  const address = token.address.toLowerCase()
  if (!heldByOther(shared.bySymbol, symbolKey(token.symbol), address)) return token.symbol
  const name = token.name.trim()
  if (name !== '' && !heldByOther(shared.bySymbolName, symbolNameKey(token.symbol, name), address))
    return `${token.symbol} (${name})`
  return `${token.symbol} (${shortAddress(address)})`
}
