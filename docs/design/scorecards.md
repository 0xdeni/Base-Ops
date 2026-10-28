# Market-maker scorecards (layer 2): design contract

Goal: a project registers a **mandate** (one pool, the market maker's addresses, the KPIs from
its agreement) and gets a live public **scorecard** computed from the same snapshots the
observatory already takes. The scorecard answers "is the market maker providing what it agreed
to" with numbers anyone can reproduce from public data.

Shared types are final in `packages/core/src/mm/types.ts` (read them first). Everything below
names packages, functions and routes that implementation agents must match.

## 1. Registration (`Mandate`)

- A mandate is identified by a slug `id` and is keyed to exactly one `poolId`. Several mandates
  may point at the same pool.
- `addresses` are the market maker's on-chain identities, lowercase, non-empty:
  - Uniswap v3 / v4 / Slipstream: position owners as reported by `readPositions` (NFPM /
    PositionManager `ownerOf`, or hook/vault contracts for v4 direct positions).
  - Slipstream: positions staked in the pool's `CLGauge` show the gauge as owner; the chain
    reader resolves them to the **depositor** (see §3) so the depositor address is what a
    project registers.
  - Aerodrome v2: LP-token holders; gauge-staked LP tokens count too (resolved via the Voter).
    Gauge-staked attribution (here and for Slipstream) reads the live Voter / `CLPool.gauge()`;
    the Voter killed its main gauges at block ~52,918,274 (docs/research/base-contracts.md §2.8).
- KPIs (`MandateKpis`): `minDepthUsd` on each side at `±bandPct`; optional `maxSpreadBps` at
  `spreadNotionalUsd`; `targetUptime` is informational. Defaults in `DEFAULT_MANDATE_KPIS`.
- Alerts: `alertWebhookUrl` (optional) and `alertAfterSamples` (default 3). The webhook URL is a bearer
  secret: it is stored and used for delivery only. Public views use `PublicMandate`
  (`toPublicMandate`: every field of `Mandate`, with `alertWebhookConfigured: boolean` in place of
  `alertWebhookUrl`), and `maskWebhookUrl` (scheme + host + `/…`) is what the operator's CLI prints.
- Validation lives in core: `parseMandate(input: unknown, now: number): Mandate` throws
  `MandateValidationError` listing every problem (id pattern, non-empty name/marketMaker/poolId,
  ≥ 1 valid lowercase address, `minDepthUsd > 0`, `0 < bandPct < 100`, `maxSpreadBps` null or > 0,
  `spreadNotionalUsd > 0`, `0 < targetUptime ≤ 1`, `alertWebhookUrl` null or http(s) URL,
  `alertAfterSamples` integer ≥ 1). Defaults are applied for omitted optional fields;
  `active` defaults to true, `createdAt` to `now`.
- Registration JSON (the file passed to the CLI and the body of `POST /api/mm`) is the
  `Mandate` shape minus `active`/`createdAt` (optional). Example in docs/SCORECARDS.md.

## 2. Attribution (core, pure)

`packages/core/src/mm/attribution.ts`:

```ts
filterPositionsByOwners(positions: readonly Position[], addresses: readonly Address[]): Position[]
// Concentrated: a state that contains ONLY the given positions (ticks rebuilt from their
// tickLower/tickUpper liquidity deltas, active liquidity = Σ liquidity of positions straddling
// state.tick, same sqrtPriceX96/tick/fee/tickSpacing/bounds/block as `state`).
buildMmConcentratedState(state: ConcentratedState, positions: readonly Position[]): ConcentratedState
// Reserve pools: reserves scaled by the market maker's share of LP supply (wallet + staked).
buildMmReserveState(state: ConstantProductState | StableSwapState, holdings: readonly LpHolding[]): ConstantProductState | StableSwapState
lpShare(holdings: readonly LpHolding[]): { num: bigint; den: bigint } | null   // Σ(balance+staked) / totalSupply; null when totalSupply = 0

// In-band liquidity weights with the SAME weighting as metrics/concentration.ts
// (liquidity × clipped (√Pupper − √Plower)); export the two helpers from concentration.ts:
poolBandWeight(state: ConcentratedState, band: SqrtBand): bigint
positionsBandWeight(positions: readonly Position[], band: SqrtBand): bigint

interface AttributionInput {
  token0: TokenInfo; token1: TokenInfo
  token0Usd: number | null; token1Usd: number | null
  state: PoolState                      // whole pool at the snapshot block
  mmState: PoolState | null             // market-maker-only state (null when no holdings)
  method: AttributionMethod; holdings: number
  shareOfPool: number | null
  kpis: MandateKpis
}
computeMmAttribution(input: AttributionInput): MmAttribution
//   depth: computeDepth(x, decimals, [kpis.bandPct]) → depthToUsd → up/down USD for mmState and state;
//   spread: computeEffectiveSpread(x, …, [kpis.spreadNotionalUsd])[0].spreadBps for both;
//   mmState null → depths 0 (not null) when the side is priced, spreadBps null, holdings 0.
```

