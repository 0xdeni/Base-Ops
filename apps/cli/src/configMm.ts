/**
 * The `mm <subcommand> [id]` part of the command line (market-maker scorecards,
 * docs/design/scorecards.md §5), parsed for config.ts, which re-exports it.
 */
import { ConfigError } from './configValues.js'

/** Subcommands of `depthwatch mm`. */
export const MM_SUBCOMMANDS = ['register', 'list', 'show', 'deactivate', 'sample'] as const
export type MmSubcommand = (typeof MM_SUBCOMMANDS)[number]

/** `mm` subcommands that take a mandate id. */
export const MM_ID_SUBCOMMANDS: readonly MmSubcommand[] = ['show', 'deactivate']
/** `mm` subcommands that read the chain and therefore need DEPTHWATCH_RPC_URL. */
export const MM_LIVE_SUBCOMMANDS: readonly MmSubcommand[] = ['sample']

/** The `mm <subcommand> [id]` part of the command line. */
export interface MmArgs {
  subcommand: MmSubcommand
  /** The mandate id of `show` / `deactivate`; undefined for the other subcommands. */
  id: string | undefined
}

export function isMmSubcommand(value: string): value is MmSubcommand {
  return (MM_SUBCOMMANDS as readonly string[]).includes(value)
}

/**
 * The positionals after `mm`: a subcommand and, for `show` / `deactivate`, the mandate id. `mm`
 * alone yields undefined (main reports the missing subcommand as a usage error).
 */
export function parseMmArgs(
  positionals: readonly string[],
  file: string | undefined,
): MmArgs | undefined {
  const [sub, id, ...rest] = positionals
  if (sub === undefined) return undefined
  if (!isMmSubcommand(sub))
    throw new ConfigError(`unknown mm subcommand "${sub}" (one of ${MM_SUBCOMMANDS.join(', ')})`)
  if (MM_ID_SUBCOMMANDS.includes(sub)) {
    if (id === undefined) throw new ConfigError(`mm ${sub} needs a mandate id`)
    if (rest.length > 0) throw new ConfigError(`unexpected argument "${rest[0]}"`)
    return { subcommand: sub, id }
  }
  if (id !== undefined) throw new ConfigError(`unexpected argument "${id}"`)
  if (sub === 'register' && file === undefined)
    throw new ConfigError('mm register needs --file <registration json>')
  return { subcommand: sub, id: undefined }
}
