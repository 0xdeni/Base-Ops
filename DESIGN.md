# Depthwatch design (the contract between packages)

Depthwatch is an open liquidity observatory for **Base mainnet only**. It indexes every Uniswap v3,
Uniswap v4 and Aerodrome (v2 AMM + Slipstream concentrated) pool, and publishes per pool:
- **Depth at ±1 / 2 / 5 %**: how much capital it takes to move the price by that much, each side.
- **Effective spread** at $1k / $10k / $100k round-trip notional, fees included.
- **LP concentration**: structural (tick-range HHI) and ownership (top-1 / top-3 share, HHI over owners).
- **Liquidity persistence** over 24 h / 7 d from stored snapshots.
- A **Liquidity Health Score** (0–100; a grade A–F for _rated_ pools, those whose thinner ±2 % side holds at least
  $5,000) and a **liquidity gaps feed** (real volume, thin depth).

No trading capital, no token, no custody. It is indexing, analytics and a dashboard.

## Repository layout (pnpm workspace, TypeScript, ESM, Node ≥ 22.13)

| Path             | Package             | Responsibility                                                                 | May import                                |
| ---------------- | ------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `packages/core`  | `@depthwatch/core`  | Pure math and scoring. **Zero I/O, zero runtime deps.**                        | nothing                                   |
| `packages/chain` | `@depthwatch/chain` | viem adapters for Base: discovery, state, positions, swaps, fixture transport. | core, viem                                |
| `packages/db`    | `@depthwatch/db`    | `node:sqlite` schema, migrations, repositories.                                | core                                      |
| `apps/api`       | `@depthwatch/api`   | Hono REST API + static serving of the built dashboard.                         | core, db, hono, zod                       |
| `apps/web`       | `@depthwatch/web`   | Vite + React 19 dashboard. Talks only to `/api`.                               | core, react, react-router, tanstack-query |
| `apps/cli`       | `@depthwatch/cli`   | `depthwatch` CLI: the pipeline (discover → snapshot → volume → score → serve). | everything                                |

Package entry points are `src/index.ts` (no build step for Node packages; `tsx` runs TypeScript directly).
Lint/format: Biome (`pnpm lint`). Types: `pnpm typecheck`. Tests: Vitest (`pnpm test`). All three must pass.

Rules for contributors (human or agent):
1. **Do not add dependencies** without updating this file; the lockfile is shared. Core has none.
2. Addresses are lowercase. Never compare addresses case-sensitively.
3. Raw token amounts are `bigint`. Do not convert to `number` until the final human-facing step.
4. Tests never touch the network. Chain code is tested through the fixture transport.
5. Every metric is defined once, in `docs/METRICS.md`, and implemented once, in core.

## Shared types

`packages/core/src/types.ts` is the single source of truth.
Key conventions it encodes:
- `PoolMeta.id` = `${dex}:${poolAddressLowercase}` or `uniswap-v4:${poolId}`.
- `price` = token1 per token0, decimal-adjusted. From `sqrtPriceX96`:
  `priceRaw = (sqrtPriceX96 / 2^96)^2` (token1 raw per token0 raw) and `price = priceRaw * 10^(dec0 − dec1)`.
- Fees in pips (1e-6). Aerodrome v2 `getFee()` returns bps → ×100. `feePips` is the LP fee (shown for the pool);
  a Uniswap v4 `ConcentratedState` also carries `protocolFeePips: { zeroForOne, oneForZero }` from slot0, and its swaps
  pay `swapFeePips` = protocolFee + lpFee − ⌊protocolFee·lpFee / 1e6⌋ per direction (docs/METRICS.md, Conventions).
- `Mandate.alertWebhookUrl` is private: every public surface (API, export, dashboard) uses `PublicMandate`
  (`toPublicMandate`), which has `alertWebhookConfigured: boolean` instead.