`packages/core/src/mm/kpi.ts`:

```ts
evaluateKpis(attr: MmAttribution, kpis: MandateKpis): { withinKpi: boolean | null; breaches: BreachKind[] }
```

Rules, in order:
1. If `attr.method === 'none'` or `attr.holdings === 0` → breaches `['noLiquidity','depthUp','depthDown']`
   (+ `'spread'` when `maxSpreadBps !== null`), `withinKpi = false`.
2. If `depthUpUsd` or `depthDownUsd` is null (unpriced) → `withinKpi = null`, breaches `[]`
   (not evaluable; the sample is stored but excluded from uptime).
3. `depthUpUsd < minDepthUsd` → `'depthUp'`; `depthDownUsd < minDepthUsd` → `'depthDown'`.
4. `maxSpreadBps !== null` and (`spreadBps === null` or `spreadBps > maxSpreadBps`) → `'spread'`.
5. `withinKpi = breaches.length === 0`.

`packages/core/src/mm/scorecard.ts`:

```ts
computeUptime(samples: readonly Pick<MmSample,'timestamp'|'withinKpi'>[], windowHours: number, now: number): UptimeWindow
//   window = (now − windowHours·3600, now]; only withinKpi !== null samples count.
worstExcursions(samples: readonly MmSample[], kpis: MandateKpis): ScorecardSummary['worst']
//   over the given samples: min depthUpUsd, min depthDownUsd (value may be 0), max spreadBps
//   (null spread with a spread KPI counts as an excursion with value null); each with timestamp/block/threshold.
currentStreak(samples: readonly MmSample[] /* ascending */): BreachStreak
//   walks back from the newest evaluable sample while withinKpi stays equal.
scorecardStatus(mandate: Mandate, latest: MmSample | null, streak: BreachStreak): ScorecardStatus
//   inactive → 'inactive'; no samples → 'no-data'; latest.withinKpi === false → 'breached'; else 'ok'
summarizeScorecard(mandate: Mandate, samples: readonly MmSample[] /* ascending, ≤ 30 d */, now: number): ScorecardSummary
```

## 3. Chain additions (`packages/chain`)

Add to `ChainReader`:

```ts
// Aerodrome v2 only. Pool is the LP token: balanceOf(addr), totalSupply(); gauge = Voter.gauges(pool);
// when gauge ≠ 0x0: gauge.balanceOf(addr) → staked. Multicall-batched. Other DEX kinds → throws.
readLpHoldings(pool: PoolMeta, addresses: readonly Address[], blockNumber?: bigint): Promise<LpHolding[]>
// Slipstream only. For positions whose owner equals the pool's gauge (CLPool.gauge()), call
// CLGauge.stakedContains(candidate, tokenId) for each candidate; rewrite `owner` to the matching
// candidate (first match wins; log/ignore multiple). Other positions pass through unchanged.
// Non-Slipstream pools → returns positions unchanged.
resolveStakedOwners(pool: PoolMeta, positions: readonly Position[], candidates: readonly Address[], blockNumber?: bigint): Promise<Position[]>
```

ABIs to add (as const): Aerodrome `Voter.gauges(address) → address`; Aerodrome v2 `Gauge.balanceOf(address) → uint256`;
Slipstream `CLGauge.stakedContains(address depositor, uint256 tokenId) → bool`
(and `CLPool.gauge()` already exists). Document in `docs/research/base-contracts.md` only if
the ABI differs from the research notes; otherwise cite the notes in a code comment.

Synthetic world (`createSyntheticFixture`): give the two Aerodrome v2 pools LP supply with
`SYNTHETIC_OWNERS[0]` holding 40 % in wallet and 10 % staked (gauge registered in the Voter), and
stake the Slipstream pool's `[-300, 300]` position (owner index 1) in a CLGauge whose
`stakedContains(SYNTHETIC_OWNERS[1], tokenId)` is true, with the NFPM reporting the gauge as
`ownerOf`. Export the gauge addresses from the synthetic world so tests can assert on them.

