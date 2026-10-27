/**
 * Methodology's copy (ia-v3 §4.8): the metric index and one section per anchor, each a plain
 * explanation of at most 150 words (v2's text, in the fixed vocabulary of principles CP9, without
 * "we"), an optional schematic and the exact formula from docs/METRICS.md and docs/SCORECARDS.md.
 * Formulas use only glyphs the self-hosted mono subset carries (no √, Σ or ∈).
 */
import { GAP_FEED_MIN_VOLUME_USD } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { NB, usd } from '../../lib/format.js'
import { DepthSchematic, KpiSchematic, PersistenceSchematic } from './figures.js'
import { GapScale, HealthFigure } from './scales.js'

export interface MetricSection {
  id: string
  /** The index term and the "On this page" label. */
  short: string
  /** The index definition: one line (ia-v3 §4.8). */
  definition: string
  title: string
  body: ReactNode
  figure?: ReactNode
  /** The exact definition, behind "Show formula" (L2). */
  formula: string
}

const u = (n: number | string, unit: string) => `${n}${NB}${unit}`

export const SECTIONS: readonly MetricSection[] = [
  {
    id: 'depth',
    short: 'Depth',
    definition: `Dollars it takes to move the price 1, 2 or ${u(5, '%')}, on each side.`,
    title: `Depth at ±1, 2 and ${u(5, '%')}`,
    body: (
      <>
        <p>
          {`Depth answers one question: how many dollars does it take to move a pool’s price by 1, 2 or ${u(5, '%')}? Each reading simulates the swap on the pool’s real state, tick by tick with the contract’s own rounding, once in each direction.`}
        </p>
        <p>
          {`The buy side is the money spent buying the first token to lift the price; the sell side is the first token sold to push it down. Both sides added at ±${u(2, '%')} give the headline number used for sorting and scoring. When liquidity runs out before the target, the side is marked exhausted, and the amount is what it took to empty it.`}
        </p>
      </>
    ),
    figure: <DepthSchematic />,
    formula: [
      'up       = simulateSwapToPrice(state, mid × (1 + p/100))   input token1, buy side',
      'down     = simulateSwapToPrice(state, mid × (1 − p/100))   input token0, sell side',
      'upUsd    = human(up.amountIn) × token1Usd',
      'downUsd  = human(down.amountIn) × token0Usd',
      'totalUsd = upUsd + downUsd                                for p in {1, 2, 5}',
    ].join('\n'),
  },
  {
    id: 'spread',
    short: 'Spread',
    definition: 'What a round trip of $1K, $10K or $100K costs, fees included.',
    title: 'Effective spread',
    body: (
      <p>
        Effective spread is what a round trip costs: buy N dollars of the first token, sell N
        dollars of it back, and compare the two average prices with the mid price. The swap fee and
        price impact are both included (the LP fee, plus on Uniswap v4 the protocol fee, which the
        fee shown for a pool does not include), so even an infinitely deep pool shows about twice
        its swap fee. It is measured at $1K, $10K and $100K; the spread at $10K is the headline. If
        either leg cannot be filled from known liquidity, or one leg pays more than half of its
        value in price impact, the pool can’t absorb that trade and shows no spread, which is a
        signal in itself. A spread that is shown is therefore never above 10,000 bps.
      </p>
    ),
    formula: [
      'buyAvg    = N of token1 in / token0 out',
      'sellAvg   = token1 out / N of token0 in',
      'spreadBps = (buyAvg − sellAvg) / mid × 10 000      for N in {$1K, $10K, $100K}',
      '            = (buyAvg / mid − 1) + (1 − sellAvg / mid), each leg at most 50 %',
    ].join('\n'),
  },
  {
    id: 'concentration',
    short: 'Concentration',
    definition: 'How much of the liquidity near the price one LP or one range holds.',
    title: 'LP concentration',
    body: (
      <p>
        {`Concentration asks whether the depth is many independent positions or one that can be pulled in a single transaction. Inside ±${u(5, '%')} of the price, every tick range is weighted by the liquidity it holds: the range HHI is 1 when everything sits in one range. When positions are indexed, they are also grouped by owner, which gives the top LP’s share, the top three’s share and an owner HHI. Aerodrome v2 pools are one full-range position by construction.`}
      </p>
    ),
    formula: [
      `weight_i = L_i × (sqrt(P_upper) − sqrt(P_lower)), clipped to mid × (1 ± ${u(5, '%')})`,
      'share_i  = weight_i / sum of all weights',
      'rangeHhi = sum of share_i²',
      'owners   : top1Share = the largest share, top3Share = the three largest,',
      '           ownerHhi = sum of each owner’s share²',
    ].join('\n'),
  },
  {
    id: 'persistence',
    short: 'Persistence',
    definition: 'Whether the depth is still there from one snapshot to the next.',
    title: 'Persistence',
    body: (
      <p>
        {`A pool that is deep at snapshot time but empty a tenth of the day is not deep. Persistence looks at every snapshot of the last ${u(24, 'h')} and ${u(7, 'd')}: stability compares the worst tenth of readings with a normal one, and uptime counts how often the pool held at least half its usual depth. Both are unknown, and the health score treats them as neutral, until there are three snapshots that span at least a quarter of the window. A pool with no depth at all scores zero for it.`}
      </p>
    ),
    figure: <PersistenceSchematic />,
    formula: [
      `samples   = depth2Usd of the snapshots in (now − W, now], for W in {${u(24, 'h')}, ${u(7, 'd')}}`,
      'stability = clamp(p10 / median, 0, 1)',
      'uptime    = share of samples with depth ≥ 0.5 × median',
      '            (both null below 3 samples, or when the samples span under a quarter of W;',
      '             both 0 when the median is 0)',
    ].join('\n'),
  },
  {
    id: 'health',
    short: 'Health',
    definition:
      'One score from 0 to 100, and a grade from A to F for pools deep enough to be rated.',
    title: 'Health and grades',
    body: (
      <>
        <p>
          The health score is one number from 0 to 100, so that thousands of pools can be ranked.
          Its four parts are shown on every pool page, so nobody has to trust the total: depth is
          worth up to 35 points, spread 25, concentration 20 and persistence 20. Where money is
          involved, the scale is logarithmic. Depth counts twice the thinner of the two sides, so a
          pool with all its money on one side earns nothing for it. Unknown depth or a spread the
          pool can’t absorb scores 0; unknown concentration or persistence scores the neutral
          midpoint, with a note.
        </p>
        <p>
          {`A grade only means something where there is liquidity to grade. A pool is rated when both sides within ±${u(2, '%')} are known and the thinner one holds at least $5K. Any other pool shows “Not rated” instead of a letter, with the reason: too thin to rate, too thin on one side, or no USD price. It keeps its score and its four parts, and stays in every list; the median health on Home and in the stats counts rated pools only.`}
        </p>
      </>
    ),
    figure: <HealthFigure />,
    formula: [
      'depth          35 × clamp((log10(2 × min(up, down)) − 3) / 3, 0, 1)',
      '               $500 on each side scores 0, $500K on each side scores 35',
      'spread         25 × clamp(log10(300 / spread10kBps) / log10 30, 0, 1)',
      '               300 bps scores 0, 10 bps scores 25',
      'concentration  20 × (1 − top1Share), else 20 × (1 − rangeHhi), else 10',
      `persistence    20 × (0.5 × stability + 0.5 × uptime) over ${u(24, 'h')}, else 10`,
      'rated          both sides known and min(up, down) ≥ $5K',
      'grade          rated pools only: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F',
    ].join('\n'),
  },
  {
    id: 'gaps',
    short: 'Gaps',
    definition: 'Pools that trade far more each day than the liquidity near their price.',
    title: 'Gap score',
    body: (
      <p>
        {`A gap is a pool where a day’s trading is many times the money sitting near its price: real demand, thin liquidity. That is where added liquidity earns the most fees and does the most good. Turnover is the day’s volume over the depth ±${u(2, '%')}; the gap score maps 1× to 0, 10× to 50 and 100× or more to 100. The gaps list only includes pools with at least ${usd(GAP_FEED_MIN_VOLUME_USD)} of ${u(24, 'h')} volume, so dust pools with a single trade stay out.`}
      </p>
    ),
    figure: <GapScale />,
    formula: [
      'turnover = volume24hUsd / depth2Usd',
      'gapScore = 100 × clamp(log10(turnover) / 2, 0, 1)',
      `feed     = pools with volume24hUsd ≥ $${GAP_FEED_MIN_VOLUME_USD.toLocaleString('en-US')}, by gapScore`,
    ].join('\n'),
  },
  {
    id: 'scorecards',
    short: 'Scorecards',
    definition: 'A market maker’s promised depth, checked at every snapshot.',
    title: 'Market-maker scorecards and uptime',
    body: (
      <>
        <p>
          {`A scorecard is a market-making mandate, measured: “keep at least $50K within ±${u(2, '%')} on each side, ${u(95, '%')} of the time”. A project registers a mandate naming the pool, the market maker’s addresses and the KPIs. At every snapshot the pool is rebuilt with only the liquidity those addresses own (their positions, gauge-staked positions resolved to the depositor, or their share of the LP supply), and depth and spread are measured on it with the same code as above.`}
        </p>
        <p>
          {`Each sample is within KPI or breached; a sample with a missing USD price counts on neither side. Uptime is the share of evaluable samples within KPI over ${u(24, 'h')}, ${u(7, 'd')} and ${u(30, 'd')}. The agreed target uptime is shown for comparison and never decides the status.`}
        </p>
      </>
    ),
    figure: <KpiSchematic />,
    formula: [
      'breached  if depthUpUsd < minDepthUsd or depthDownUsd < minDepthUsd',
      '          or spreadBps > maxSpreadBps (or the pool can’t absorb the trade)',
      '          or no holdings were found',
      'uptime(W) = within KPI / evaluable samples in (now − W, now]',
      `            for W in {${u(24, 'h')}, ${u(7, 'd')}, ${u(30, 'd')}}`,
      'status    = inactive, else no data, else breached (latest sample), else within KPI',
    ].join('\n'),
  },
]

/** The closing section (ia-v3 §4.8 "End"). */
export const REPRODUCE = { id: 'reproduce', short: 'Reproduce any number' } as const

/** Every anchor on the page, in order, for "On this page". */
export const OUTLINE: ReadonlyArray<{ id: string; label: string }> = [
  ...SECTIONS.map((s) => ({ id: s.id, label: s.short })),
  { id: REPRODUCE.id, label: REPRODUCE.short },
]