- `DepthLevel.up` is the token1 needed to push the price up by pct (buy pressure on token0);
  `DepthLevel.down` is the token0 needed to push it down (sell pressure).

## Core math (packages/core)

Modules and exported functions (names are part of the contract; implementations may add more):

```ts
// sqrt-price / tick helpers (exact integer math matching Uniswap's TickMath/SqrtPriceMath)
getSqrtRatioAtTick(tick: number): bigint
getTickAtSqrtRatio(sqrtPriceX96: bigint): number
sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number
priceToSqrtPriceX96(price: number, decimals0: number, decimals1: number): bigint

// swap simulation over any PoolState (fees included, rounding in the pool's favour like the contracts)
simulateSwapExactIn(state: PoolState, direction: SwapDirection, amountIn: bigint): SwapResult
simulateSwapToPrice(state: PoolState, targetPrice: number /* human, token1 per token0 */, decimals: { decimals0: number; decimals1: number }): SwapResult
//   direction is implied by whether targetPrice is above (oneForZero) or below (zeroForOne) the current price.
//   `decimals` (required) turns the human target into the pool's raw price for concentrated and constant-product
//   pools; stable pools carry their own decimals in the state and ignore the argument (like midPrice).

// metrics
computeDepth(state: PoolState, decimals0: number, decimals1: number, pcts?: readonly number[]): DepthLevel[]
depthToUsd(levels: DepthLevel[], token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null): DepthLevelUsd[]
computeEffectiveSpread(state: PoolState, token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null, notionalsUsd?: readonly number[]): SpreadPoint[]
computeConcentration(state: ConcentratedState, positions: Position[] | null, bandPct?: number): ConcentrationMetrics
computeConcentrationForReserves(state: ConstantProductState | StableSwapState): ConcentrationMetrics   // rangeHhi = 1, activeRangeShare = 1, owners null (or from LP token holders when provided later)
computePersistence(samples: Array<{ timestamp: number; depthUsd: number | null }>, windowHours: number, now: number): PersistenceMetrics
computeHealthScore(inputs: HealthInputs): HealthScore   // inputs: depth2UpUsd, depth2DownUsd, spread10kBps, ownerTop1Share, rangeHhi, persistence
rateDepth(upUsd: number | null, downUsd: number | null): { rated: boolean; unratedReason: UnratedReason | null }
feasibleSpreadBps(point: SpreadPoint | undefined, mid: number): number | null // a stored point under today's cap
computeGap(volume24hUsd: number | null, depth2Usd: number | null): GapMetrics
volumeWindow(dataEndTs: number, hours?: number): VolumeWindow // [H − 24 h, H), H = start of the hour holding dataEndTs
scoringVolumeWindow(dataEndTs: number | null, now: number): VolumeWindow | null // null without a volume pass of the last 24 h
computeVolume24hUsd(window: VolumeWindow | null, coveredFromTs: number | null, buckets): number | null // 0 when covered and untraded
tvlUsd(reserve0: bigint, reserve1: bigint, token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null): number | null

// pricing (pure graph over observed pool prices)
derivePrices(edges: PriceEdge[], anchors: Record<Address, number>): Map<Address, DerivedPrice>
//   Widest-path (max-bottleneck) search from the anchors (USDC = 1, other stables = 1) so that USD prices
//   come through the deepest route. Tokens unreachable from any anchor are absent. The CLI weighs each pool edge
//   by the thinner side of its ±2 % depth (apps/cli/src/pipeline/prices.ts), so a one-sided pool is no route.

// Uniswap v4 fees (swap/protocolFee.ts)
decodeV4ProtocolFee(packed: number): ProtocolFeePips // low 12 bits zeroForOne, high 12 bits oneForZero
v4SwapFeePips(protocolFeePips: number, lpFeePips: number): number
swapFeePips(state: ConcentratedState, direction: SwapDirection): number // what the swap walk charges

// test helpers (exported from core for other packages' tests)
buildConcentratedState(opts: { positions: Array<{tickLower, tickUpper, liquidity}>; tick; feePips; tickSpacing; blockNumber?; timestamp? }): ConcentratedState
```

