# Metric definitions

This page is the single definition of every number Depthwatch publishes. Each metric is
implemented once, in `packages/core`, and `packages/core/src/metrics/workedExamples.test.ts`
reproduces the worked examples below to the digit (raw amounts to the wei, USD and bps figures to
the two decimals printed here). If the dashboard, the API and this page ever disagree, this page
and the core tests are what gets fixed first.

## Conventions

- **Addresses** are lowercase `0x…` strings. Native ETH (Uniswap v4 `currency0 == address(0)`) is
  `0x0000000000000000000000000000000000000000` with symbol `ETH` and 18 decimals.
- **Price orientation.** `price` always means token1 per token0, decimal adjusted. For a
  concentrated pool, `priceRaw = (sqrtPriceX96 / 2^96)^2` is token1 raw units per token0 raw unit
  and `price = priceRaw × 10^(decimals0 − decimals1)`. Example: in the WETH/USDC pool on Base,
  WETH (18 decimals) is token0 and USDC (6 decimals) is token1 because its address sorts lower;
  at 2,500 USDC per WETH, `priceRaw = 2.5 × 10^-9` and `sqrtPriceX96 ≈ 3.9614 × 10^24`
  (`3961408125713216879677197`). "Price goes up" always means token0 gets more expensive in token1.
- **Mid price** (`mid`) is the pool's current marginal price: from `sqrtPriceX96` for concentrated
  pools; `reserve1 / reserve0` (decimal adjusted) for constant-product pools; the analytic
  `dy/dx` of `x³y + xy³` on 1e18-normalised reserves for stable pools.
- **Fees** are in pips (1e-6): 500 = 0.05 %, 3000 = 0.30 %. Aerodrome v2 reports basis points;
  they are multiplied by 100 at discovery. Every simulation takes the fee from the input amount
  before the price moves, as the contracts do.
- **Swap fee.** The fee a simulated swap pays is the pool's LP fee (`feePips`, the fee shown for
  the pool), except on Uniswap v4, where the PoolManager adds the protocol fee of the swap's
  direction: slot0's `protocolFee` packs 12 bits per direction (zeroForOne in the low bits,
  oneForZero in the high bits, each at most 1,000 pips) and the swap is charged `swapFee =
  protocolFee + lpFee − floor(protocolFee × lpFee / 1e6)` (`ProtocolFeeLibrary.calculateSwapFee`;
  `lpFee` alone when the protocol fee is 0). So a 500-pip pool with a 125-pip protocol fee charges
  625 pips, a 3,000-pip pool with 500 charges 3,499. Depth and spread use the swap fee; `feePips`
  stays the LP fee. Uniswap v3's and Slipstream's protocol shares are cut from the LP fee and do
  not change what a trader pays. A v4 hook that overrides the LP fee per swap is not modelled.