## 4. Storage (`packages/db`)

New migration (append; bump `SCHEMA_VERSION`):
- `mandates(id TEXT PK, name, pool_id, market_maker, addresses_json, kpis_json, alert_webhook_url NULL, alert_after_samples INTEGER, active INTEGER, created_at INTEGER, notes NULL)` + index `(pool_id)`.
- `mm_samples(id INTEGER PK AUTOINCREMENT, mandate_id, pool_id, block_number TEXT, timestamp INTEGER, attribution_json, within_kpi INTEGER NULL, breaches_json)` + index `(mandate_id, timestamp)`; unique `(mandate_id, block_number)` since schema version 3 (one sample per mandate and block).
- `mm_alerts(id INTEGER PK AUTOINCREMENT, mandate_id, timestamp INTEGER, kind TEXT, streak_samples INTEGER, payload_json, delivered INTEGER, response_status INTEGER NULL, error TEXT NULL)` + index `(mandate_id, timestamp)`.

Repositories on `Database`: `mandates` (`upsert(m)`, `get(id)`, `list({ active?, poolId? })`,
`forPools(poolIds) → Map<poolId, Mandate[]>`, `setActive(id, active)`, `delete(id)`,
`count()`), `mmSamples` (`insertMany`: skips a sample already stored for its mandate and block and
returns the number stored, `seriesFor(mandateId, fromTs, toTs?)` ascending,
`latestFor(mandateId)`, `latestForMany(ids)`, `pruneBefore(ts)`, `countFor(mandateId)`),
`mmAlerts` (`insert`, `latestFor(mandateId)`, `listFor(mandateId, limit)`). bigints as TEXT,
JSON via core helpers (`attribution_json` holds `MmAttribution`, no bigints).

## 5. Pipeline (`apps/cli`)

- Mandated pools are always tracked: `snapshotStep` adds `db.mandates.list({ active: true })`
  pool ids to the explicit set (unknown ids are logged and skipped, not fatal).
- `apps/cli/src/pipeline/mm.ts`:

  ```ts
  sampleMandates(ctx, input: { pool: PoolMeta; state: PoolState; prices: PriceMap; positions: Position[] | null; blockNumber: bigint; timestamp: number }): Promise<MmSample[]>
  ```

  For each active mandate of the pool: concentrated → `positions` (from the db, as the snapshot
  uses) → `resolveStakedOwners` for Slipstream when any position owner equals the pool's gauge →
  `filterPositionsByOwners` → `buildMmConcentratedState`; aerodrome-v2 → `readLpHoldings` →
  `buildMmReserveState`; a concentrated pool whose positions are not published
  (`positions:<pool>:lastBlock` unset) → attribution failure, no sample; `positions === null` on
  an indexed pool → method `'none'`.
  Then `computeMmAttribution` → `evaluateKpis` → `MmSample`.
  Called from `snapshotStep` right after `buildSnapshot` for pools that have mandates; the samples
  are inserted in the same transaction as the snapshots. Attribution failures are logged per
  mandate and do not fail the snapshot.
- Alerts (`apps/cli/src/pipeline/alerts.ts`): after inserting samples, for each mandate with a
  webhook: compute `currentStreak` over the last `alertAfterSamples + 1` samples; when breached
  and `streak.samples ≥ alertAfterSamples` and the latest alert is not a `breach` for a streak
  starting at the same `since` → POST JSON `{ event: 'breach'|'recovered', mandateId, name, poolId,
  timestamp, blockNumber, streakSamples, breaches, attribution, scorecardUrl }` with a 5 s timeout
  (global fetch, injectable for tests); on recovery (latest alert is `breach`, now within KPI) →
  `recovered`. Record every attempt in `mm_alerts`; never throw.
- CLI commands (`depthwatch mm …`): `register --file <json>` (parseMandate → upsert; prints the
  scorecard URL), `list`, `show <id>` (summary as JSON, webhook URL masked), `deactivate <id>`, `sample` (re-run
  sampling for mandated pools against the latest block: readState + positions from db). Usage
  text and exit codes follow main.ts conventions.
- Demo: register two mandates before the pipeline runs: `demo-slipstream-weth-usdc` for
  `SYNTHETIC_OWNERS[1]` on the Slipstream pool with KPIs it meets (minDepthUsd below its depth,
  no spread KPI), and `demo-aero-usdc-aero` for `SYNTHETIC_OWNERS[0]` on the USDC/AERO v2 pool
  with `minDepthUsd` above what it provides so the scorecard shows a breach; no webhook.