### Concentrated-liquidity swap walk (must match Uniswap v3 semantics)

- Fee is taken from amountIn before the price move (`amountInLessFee = amountIn * (1e6 − fee) / 1e6`), with `fee` the
  direction's swap fee: `feePips`, or on Uniswap v4 `swapFeePips(state, direction)` (LP fee combined with the protocol fee).
- Within a tick range with liquidity L, moving from √Pa to √Pb (Q64.96):
  Δtoken1 = L · (√Pb − √Pa) / 2^96 (round up for input), Δtoken0 = L · (√Pb − √Pa) · 2^96 / (√Pa · √Pb) (round up for input, down for output).
- At an initialized tick crossing, apply `liquidityNet` (add when moving up, subtract when moving down).
- Steps stop where the contract's do: at the next initialized tick _or_ the edge of the current tick-bitmap
  word (256 × tickSpacing ticks, `TickBitmap.nextInitializedTickWithinOneWord`), whichever comes first. A word
  edge is an uninitialized stop that runs `computeSwapStep` again; since every step rounds on its own, skipping
  it would differ from on-chain amounts by a few wei.
- A 100 % fee (Uniswap v4 `MAX_LP_FEE = 1_000_000`) is valid: exact-in turns the whole input into fee without
  moving the price (v4 `SwapMath`); swap-to-price reports `complete = false` with zero amounts.
- Walk stops at the target price, when amountIn is exhausted, when liquidity hits 0 with no further ticks inside
  the known bounds, or at the bound; `complete` is false in the last two cases.
- Ticks beyond `tickLowerBound`/`tickUpperBound` are unknown: never extrapolate.

### Constant product (Aerodrome v2 volatile)

`amountOut = reserveOut · amountInAfterFee / (reserveIn + amountInAfterFee)`.
Depth to price target: solve for amountIn that moves the marginal price `reserve1/reserve0` to the target (closed form).

### Stable swap (Aerodrome v2 stable)

Invariant `k = x³y + xy³` on 1e18-normalised reserves; `getAmountOut` solves y numerically with Newton
iterations exactly like the contract's `_get_y` (converging to 1 wei of normalised units). Depth to a price
target is an exact bisection over the gross amountIn on the analytic marginal price `dy/dx` of the post-trade
reserves: the result is the smallest input (to 1 wei of the input token) whose post-trade price passes the
target. Where the contract would revert (`_get_y` non-convergence, or reserves so small that `_d` floors to 0,
as in a drained pool) the simulators return `complete = false` with zero amounts instead of throwing.

### Metric definitions (mirrored in docs/METRICS.md)