- **Sides.** The **up** side is buy pressure on token0: the input is token1 and the price rises.
  The **down** side is sell pressure on token0: the input is token0 and the price falls. Depth
  and spread are reported for both sides; USD depth sums them, but the health score and the rating
  use the thinner side (see [Rated and unrated pools](#rated-and-unrated-pools)).
- **Raw and human amounts.** Simulation runs on raw `bigint` amounts in the token's smallest
  unit with the contracts' rounding (in the pool's favour). A human number appears only in the
  last step: `human = raw / 10^decimals`.
- **USD conversion.** A token's USD price is derived from the pools themselves (see
  [USD prices](#usd-prices)). If a token has no USD price, every USD metric that needs it is
  `null`. Nothing is estimated.
- **Band.** Concentration is computed inside ±5 % of mid (`CONCENTRATION_BAND_PCT = 5`). Pool state
  is read for at least ±10 % so the band is always inside known ticks; the band is clipped to the
  known tick range and never extrapolated.
- **Null semantics.** `null` means "not known", never "zero". A score component that needs an
  unknown input is scored 0 (depth, spread) or at the neutral midpoint with a note (concentration,
  persistence), as detailed under the health score. A pool whose depth is too thin, one-sided or
  unpriced is not graded at all.
- **Levels.** Depth is computed at 1, 2 and 5 % (`DEPTH_LEVELS_PCT`); spread at $1,000, $10,000
  and $100,000 (`SPREAD_NOTIONALS_USD`). The ±2 % total and the $10k spread are the headline
  numbers used for sorting and scoring.

## Depth at ±p %

**Question.** How much capital does it take to move the price by p % in each direction?

**Definition.** With `mid` the current price:
- `up = simulateSwapToPrice(state, mid × (1 + p/100), decimals)`, input token1. `up.amountIn` is the token1
  required (gross, fee included); `up.amountOut` the token0 received on the way.
- `down = simulateSwapToPrice(state, mid × (1 − p/100), decimals)`, input token0. `down.amountIn` is the
  token0 required; `down.amountOut` the token1 received.
- `reached` is true when the target price was hit. It is false when liquidity ran out first or
  the walk hit the edge of the known tick range; the amounts are then the totals to that point,
  not the depth.

USD: `upUsd = human(up.amountIn) × token1Usd`, `downUsd = human(down.amountIn) × token0Usd`;
`totalUsd = upUsd + downUsd` when both are known, else whichever side is known, else `null`. A
side whose token has no USD price is `null`.

**Per pool kind.**
- Concentrated (Uniswap v3/v4, Slipstream): the Uniswap swap walk. Swap fee off the input, then
  within each tick range of liquidity L from √Pa to √Pb (Q64.96): `Δtoken1 = L × (√Pb − √Pa) /
  2^96` and `Δtoken0 = L × (√Pb − √Pa) × 2^96 / (√Pa × √Pb)`, input rounded up and output rounded
  down; `liquidityNet` applied at every initialised tick crossed. Steps stop exactly where the
  contract's do (the next initialised tick or the edge of the current 256-slot tick-bitmap
  word), so the amounts match on-chain results to the wei. On Uniswap v4 the walk runs with the
  swap fee (LP fee combined with the direction's protocol fee): the same price move then needs
  `1e6 / (1e6 − swapFee)` times the net input, while the amount out is unchanged.
- Constant product (Aerodrome v2 volatile): closed form. The net input that moves `reserve1 /
  reserve0` to the target is `√(target × k) − reserve1` (up) or `√(k / target) − reserve0` (down)
  with `k = reserve0 × reserve1`, then grossed up for the fee.
- Stable swap (Aerodrome v2 stable): exact bisection over the gross input amount on the analytic
  marginal price `dy/dx = (3x²y + y³) / (x³ + 3xy²)` of the post-trade normalised reserves. The
  result is the smallest input (to 1 wei of the input token) whose post-trade marginal price
  passes the target; the contract's `_get_y` Newton solve itself converges to 1 wei of
  normalised units.

**Edge cases.** A pool with no usable mid (a reserve is zero) reports zero amounts with
`reached = false` on every level. `p` must lie in (0, 100). Pools whose known tick range is
narrower than the target move report `reached = false` rather than a guess. A stable pool whose
reserves are too small for the contract's math (below ~1e-6 tokens the invariant's derivative
floors to 0 and the contract reverts, the state a drained pool is left in) and a concentrated pool
with a 100 % LP fee (Uniswap v4 `MAX_LP_FEE`, nothing can move the price) both report zero
amounts with `reached = false`.

**Worked example.** A constant-product WETH/USDC pool with 1,000 WETH and 2,500,000 USDC, fee
0.30 % (3000 pips), WETH = $2,500, USDC = $1. `mid = 2,500`.
- Up 2 %: target 2,550. Net input `√(2,550 × 2.5×10^9) − 2,500,000 = 24,876.23` USDC; grossed up
  for the fee: `24,876.23 / 0.997 = 24,951.09` USDC → `up.amountIn = 24951087854` (raw, 6
  decimals), `up.amountOut ≈ 9.8525` WETH, `upUsd = $24,951.09`.
- Down 2 %: target 2,450. Net input `√(2.5×10^9 / 2,450) − 1,000 = 10.1525` WETH; grossed up:
  `10.1831` WETH → `down.amountIn = 10183093833711884799` (raw, 18 decimals), `downUsd =
  10.1831 × 2,500 = $25,457.73`.
- `depth2Usd = totalUsd = $50,408.82`. At ±1 % the total is $25,138.86 and at ±5 % $127,064.77.

A second example used throughout the health score below: a USDC/WETH pool whose ±2 % depth is
$1.2M on each side, so `depth2Usd = $2.4M`.

## Effective spread at N USD

**Question.** What does a round trip of N dollars cost, fees and price impact included?

**Definition.** For each notional N:
- Buy leg: `amount1In = raw(N / token1Usd)` of token1, `simulateSwapExactIn(state, 'oneForZero',
  amount1In)`; `buyAvg = human(amount1In) / human(amount0Out)`.
- Sell leg: `amount0In = raw(N / token0Usd)` of token0, `simulateSwapExactIn(state, 'zeroForOne',
  amount0In)`; `sellAvg = human(amount1Out) / human(amount0In)`.
- `spreadBps = (buyAvg − sellAvg) / mid × 10 000`.

`buyAvg` and `sellAvg` are human prices (token1 per token0). Both legs include the swap fee (the
LP fee, plus the protocol fee on Uniswap v4, see Conventions), so even an infinitely deep pool shows
a spread of about twice the fee.

**Infeasible.** `spreadBps = null` and `feasible = false` when
- either leg is incomplete (liquidity ran out or the known tick range ended before the input was
  consumed), or yields nothing, or either token has no USD price (the notional cannot be
  converted); or
- either leg's average price impact is above `SPREAD_MAX_LEG_IMPACT_BPS = 5,000` (50 %).

An infeasible $10k spread scores 0 in the health score; it is a signal in itself: the pool cannot
absorb the trade.

**Price impact cap.** Per leg, with `mid` the pool's mid price: `buyImpactBps = (buyAvg / mid − 1)
× 10 000` and `sellImpactBps = (1 − sellAvg / mid) × 10 000`, fees included. Algebraically
`spreadBps = buyImpactBps + sellImpactBps`, so a feasible spread never exceeds 10,000 bps.

_Why completeness is not enough._ A constant-product or stable pool never runs out of liquidity on
an exact-input swap (its curve only approaches the reserve), so such a leg is always `complete`. A
$10,000 buy into a pool that holds a few cents "completes" by returning a sliver of one reserve,
and `buyAvg = amount in / amount out` is then a large number divided by a rounding crumb: on the
first live database an Aerodrome pool with a TVL of 7 × 10⁻¹⁷ USD showed a $10k spread of
1.4 × 10²⁴ bps, and 47 of 148 pools with a feasible $10k spread showed more than 10⁶ bps. Nothing
was wrong with the walk or the division; the number was a correct price for a trade that never
could have happened.

_Why 5,000 bps per leg._ Of those 148 pools, 74 had a $10k spread of 5,000 bps or more and 74 had
one from 0.3 to 3,525 bps; at $10k nothing lies between 3,525 and 10,103 bps. At $1,000 and
$100,000 the values are continuous (4,479, 4,585, 4,612, 5,232, … bps), so the cap is a chosen line,
not a natural break: it is where a leg gives away half of its value, and a trade that costs half of
itself has not been absorbed. With the cap the pools with a feasible spread at $1k / $10k / $100k
go from 186 / 148 / 114 to 121 / 74 / 34 of 492. The cap applies to snapshots taken after it was
introduced. Spreads already stored are not rewritten, but every read applies the cap
(`feasibleSpreadBps`): a stored point whose legs are above it is served as infeasible, in the
pool's `latest.spreads`, in `spread10kBps` of the lists and in the static export, until the pool is
snapshotted again. The dashboard also prints a spread of 10,000 bps or more as "can't absorb"
rather than as a number.

**Worked example.** Same WETH/USDC pool as above, N = $10,000.
- Buy: 10,000 USDC in, 9,970 after the 0.30 % fee; out = `1,000 × 9,970 / (2,500,000 + 9,970) =
  3.97216` WETH; `buyAvg = 10,000 / 3.97216 = 2,517.52`.
- Sell: 4 WETH in (= $10,000), 3.988 after fee; out = `2,500,000 × 3.988 / 1,003.988 = 9,930.40`
  USDC; `sellAvg = 9,930.40 / 4 = 2,482.60`.
- `spreadBps = (2,517.52 − 2,482.60) / 2,500 × 10,000 = 139.69` bps.

At $1,000 the same pool shows 68.06 bps (about twice the fee plus a little impact); at $100,000
it shows 842.45 bps. The ladder across notionals is the depth story told in price terms. The legs
of the $10,000 spread cost 70.09 bps (buy: `2,517.52 / 2,500 − 1`) and 69.60 bps (sell: `1 −
2,482.60 / 2,500`), which add up to the 139.69 above.

**Worked example: the cap.** The same pool with 1 WETH and 2,500 USDC (TVL $5,000), N = $10,000.
- Buy: 10,000 USDC in, 9,970 after the fee; out = `1 × 9,970 / (2,500 + 9,970) = 0.79952` WETH;
  `buyAvg = 12,507.52`, a buy impact of 40,030.09 bps.
- Sell: 4 WETH in, 3.988 after the fee; out = `2,500 × 3.988 / (1 + 3.988) = 1,998.80` USDC;
  `sellAvg = 499.70`, a sell impact of 8,001.20 bps.
- Both legs complete, but the buy impact is above 5,000 bps: `spreadBps = null`, `feasible = false`.
  Without the cap the pool would have published 48,031.29 bps.

With ten times the reserves (10 WETH, 25,000 USDC, TVL $50,000) the same trade is feasible: the buy
costs 4,030.09 bps (`buyAvg = 3,507.52`), the sell 2,872.46 bps (`sellAvg = 1,781.88`) and
`spreadBps = 6,902.55`.

## LP concentration

**Question.** Is the in-band liquidity one position or many, and how much of it does the largest
owner control? Structural concentration is readable from pool state alone; ownership needs
indexed positions.

Both are computed inside the band `[mid × (1 − 5 %), mid × (1 + 5 %)]`, expressed as sqrt prices
`√Plower`, `√Pupper` (Q64.96) and clipped to the known tick range.

### Range HHI (structural)

Split the band into tick ranges between consecutive initialised ticks. Each range has a constant
liquidity `L_range` (the active liquidity, adjusted by `liquidityNet` at each tick crossed away
from the current tick). Weight each range by `L_range × (√Pupper_range − √Plower_range)` with the
sqrt bounds clipped to the band; this is approximately the token1 value of the range.
- `share_i = weight_i / Σ weight`
- `rangeHhi = Σ share_i²` (0..1; 1 = all in-band liquidity sits in a single range)
- `activeRangeShare` = share of the range that contains the current tick (0..1)

Edge cases: no positive weight in the band → `rangeHhi = 1`, `activeRangeShare = 0`. Ranges with
negative liquidity (inconsistent tick data) count as 0.

### Owner concentration

For each indexed position overlapping the band: `weight = liquidity × (clipped √Pupper − clipped
√Plower)`, aggregated by owner (lowercase address). Positions with zero liquidity or no overlap
are skipped.
- `count` = owners with weight > 0
- `top1Share`, `top3Share` = share of the largest owner, of the three largest (capped at 1)
- `hhi = Σ share²` over owners (0..1)

`owners` is `null` when positions were not indexed for the pool (`depthwatch positions` has not
run for it, or the DEX has no observable positions). When positions were indexed but none overlap
the band, `count = 0` and all shares are 0.

### Reserve pools

Aerodrome v2 pools are one full-range position by construction: `rangeHhi = 1`,
`activeRangeShare = 1`, `owners = null` (LP tokens are fungible; holder distribution is not
indexed in the MVP).

**Worked example.** A pool with three in-band ranges weighing 60, 30 and 10 (any unit): shares
0.6, 0.3, 0.1 → `rangeHhi = 0.36 + 0.09 + 0.01 = 0.46`. If the current tick is in the 60 range,
`activeRangeShare = 0.6`. Three owners with weights 42, 38, 20 → `top1Share = 0.42`, `top3Share =
1`, `hhi = 0.1764 + 0.1444 + 0.04 = 0.3608`, `count = 3`.

## Liquidity persistence (window W hours)

**Question.** When we looked during the last W hours, how much of the depth was there?

**Definition.** Samples are the stored snapshots with timestamp in `(now − W × 3600, now]` and a
non-null, finite, non-negative `depth2Usd`. Let `median` and `p10` be the 50th and 10th percentiles
of the sampled depths, with linear interpolation between order statistics (`rank = p/100 × (n −
1)`, the numpy default).
- `stability = clamp(p10 / median, 0, 1)`
- `uptime` = share of samples with `depth ≥ 0.5 × median`
- **Too few samples.** Both are `null` ("unknown") with fewer than 3 samples.
- **Dead pool.** With 3 or more samples and a median of 0, `stability` and `uptime` are both 0:
  "at least half of nothing" is true of every sample, so without this rule a pool that never held
  a dollar would show an uptime of 1 and earn the persistence points. A pool with nothing to keep
  is not "unknown", so this holds whatever the coverage.
- **Coverage.** Otherwise both are `null` unless the oldest and newest sample are at least
  `PERSISTENCE_MIN_COVERAGE = 25 %` of the window apart: 6 h for the 24 h window, 42 h for the 7 d
  window. Three snapshots taken minutes apart say nothing about a day.
- `depthUsdMedian`, `depthUsdP10` and `depthUsdMin` are always reported from whatever samples
  exist, and `samples` is the count.

Windows: 24 h and 7 d. `stability` says how deep the bad decile was relative to a normal reading;
`uptime` says how often the pool was at least half as deep as normal.

On the first live database, 5 snapshots spanned 51 minutes (0.86 h), so every pool's "24 h"
persistence was computed from under an hour, and the 144 pools holding nothing at all showed an
uptime of 1; with the coverage rule it is unknown for every pool with depth until the snapshots
span 6 h, and 0 for a pool with no depth.

**Worked example.** Six samples 4 h apart (a 20 h span, at least 6 h) in the last 24 h with
`depth2Usd` of 100,000; 120,000; 95,000; 110,000; 40,000; 105,000. Sorted: 40,000; 95,000; 100,000;
105,000; 110,000; 120,000.
- `median`: rank `0.5 × 5 = 2.5` → halfway between 100,000 and 105,000 = **102,500**
- `p10`: rank `0.1 × 5 = 0.5` → halfway between 40,000 and 95,000 = **67,500**
- `stability = 67,500 / 102,500 = 0.6585`
- `uptime`: threshold `0.5 × 102,500 = 51,250`; five of six samples qualify → **0.8333**

With only the first two samples, `median = 110,000`, `p10 = 102,000`, and both `stability` and
`uptime` are `null` (fewer than 3). Three samples 1 h apart are `null` too: they span 2 h, under the
6 h the 24 h window needs, and 3 samples spanning 6 h exactly count. Three samples of 0, whether
1 h or 11 h apart, give `stability = 0` and `uptime = 0`.

## Liquidity Health Score

**Question.** One number, 0–100, that ranks pools by how usable their liquidity is, and a letter
for the pools that have enough liquidity to be rated at all.

Four components, maximum 35 + 25 + 20 + 20 = 100. Each component is rounded to two decimals; the
total is the sum of the rounded components. Inputs: `depth2UpUsd` and `depth2DownUsd` (the two
sides of the ±2 % level of the latest snapshot), `spread10kBps` (from the latest snapshot),
`ownerTop1Share` and `rangeHhi` (from the latest snapshot's concentration), and the 24 h
persistence. Every pool keeps its numeric total and components; only a _rated_ pool gets a grade.

### Rated and unrated pools

Concentration and persistence do not depend on size, so an empty pool still earns part of them
(on the first live database, 10 to 35 points of 100 for each of the 275 pools holding under $1
within 2 %), and a letter
for such a pool compares nothing. A pool is **rated** only when both sides of its ±2 % depth are
known and the thinner side holds at least `HEALTH_RATING_MIN_SIDE_USD = $5,000`. Otherwise it is
unrated, `grade` is `null` and `unratedReason` says why, tested in this order:
- `unpriced`: a side's USD depth is `null` (its token has no USD price, or the snapshot has no
  ±2 % level).
- `one-sided`: both sides are known, the deeper one holds at least the floor and the thinner one
  does not (it may be 0).
- `thin`: both sides are known and neither holds the floor.

A rated pool has `rated = true` and `unratedReason = null`. The boundary is inclusive: exactly
$5,000 on the thinner side is rated.

_Why the thinner side._ Price routing already weights a pool by its thinner side (see
[USD prices](#usd-prices)). A pool with $1,000,000 above its price and nothing below it can absorb
buys but no sells; summing the sides graded it A or C while no one could sell into it.

_Why $5,000._ The headline spread is measured on a $10,000 trade. A pool whose thinner side holds
under $5,000 within 2 % cannot absorb half of that trade on that side without moving more than
2 %, so a grade would compare nothing. On the first live database (492 scored pools) the number of
pools whose thinner side holds at least $1,000 / $2,500 / $5,000 / $10,000 is 81 / 64 / 50 / 40,
and the share graded F among them is 24 of 81, 7 of 64, 3 of 50 and 1 of 40: at $1,000 the rated
set is still full of dust that earns an F, at $5,000 an F means a real pool that is poor.
$10,000 would rate 40 pools and leave out pools that do trade. With $5,000, 50 pools are rated
(7 A, 18 B, 9 C, 13 D, 3 F; median 61.66, grade C) and 442 are not (431 thin, 11 one-sided,
0 unpriced). Before this rule 390 of the 492 were graded F and the median was 20 (F).

Of the 492, the 144 pools that held nothing on either side and the 348 others all had a 24 h
persistence computed from 5 snapshots 51 minutes apart: now the 144 score 0 for it (a dead pool)
and the 348 the neutral 10 with the note `persistence neutral: samples cover under 25 % of the
window`.

### Depth (max 35)

`35 × clamp((log10(2 × thinner) − 3) / 3, 0, 1)`, with `thinner = min(depth2UpUsd,
depth2DownUsd)`.

The depth the pool would have if both sides matched its thinner one ("balanced-equivalent"): $1,000
or less (a thinner side of $500) → 0; $1,000,000 or more (a thinner side of $500,000) → 35;
logarithmic in between. A pool that holds $1,000,000 on one
side and nothing on the other scores 0, not 35. A side that is `null` makes the thinner side
unknown: 0 with the note `depth unknown: scored 0`.

Example: $1.2M on each side → `2 × 1.2M = 2.4M` → `log10 = 6.38`; `(6.38 − 3) / 3 = 1.127` → clamp
→ 1 → **35**. $25,000 on each side → `50,000` → `(4.699 − 3) / 3 = 0.566` → **19.82**. $1,000 on each side →
`2,000` → `(3.301 − 3) / 3 = 0.100` → **3.51**. $1,000,000
up and $0 down → `0` → **0**. $5,000 up and $20,000 down → `2 × 5,000 = 10,000` → `(4 − 3) / 3` →
**11.67**.

### Spread (max 25)

`25 × clamp((log10 300 − log10 spread10kBps) / (log10 300 − log10 10), 0, 1)`

10 bps or tighter → 25; 300 bps or wider → 0; logarithmic in between. `null` (infeasible at $10k,
see the price impact cap) → 0 with the note `spread infeasible at $10k: scored 0`. A non-positive
spread, which can only arise from rounding on a zero-fee pool, scores the maximum.

Example: 30 bps → `(log10 300 − log10 30) = 1` exactly, divided by `1.4771` → `0.6770` → **16.92**.
100 bps → `(2.4771 − 2) / 1.4771 = 0.3230` → **8.08**.

### Concentration (max 20)

- Owners known (`ownerTop1Share` not null and > 0): `20 × (1 − top1Share)`
- Otherwise, `rangeHhi` known: `20 × (1 − rangeHhi)`
- Neither: **10** with the note `concentration neutral: no position or range data`

Example: `top1Share = 0.42` → **11.6**. Owners unknown, `rangeHhi = 0.18` → **16.4**. A reserve
pool always has `rangeHhi = 1` and no owners in the MVP, so it scores 0 here; that is a known
limitation that LP-token holder indexing will lift.

### Persistence (max 20)

`20 × (0.5 × stability + 0.5 × uptime)` over the 24 h window. Unknown persistence (`null`: fewer
than 3 samples, or samples spanning under 25 % of the window, see
[persistence](#liquidity-persistence-window-w-hours)) → **10** with the note `persistence neutral:
fewer than 3 samples` or `persistence neutral: samples cover under 25 % of the window`. A pool
whose median depth is 0 has `stability = uptime = 0` → **0**.

Example: `stability = 0.6585`, `uptime = 0.8333` → `20 × 0.7459` → **14.92**.

### Grade

For rated pools only: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F. The thresholds are unchanged; on
the 50 rated pools of the first live database they give 7 A, 18 B, 9 C, 13 D and 3 F.

### Medians over rated pools

`medianHealth` (the Home headline and `GET /api/stats`, in `totals` and per DEX) is the median of
`health.total` over **rated** pools only, with the usual interpolation between the two middle
values; the letter shown beside it is `healthGrade(median)`. The stats also carry `rated`, the
number of rated pools, next to `scored`. `medianHealth` is `null` when no pool is rated. Unrated
pools stay in every list, in the gaps feed and in the depth and volume sums; sorting by health puts
them after the rated ones in both directions.

Example: five scored pools with totals 85, 70, 55 (rated) and 20, 12 (unrated): `rated = 3`,
`scored = 5`, `medianHealth = 70` (B). The median over all five would have been 55.

### Worked examples

Unless stated, "known" persistence is the 14.92 example above.
1. $1.2M on each side, `spread10kBps = 30`, `top1Share = 0.42`, persistence known: depth 35 +
   spread 16.92 + concentration 11.6 + persistence 14.92 = **78.44, rated, grade B**, no notes.
2. $25,000 on each side, `spread10kBps = 100`, owners unknown with `rangeHhi = 0.18`, fewer than
   three snapshots: 19.82 + 8.08 + 16.4 + 10 = **54.3, rated, grade C**, note `persistence neutral:
   fewer than 3 samples`.
3. A pool just discovered, nothing known: 0 + 0 + 10 + 10 = **20, unrated (`unpriced`), no grade**,
   with all four notes. Its total still ranks it below every pool with any depth.
4. $500 on each side, `spread10kBps = 10`, `top1Share = 1`, persistence known: 0 + 25 + 0 + 14.92 =
   **39.92, unrated (`thin`), no grade**: a single-owner, tight but empty pool, which the earlier
   rules graded D.
5. $1,000,000 up and $0 down, otherwise as example 1: 0 + 16.92 + 11.6 + 14.92 = **43.44, unrated
   (`one-sided`), no grade**; summing the sides it scored 78.44 and a B.
6. $5,000 up and $20,000 down, otherwise as example 1: 11.67 + 16.92 + 11.6 + 14.92 = **55.11,
   rated, grade C**. With $4,999.99 up it is unrated (`one-sided`).
7. Three snapshots a minute apart, all with a depth of 0: `stability = uptime = 0`, persistence
   **0** (a dead pool earns nothing). Three snapshots with a depth of 100,000 a minute apart:
   unknown, persistence **10** with the note `persistence neutral: samples cover under 25 % of the
   window`.

## 24 h volume

**Question.** How much traded in the pool over the last day?

**Buckets.** The volume step reads the `Swap` events of every tracked pool and sums them into
hourly buckets, half-open hours `[h, h + 1 h)` on unix-hour boundaries. A swap counts `|amount|` of
one priced side: the USD stablecoin side when there is one, else token1, else token0, valued with
the prices the snapshot step stored. Every pass revalues the pool's stored buckets at the current
prices, so the whole window is valued alike.

**Window.** Let `E` be the timestamp of the last block the latest volume pass read and `H` the
start of the hour that holds it (`H = E − E mod 3,600`). The window is `[H − 24 h, H)`: exactly 24
whole hourly buckets, and `volume24hUsd` is the sum of the pool's buckets whose `hourStart` lies in
it.
- **First bucket.** The window starts on an hour boundary, and the volume step scans from at least
  an hour (plus 300 blocks of block-time slack) before it and drops the swaps before the boundary,
  so the first bucket is complete. No bucket is prorated.
- **Last, partial hour.** The hour from `H` to `E` is stored but not counted: it is still being
  filled, and a later pass completes it. The window therefore ends 0 to 1 hour before the data.
- **Between volume and score.** The window is anchored to `E`, not to the scoring clock, so a
  snapshot or a pause between the volume pass and the score does not shorten it. `run` orders its
  steps snapshot → volume → score: `volume` values swaps at the prices just stored, and `score`
  follows it directly.
- `0` when the pool's buckets cover the window and it did not trade.
- `null` when no volume pass is stored or the latest ended more than 24 h before the score
  (stale); when the pool was not part of the latest pass or its buckets do not reach back to
  `H − 24 h` (newly tracked, or `--hours` below 24); or when a traded hour in the window has no
  USD value (neither token priced).

**Worked example.** The last volume pass read up to a block at 14:37:20 UTC, so `H = 14:00` and the
window runs from 14:00 yesterday to 14:00 today. If each of those 24 hours traded $20,000,
`volume24hUsd = $480,000`; the $9,000 traded from 14:00 to 14:37 today is not counted yet, nor is
the hour before 14:00 yesterday. Scored at 15:10 after another snapshot, the window and the total
are the same. If the pool's buckets were complete only from 15:00 yesterday (23 hours),
`volume24hUsd` would be `null`.

## Gap score and the gaps feed

**Question.** Which pools have real trading but not the depth to carry it?

**Definition.**
- `turnover = volume24hUsd / depth2Usd`
- `gapScore = 100 × clamp(log10(turnover) / 2, 0, 1)`

Turnover of 1× (a day's volume equals the ±2 % depth) → 0; 10× → 50; 100× or more → 100; below 1×
→ 0. `turnoverRatio` and `gapScore` are `null` when volume or depth is unknown or depth is 0.

**Feed.** `GET /api/gaps` lists pools with `volume24hUsd ≥ 10,000` sorted by `gapScore`
descending. The volume floor keeps dust pools with a single trade out of the feed.

**Worked example.** `volume24hUsd = $500,000`, `depth2Usd = $20,000` → `turnover = 25` →
`log10 25 / 2 = 0.699` → **69.90**. `$20,000 / $20,000` → 0. `$2,000,000 / $20,000` → 100.
`$5,000 / $20,000` → 0. Depth 0 → `null`.

## TVL

`tvlUsd = human(reserve0) × token0Usd + human(reserve1) × token1Usd`. A side without a USD price
is skipped, so a one-sided value is a lower bound; when neither side is priced, `null`. For the
worked-example pool: `1,000 × 2,500 + 2,500,000 × 1 = $5,000,000`. Uniswap v4 pools expose no
cheap balance read; their reserves are reported as 0 and TVL ranking falls back to liquidity.

TVL ranks which pools get full depth snapshots; it is not a liquidity metric. Two pools with the
same TVL can differ by an order of magnitude in ±2 % depth, which is the point of this project.

## USD prices

**Question.** What is a token worth in dollars, read from the pools alone?

**Graph.** Every pool with a usable mid price is an edge `token0 ↔ token1` at its price (token1 per
token0). Native ETH (Uniswap v4 `currency0 = 0x0`) is tied to WETH by a 1:1 edge of unbounded
weight. Anchors are the USD stablecoins (USDC, USDbC, DAI and USDT = 1). `derivePrices` runs a
widest-path (maximum-bottleneck) search from the anchors: among all routes from an anchor to a
token, the one whose weakest edge is strongest wins, and the token's USD price is the product of
the pool prices along it. Tokens unreachable from an anchor have no USD price. The route is stored
(`via`) and shown on the token page so that any price can be audited.

**Edge weight: the thinner side.** Each pool's ±2 % depth (`PRICE_DEPTH_PCT`) is computed with
`computeDepth`, on the pool's full state when the snapshot step read it, otherwise on a state built
from the overview (Aerodrome v2 reserves, exact; a concentrated pool's active liquidity held
constant over ±2,000 ticks). With `up = human(up.amountIn)`, the token1 that moves the price 2 % up,
and `down = human(down.amountIn)`, the token0 that moves it 2 % down:
- `weight = min(up × token1Usd, down × token0Usd)`: the thinner side, in USD.
- A pool with no liquidity within 2 % on one side of its price has weight 0 and is no route,
  however deep its other side.

USD prices are what is being derived, so the search runs twice. The first pass values both sides
in token1 at the pool's own price (`weight = min(up, down × price)`); the second values each side
at its token's first-pass USD price, drops the edges whose tokens the first pass could not price,
and gives the published prices. Because both sides count, an edge's weight can only be inflated
when the first pass overprices both of its tokens.

**Why the thinner side.** A pool's mid price is only as good as the trades that would correct it.
When a pool's price drifts away from the market, arbitrage trades against it until the side it
profits from is empty, so a stale price survives only in a pool that holds nothing on that side of
its price. Weighted by one side, such a pool won on the depth of the side that nobody trades
against.

**Worked example** (the live run at Base block 53,063,332). The Uniswap v3 BRETT/USDC 0.3 % pool
(BRETT is token0) had no active liquidity and one range just above a stale mid of 17.96 USDC per
BRETT: `up = 32,059` USDC, `down = 0` BRETT, so `weight = min($32,059, $0) = 0`. The WETH/BRETT
pools price BRETT at about $0.0047, through a route whose bottleneck was about $3,900. Weighted by
the up side alone, the one-sided pool's $32,059 beat that route, BRETT was priced at $17.96 (3,800
times too high) and BRETT pools showed $3.33 B of a $3.59 B TVL. Weighted by the thinner side, the
pool is no route and BRETT is priced through WETH at $0.0047.
`apps/cli/src/pipeline/prices.oneSided.test.ts` reproduces the case.

This is a valuation convention for depth and volume, not an oracle.

## Why these metrics

For a **market maker**, the question is what it will be quoting into. Depth at a percentage move
is the inventory the pool can absorb before the quote is gone, per side, which is the number in
every mandate ("maintain $X within ±2 %"). The effective spread ladder is what a taker actually
pays at the sizes that matter, fees included, so it is comparable across fee tiers and pool types.
Range and owner concentration say whether the depth is one position that can be withdrawn in a
single transaction, and whether the "pool" is really one counterparty. Persistence turns a point
reading into a track record: a pool that is deep at snapshot time but empty for a tenth of the day
is not deep.

For a **protocol team**, the same numbers answer whether their token is tradeable at size, whether
a market maker is delivering what was agreed, and where to direct incentives: the gaps feed is a
ranked list of pools where volume exists but depth does not, which is where added liquidity earns
the most fees and does the most good. The health score exists so that a list of thousands of
pools can be sorted; the components exist so that nobody has to trust the score.

All of this is computed from public pool state with the contracts' own math, so any reading can be
reproduced by anyone with an RPC endpoint and this page.

## Where each metric lives

| Metric                   | Module                                              | Function(s)                                                                                       |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Depth                    | `packages/core/src/metrics/depth.ts`                | `computeDepth`, `depthToUsd`                                                                      |
| Effective spread         | `packages/core/src/metrics/spread.ts`               | `computeEffectiveSpread`, `feasibleSpreadBps`, `SPREAD_MAX_LEG_IMPACT_BPS`                        |
| Concentration            | `packages/core/src/metrics/concentration.ts`        | `computeConcentration`, `computeConcentrationForReserves`, `bandSqrtBounds`                       |
| Persistence              | `packages/core/src/metrics/persistence.ts`          | `computePersistence`, `PERSISTENCE_MIN_COVERAGE`                                                  |
| Health score, rating     | `packages/core/src/metrics/health.ts`               | `computeHealthScore`, `healthGrade`, `rateDepth`, `HEALTH_RATING_MIN_SIDE_USD`, `HEALTH_MAX`      |
| Gap score                | `packages/core/src/metrics/gap.ts`                  | `computeGap`, `GAP_FEED_MIN_VOLUME_USD`                                                           |
| TVL                      | `packages/core/src/metrics/tvl.ts`                  | `tvlUsd`                                                                                          |
| 24 h volume              | `packages/core/src/metrics/volume.ts`               | `volumeWindow`, `scoringVolumeWindow`, `computeVolume24hUsd`                                      |
| USD prices               | `packages/core/src/pricing.ts`                      | `derivePrices`; edge weights in `apps/cli/src/pipeline/prices.ts` (`edgeWeight`, `usdEdgeWeight`) |
| Swap simulation          | `packages/core/src/swap/`                           | `simulateSwapExactIn`, `simulateSwapToPrice`, `midPrice`, `swapFeePips`, `v4SwapFeePips`          |
| Tick and sqrt-price math | `packages/core/src/tickMath.ts`, `sqrtPriceMath.ts` | `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, `sqrtPriceX96ToPrice`, `priceToSqrtPriceX96`          |
