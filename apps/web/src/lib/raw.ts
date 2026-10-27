/**
 * Raw on-chain integers (token amounts, block numbers) arrive as decimal strings and are handled
 * with BigInt only (AGENTS.md rule 1); a `number` appears only at the human-facing edge.
 */

/** "52950000" → "52,950,000" (digits only). */
export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * Raw amount (decimal string, smallest unit) → human string using BigInt only. `maxFrac` caps the
 * fraction digits; trailing zeros are trimmed. Invalid input → null.
 */
export function rawToDecimal(raw: string, decimals: number, maxFrac = 4): string | null {
  const neg = raw.startsWith('-')
  const digits = neg ? raw.slice(1) : raw
  if (!/^\d+$/.test(digits) || !Number.isInteger(decimals) || decimals < 0) return null
  const base = 10n ** BigInt(decimals)
  const value = BigInt(digits)
  const whole = value / base
  const frac = value % base
  const fracText = frac
    .toString()
    .padStart(decimals, '0')
    .slice(0, Math.max(0, maxFrac))
    .replace(/0+$/, '')
  const sign = neg && value !== 0n ? '-' : ''
  return `${sign}${whole.toString()}${fracText ? `.${fracText}` : ''}`
}