- **Depth at ±p %**: up = `simulateSwapToPrice(state, mid·(1+p/100), decimals)` with input token1; down = `simulateSwapToPrice(state, mid·(1−p/100), decimals)` with input token0. USD = amountIn × token USD price.
- **Effective spread at N USD**: buy token0 with N USD of token1 (`exactIn oneForZero`), sell N USD of token0 (`exactIn zeroForOne`); `buyAvg = amount1In/amount0Out`, `sellAvg = amount1Out/amount0In` (human prices); `spreadBps = (buyAvg − sellAvg)/mid × 1e4`. Infeasible (null) if either leg is incomplete, either leg yields nothing (`amount0Out = 0` or `amount1Out = 0`), a USD price is missing, or either leg's average price is more than `SPREAD_MAX_LEG_IMPACT_BPS = 5 000` bps (50 %) from mid (`buyAvg/mid − 1`, `1 − sellAvg/mid`): constant-product and stable legs never run out of liquidity, so completeness alone let a dust pool publish 1e24 bps. A feasible spread is at most 10 000 bps.
- **Range HHI**: inside the band [mid·(1−5 %), mid·(1+5 %)] split liquidity into tick ranges between consecutive initialised ticks; weight each range by `L_range × (√Pupper − √Plower)` (≈ token1 value of the range) clipped to the band; `rangeHhi = Σ share²`; `activeRangeShare` = share of the range containing the current tick.
- **Owner concentration**: for each position overlapping the band, weight = `liquidity × clipped (√Pupper − √Plower)`; aggregate by owner; `top1Share`, `top3Share`, `hhi`, `count` (owners with weight > 0).
- **Persistence (window W hours)**: samples = snapshots in the window with non-null depth2Usd; `stability = clamp(p10/median, 0, 1)`; `uptime = share of samples ≥ 0.5·median`. Both null when samples < 3 or the oldest and newest sample are less than `PERSISTENCE_MIN_COVERAGE = 25 %` of the window apart (6 h of 24 h, 42 h of 7 d); with ≥ 3 samples and a median of 0 both are 0 (a dead pool).
- **Rating**: a pool is _rated_ when both ±2 % sides (`depthUsd[pct = 2].upUsd`, `.downUsd`) are known and the thinner one is at least `HEALTH_RATING_MIN_SIDE_USD = 5 000`; otherwise `grade = null` and `unratedReason` is `unpriced` (a side unknown), `one-sided` (the deeper side holds the floor, the thinner does not) or `thin`. The total and components of an unrated pool are still published.
- **Health score** (0–100):
  - depth (max 35): `35 · clamp((log10(2 · min(up, down)) − 3) / 3, 0, 1)` → balanced-equivalent $1k = 0, $1M = 35; a one-sided pool scores 0. An unknown side → 0.
  - spread (max 25): `25 · clamp((log10(300) − log10(spread10kBps)) / (log10(300) − log10(10)), 0, 1)` → ≤10 bps = 25, ≥300 bps = 0. Null (infeasible at $10k) → 0.
  - concentration (max 20): if owners known `20 · (1 − top1Share)`, else `20 · (1 − rangeHhi)`; both null → 10 with note.
  - persistence (max 20): `20 · (0.5·stability + 0.5·uptime)`; null → 10 with note "persistence neutral: fewer than 3 samples" (or "…: samples cover under 25 % of the window").
  - grade (rated pools only): A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F.
  - `medianHealth` (stats, Home) is the median of `health.total` over rated pools; `rated` counts them next to `scored`.
- **Gap score**: `turnover = volume24hUsd / depth2Usd`; `gapScore = 100 · clamp(log10(turnover) / 2, 0, 1)` (turnover 1× → 0, 100× → 100). Null if volume or depth unknown or depth = 0. The feed lists pools with `volume24hUsd ≥ 10 000` sorted by gapScore desc.

## Chain adapters (packages/chain)