## 6. API (`apps/api`)

DTOs in `dto.ts` (`Jsonified` of the core types):
- `ScorecardSummaryDto` is `Jsonified<PublicScorecardSummary>`: the summary with `mandate: PublicMandate`
  (`alertWebhookConfigured`, never `alertWebhookUrl`). No route, header or export contains any part of the
  webhook URL (`routes/webhookSecret.test.ts`).
- `GET /api/mm?pool=&active=` → `{ items: ScorecardSummaryDto[] }`, active first, then by name.
- `GET /api/mm/:id` → `ScorecardSummaryDto & { pool: PoolSummary | null }`; 404 unknown.
- `GET /api/mm/:id/samples?window=24h|7d|30d&limit=` → `{ window, from, to, points: MmSampleDto[] }` ascending (default 7d, limit max 10 000).
- `GET /api/mm/:id/badge.svg` → an SVG badge "depthwatch | <status> · 7d <uptime>%" (colours: ok green, breached red, no-data grey), `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=300`.
- `POST /api/mm` and `DELETE /api/mm/:id`: require `Authorization: Bearer <DEPTHWATCH_ADMIN_TOKEN>`
  (`createApp` opt `adminToken`); without a configured token respond 403 `{ error: 'registration disabled' }`;
  wrong token 401. POST validates with `parseMandate` (400 with the problems), upserts, returns 201 with the summary.
- Summaries use `mmSamples.seriesFor(id, now − 30 d)` and core `summarizeScorecard`. The app keeps the last summary per
  mandate (`ScorecardCache` in `scorecard.ts`, on `ApiContext`) and serves it again while the mandate (serialised), its
  newest sample id (`mmSamples.latestIdFor`) and the clock's minute are unchanged, so a list, a detail and a badge
  request do not each read a month of samples; `DELETE` drops the entry, a re-registration misses it by itself.

## 7. Dashboard (`apps/web`)

- Nav link "Scorecards" → `/mm`: table of scorecards (name, pool link, market maker, status chip,
  uptime 24h/7d/30d, MM depth up/down vs `minDepthUsd`, spread vs `maxSpreadBps`, last sample time).
- `/mm/:id`: header (name, market maker, pool link, status chip, addresses); KPI cards with target
  vs current and a pass/fail mark; uptime tiles; time-series chart (MM depth up/down with the
  `minDepthUsd` threshold line; spread with its threshold when set) over 24h/7d/30d; worst
  excursions; recent breaches; an "Embed" block with the badge `<img>` snippet and a preview.
- Mock mode: two scorecards mirroring the demo mandates. Types in `src/api/types.ts` mirror dto.ts.

## 8. Docs

- `docs/SCORECARDS.md`: definitions (attribution per DEX, sample evaluation rules verbatim from §2,
  uptime windows, excursions, streaks, alerts payload), registration JSON with a full example and
  the CLI/API ways to register, the badge, limitations (v4 vault/hook owners, Slipstream ALM
  wrappers, positions minted outside the NFPM).
- README: scorecards section, CLI table rows, API rows, `DEPTHWATCH_ADMIN_TOKEN`.
- `docs/ROADMAP.md`: mark the layer 2 weeks 5–8 engineering items delivered; onboarding items remain.
- `docs/ARCHITECTURE.md`: new tables, the sampling hook inside `snapshot`, alert delivery.

## 9. Tests

- core: attribution against hand-built pools (one MM position inside/outside/straddling the band;
  LP share scaling; shareOfPool equals the concentration weight ratio), KPI rules 1–5, uptime
  windows and the null exclusion, streaks, excursions, `parseMandate` errors and defaults.
- chain: `readLpHoldings` and `resolveStakedOwners` on fixtures (gauge and no-gauge cases).
- db: round-trips for all three tables, `forPools`, series bounds, prune.
- api: every route incl. auth, badge content type, 404/400/401/403.
- cli: `mm register/list/show/deactivate` and sampling inside the demo pipeline (both demo mandates
  produce samples; the Slipstream one is `ok`, the AERO one `breached`); webhook delivery against
  a local HTTP server (breach after N samples, recovered after one within-KPI sample, failure recorded).
- web: scorecard table and detail render mock data; badge snippet shows the right URL.
