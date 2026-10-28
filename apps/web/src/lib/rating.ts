/**
 * Why a pool has no grade, in plain words (docs/METRICS.md, "Rated and unrated pools"): the short
 * reason a chip's tooltip starts with, and the full line the pool page and the tooltips give.
 * Formatting only: the reason and the floor come from the API and core.
 */
import { HEALTH_RATING_MIN_SIDE_USD, type UnratedReason } from '@depthwatch/core'
import { NB, usd } from './format.js'

/** What the chip says in place of a letter. */
export const NOT_RATED = 'Not rated'

const SHORT: Readonly<Record<UnratedReason, string>> = {
  thin: 'Too thin to rate',
  'one-sided': 'Too thin on one side',
  unpriced: 'No USD price',
  hooked: 'Hooked pool',
}

/** "Too thin to rate"; a score stored before ratings existed has no reason yet. */
export function unratedShort(reason: UnratedReason | null): string {
  return reason === null ? 'Not rated yet' : SHORT[reason]
}

/** The short reason with its one-line why: "Too thin to rate: neither side holds $5K within 2 %." */
export function unratedDetail(reason: UnratedReason | null): string {
  const floor = usd(HEALTH_RATING_MIN_SIDE_USD)
  const within = `within 2${NB}%`
  switch (reason) {
    case 'thin':
      return `${SHORT.thin}: neither side holds ${floor} ${within}.`
    case 'one-sided':
      return `${SHORT['one-sided']}: the thinner side holds under ${floor} ${within}.`
    case 'unpriced':
      return `${SHORT.unpriced}: a token in this pool has no price in dollars.`
    case 'hooked':
      return `${SHORT.hooked}: its v4 hook runs its own swap code, so depth is not modelled.`
    case null:
      return 'Not rated yet: the score is being refreshed.'
  }
}