```ts
export interface ChainAddresses {
  /* see src/addresses.ts: factories, managers, lens, reference tokens */
}
export interface PoolOverview {
  pool: PoolMeta
  blockNumber: bigint
  sqrtPriceX96: bigint | null
  tick: number | null
  liquidity: bigint | null // concentrated
  reserve0: bigint
  reserve1: bigint // token balances for TVL (v4: not available cheaply → 0n, use liquidity)
}
export interface ChainReader {
  readonly chainId: 8453
  getLatestBlock(): Promise<{ number: bigint; timestamp: number }>
  getBlockTimestamp(blockNumber: bigint): Promise<number>
  discoverPools(dex: Dex, fromBlock: bigint, toBlock: bigint): Promise<PoolMeta[]> // paginates getLogs in chunks (default 10 000 blocks), resolves token metadata (cached), symbol fallback for bytes32/missing
  seedPools(opts?: SeedPoolsOptions): Promise<SeedResult> // no logs: factory / StateView views for every pair of the reference tokens at one block (default latest), creation blocks by binary search over archive state (eth_getCode; v4: PoolManager extsload of slot0); same PoolMeta as discoverPools. opts: { dexes, tokens, blockNumber, knownCreatedAt(poolId), concurrency (4), batchSize (50), onPools(pools, { done, total, requests }) per finished batch, onSearchRound, onRetry }; 429 / transient probes back off with the logRetry policy; result: { blockNumber, pools, dexes: [{ dex, candidates, found, searched }], searchRequests, searchRounds }
  readTokens(addresses: Address[]): Promise<TokenInfo[]>
  readOverview(pools: PoolMeta[], blockNumber?: bigint): Promise<PoolOverview[]> // multicall-batched (≤ 500 calls per multicall)
  readState(pool: PoolMeta, opts: { bandPct: number; blockNumber?: bigint }): Promise<PoolState> // tick walk via tickBitmap words ± enough to cover bandPct·2 (at least ±10 %), ticks() per initialised tick, all multicall-batched
  readPositions(pool: PoolMeta, opts: { fromBlock: bigint; toBlock: bigint }): Promise<Position[]> // v3/Slipstream: NFPM IncreaseLiquidity/DecreaseLiquidity/Transfer + positions(); v4: PositionManager; aerodrome-v2: []
  readSwaps(
    pools: PoolMeta[],
    fromBlock: bigint,
    toBlock: bigint,
    opts?: { onProgress(p: SwapScanProgress) },
  ): Promise<SwapEvent[]> // one log scan per Swap event source (Uniswap v3 + Slipstream share one filter: same event, swapScanOf); timestamps interpolated between anchor headers every timestampSpan blocks (default 10 000), independent of logChunkSize; onProgress after each chunk / backoff: { scans, blocksDone, blocksTotal, chunks, rateLimited, transient }
}
export function createChainReader(opts: {
  rpcUrl?: string // every read but eth_getLogs (default https://mainnet.base.org)
  transport?: Transport // wins over rpcUrl
  logsRpcUrl?: string // eth_getLogs only (default: rpcUrl, or transport when given)
  logsTransport?: Transport // wins over logsRpcUrl
  addresses?: Partial<ChainAddresses>
  logChunkSize?: number | bigint // blocks per eth_getLogs (default 10 000)
  minLogRange?: number | bigint // rejected ranges are split down to min(minLogRange, logChunkSize), default 100
  logRetry?: Partial<LogRetryPolicy> // { retries: 8, baseDelayMs: 1 000, maxDelayMs: 30 000, sleep, onRetry }: the one backoff of every 429 / transient request (eth_getLogs, multicalls, blocks, eth_getCode); onRetry hears eth_getLogs
  onCallRetry?: (event: BackoffEvent) => void // each backoff of a main-endpoint request; the rpcUrl transport has no viem retries
  maxCallsPerMulticall?: number
  timestampSpan?: number | bigint
}): ChainReader
// A logs endpoint that cannot serve logChunkSize (stated maximum or halving below the floor) throws
// LogRangeLimitError { details: { reason: 'stated' | 'floor', maxRange, chunkSize, minRange, fromBlock, toBlock, providerMessage } }
// A rate-limited / transient request (429, timeout, no answer, gateway 408 / 5xx) still failing after logRetry.retries throws
// RetryExhaustedError { what, kind: 'rate-limit' | 'transient', retries, providerMessage, cause }: final, never retried again or split
export function redactUrls(text: string): string // every http(s) / ws(s) URL cut to its origin (RPC URLs carry API keys)
export function errorSummary(error: unknown): string // one line for logs: causes joined, viem errors as status / code / URL origin / method / details, never the request body
export function createFixtureTransport(fixture: Fixture): Transport // deterministic JSON-RPC answers keyed by method+params for tests/demo
export function createRecordingTransport(inner: Transport, sink: Fixture): Transport // records live answers into a fixture (used to produce demo fixtures from a real RPC)
export function createFakeRpcFetch(fixture: Fixture, opts?: FakeRpcOptions): FakeRpc // { fetch, calls }: a fixture behind viem's real http() transport; replays provider HTTP errors in tests
```

Protocol specifics (addresses live in `src/addresses.ts`, overridable via `createChainReader({ addresses })`):
- Uniswap v3: factory `PoolCreated`, pool `slot0/liquidity/tickBitmap/ticks/fee/tickSpacing`, `Swap`. Position owners via NonfungiblePositionManager.
- Uniswap v4: PoolManager `Initialize` (poolId, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick); state via StateView (`getSlot0`, `getLiquidity`, `getTickBitmap`, `getTickInfo`); `Swap` on PoolManager carries `id`; currency0 == 0x0 is native ETH (TokenInfo symbol `ETH`, 18 decimals).
- Aerodrome v2: PoolFactory `PoolCreated(token0, token1, stable, pool, length)`; `getReserves`, `stable()`, fee from `PoolFactory.getFee(pool, stable)` (bps); `Swap` event.
- Aerodrome Slipstream: CLFactory `PoolCreated(token0, token1, tickSpacing, pool)`; same tick interface as v3 but `ticks()` returns a different struct (ABI in docs/research/base-contracts.md); fee via `fee()`.

## Storage (packages/db)

`node:sqlite` (`DatabaseSync`). `openDatabase(path | ':memory:')` runs migrations. Tables:
- `tokens(address PK, symbol, name, decimals)`
- `pools(id PK, dex, kind, address, pool_id, token0, token1, fee_pips, tick_spacing, stable, hooks, created_at_block, tracked INTEGER, first_seen_at)`
- `snapshots(id PK AUTOINCREMENT, pool_id, block_number, timestamp, price, token0_usd, token1_usd, tvl_usd, active_liquidity TEXT, depth_json, depth_usd_json, spreads_json, concentration_json)` + index `(pool_id, timestamp)`
- `volume_hourly(pool_id, hour_start, volume_token0 TEXT, volume_token1 TEXT, volume_usd, swap_count, PK(pool_id, hour_start))`
- `positions(pool_id, token_id TEXT, owner, tick_lower, tick_upper, liquidity TEXT, updated_block, PK(pool_id, token_id))`
- `prices(token PK, usd, via_json, updated_at)`
- `scores(pool_id PK, timestamp, health_json, gap_json, persistence_24h_json, persistence_7d_json, volume_24h_usd, depth2_usd, health_total, gap_score)`; `health_json.rated` is the rating flag (a row without one reads as unrated until `score` runs again)
- `sync_state(key PK, value)` (e.g. `discover:uniswap-v3:lastBlock`; `seed:<dex>:lastBlock` records the block of the last `discover --seed`; `volume:<pool>:lastBlock` / `volume:<pool>:fromTs` the volume coverage of a pool; `volume:lastBlock` / `volume:lastTs` the head of the last volume pass)

bigint columns are TEXT (decimal strings). JSON columns hold the core types with bigint → string.
Reads apply core's spread cap (`feasibleSpreadBps`): a snapshot stored before it comes back with the points whose legs are above `SPREAD_MAX_LEG_IMPACT_BPS` infeasible, and `SnapshotSummary.spread10kBps` is derived from the stored $10k point, never read from the denormalised `spread10k_bps` column.
Repositories expose typed methods (`pools.upsertMany`, `snapshots.insert`, `snapshots.latestForPool`, `snapshots.seriesForPool(poolId, fromTs)`,
`volume.upsertBuckets`, `volume.sumUsd(poolId, fromTs)`, `scores.upsert`, `scores.topBy('health'|'gap'|'depth'|'volume', limit, offset, filters)`…).
`@depthwatch/core` exports `serializeBigints`/`reviveBigints` helpers (JSON with `"123n"`-free decimal strings; key-based revival by schema, not by regex).

## API (apps/api)

`createApp(db, opts?: { staticDir?: string })` returns a Hono app. All responses JSON, bigints as decimal strings.
- `GET /api/health` → `{ ok, poolCount, trackedCount, latestSnapshotAt, latestBlock }`
- `GET /api/stats` → totals by dex: pools, tracked, scored, rated, depth2Usd sum, volume24hUsd sum, median health over rated pools
- `GET /api/pools?sort=health|depth|volume|gap|tvl&dir=asc|desc&dex=&q=&minVolume=&rated=true|false&limit=&offset=` → `{ items: PoolSummary[], total }` (sorting by health puts unrated pools last in both directions)
- `GET /api/pools/:id` → `{ pool, latest: PoolSnapshot, score: HealthScore, gap, persistence24h, persistence7d, volume24hUsd }`
- `GET /api/pools/:id/history?window=24h|7d` → `{ points: Array<{ timestamp, depth2Usd, spread10kBps, health, price }> }`
- `GET /api/gaps?limit=` → ranked gaps feed (volume ≥ $10k) with pool summary + gap metrics
- `GET /api/tokens/:address` → token info, USD price, pools containing it with latest depth
- `GET /AGENTS.md`, `GET /llms.txt`, `GET /openapi.json` → the documents for AI agents (usage guide, llms.txt index,
  hand-written OpenAPI 3.1 of the GET routes), written once in `apps/api/src/agentDocs/` and registered before the static
  fallback; the web build copies the files into `dist` unchanged and into `dist-static` with a generated static-site
  note.
- Static: when `staticDir` exists serve it with SPA fallback to `index.html`.

`PoolSummary = { pool: PoolMeta, price, tvlUsd, depth2Usd, depth2UpUsd, depth2DownUsd, spread10kBps, health: { total, grade, rated, unratedReason }, gapScore, volume24hUsd, ownerTop1Share, updatedAt }`
(`grade: HealthGrade | null`, `unratedReason: 'thin' | 'one-sided' | 'unpriced' | null`; `HealthScore` carries the same two fields).
`depth2UpUsd` / `depth2DownUsd` are the ±2 % level's `upUsd` (buy side) and `downUsd` (sell side) of the pool's newest
snapshot, read from the stored `depth_usd_json` as core computed them; each is `null` when its token has no USD price
(docs/METRICS.md) or the pool has no snapshot. They are listed, not sorted, so they are not denormalised columns.
Validation with zod; unknown pool → 404 JSON `{ error }`.

Scorecard responses (docs/design/scorecards.md §6) carry the mandate as core's `PublicMandate`, not as the stored
`Mandate`: `alertWebhookUrl` is replaced by the boolean `alertWebhookConfigured`. A webhook URL is a bearer secret (whoever
holds it can post through it), so it lives only in the database and is read by alert delivery and by the operator's own
CLI (`mm show` prints it masked to scheme and host); no `/api` response, no `export` bundle and no dashboard page contains
it, and `apps/api/src/routes/webhookSecret.test.ts` fails when any part of it shows up in a response body or header.

## CLI (apps/cli)

`depthwatch <command>` via `tsx` (`pnpm depthwatch …`). Env: `DEPTHWATCH_RPC_URL`, `DEPTHWATCH_LOGS_RPC_URL` (eth_getLogs only, default: `DEPTHWATCH_RPC_URL`), `DEPTHWATCH_LOG_CHUNK`, `DEPTHWATCH_DB`, `DEPTHWATCH_PORT`, `DEPTHWATCH_TOP_POOLS`.
- `discover [--dex …] [--from-block N]` — incremental factory log scan in windows of 50 log chunks; each window upserts its pools and advances sync_state in one transaction, so reruns resume.
  `--seed`: no logs; `ChainReader.seedPools` for the reference-token pairs, upsert, `seed:<dex>:lastBlock` = the seed block (log cursors untouched; pools already stored keep their creation block and are not searched again).
- `snapshot [--top N] [--pool id…]` — readOverview for all pools → derive prices → rank by TVL → readState for top N → compute depth/spread/concentration → insert snapshots; also rebuild `prices`.
- `volume [--hours 24]` — readSwaps for tracked pools, bucket hourly, USD via prices; incremental per pool (`volume:<pool>:lastBlock` / `volume:<pool>:fromTs`): a later pass starts at the hour that held the previous head and rewrites it, keeping earlier hours; pools without coverage of the window read all of it. Uniswap v3 and Slipstream pools share one log scan; progress (blocks and chunks done of the total, %, elapsed, ETA, backoffs) is logged every 30 s.
- `positions` — readPositions for tracked concentrated pools, upsert.
- `score` — for every tracked pool: persistence 24h/7d from snapshots, volume24h, health, gap → `scores`; rows of pools no longer tracked are deleted. volume24h sums the 24 whole hours before the hour of the last block `volume` read (`volume:lastTs`), via core `computeVolume24hUsd`.
- `run [--interval 300] [--once] [--with-positions] [--seed]` — loop: discover → [positions] → snapshot → volume → score (volume values swaps at the prices snapshot stored; score follows volume, whose head anchors the 24 h window); `--seed` seeds in the discover step.
- `serve` — API + dashboard (`apps/web/dist` if built).
- `demo` — seed an in-memory DB (or an empty / demo-seeded `--db` file; `DEPTHWATCH_DB` is ignored so the live DB is never touched) from the synthetic fixture set and `serve`. Must work with no network.

## Dashboard (apps/web)

Routes (docs/design/ia-v3.md §2): `/` (the answer, the depth butterfly, facts, gap and scorecard previews), `/pools`,
`/pools/:id` (mirrored depth curve, health, cost to trade, providers, over time, mandates), `/gaps`, `/tokens/:address`,
`/mm`, `/mm/:id`, `/methodology`. The visual and interaction spec is docs/design/visual-v3.md. Charts are hand-written
SVG and HTML: no chart library, because library defaults conflict with the chart rules and cannot draw the field of
light (visual-v3.md §7); the standard library and React cover them. Light and dark theme via `prefers-color-scheme`,
tokens on `:root` (`src/styles/tokens.css`), fonts self-hosted under `public/fonts`. Data via TanStack Query against
`/api`; the static build (`pnpm build:static`) reads an exported bundle on hash routes. `VITE_MOCK=1` serves from
in-repo mock JSON so the UI runs without a backend (the dev server also falls back to it when the API is down); a production
build contains no mock data and, when `/api/health` does not answer, shows "The data service is not answering." with a
"Try again" button instead of made-up pools (docs/design/web-v2.md §4). The bundle (`StaticBundle` in `apps/api/src/dto.ts`, mirrored in
`apps/web/src/api/types.ts`) carries an optional `note` from `depthwatch export --note <text>`. A static build of a
`live` bundle is a dated snapshot that does not update: the top line names Base mainnet and the snapshot's UTC time,
"About this snapshot" shows the note, and freshness and every other time are absolute, never "… ago"
(docs/design/web-v2.md §4).

## Testing

- core: unit tests against hand-computed values and property tests against a brute-force simulator
  (many tiny exact-in swaps vs one simulateSwapToPrice); TickMath checked against known Uniswap constants
  (`getSqrtRatioAtTick(0) = 2^96`, `MIN_TICK`/`MAX_TICK` ratios, `getSqrtRatioAtTick(887272) = 1461446703485210103287273052203988822378723970342`).
- chain: fixture transport with hand-built responses; ABI decoding round-trips via viem's `encodeFunctionResult`.
- db/api: in-memory SQLite; API tests through `app.request()`.
- cli: `demo` end-to-end against fixtures.
