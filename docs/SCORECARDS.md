# Market-maker scorecards

A project that pays a market maker for liquidity in a Base pool usually holds an agreement that
reads like "keep at least $50,000 of depth within ±2 % on each side, 95 % of the time, with a
spread no wider than 30 bps at $10,000". A scorecard is that agreement, measured. The project
registers a **mandate** (one pool, the market maker's addresses, the KPIs) and Depthwatch evaluates
it at every snapshot of the pool, with the same pool state and the same depth and spread code the
observatory uses, restricted to the liquidity those addresses own. The result is public: the
current values, uptime over 24 h / 7 d / 30 d, the worst excursions and every sample with its
block number, so any reading can be reproduced from public data.

This page defines every term. The design contract is [design/scorecards.md](design/scorecards.md);
the metric definitions the scorecard builds on are in [METRICS.md](METRICS.md). Implementation:
`packages/core/src/mm/` (pure), the holdings readers in `packages/chain`, three tables in
`packages/db`, `depthwatch mm …` and the sampling hook in `apps/cli`, the `/api/mm` routes in
`apps/api` and the `/mm` pages in `apps/web`.

## Definitions

### Mandate

A mandate is keyed to exactly one pool; several mandates may point at the same pool (two market
makers in one pool, or one agreement renegotiated under a new id).

| Field                    | Meaning                                                                                                                                                                                                                                                   | Default |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `id`                     | Slug, `^[a-z0-9][a-z0-9-]{2,39}$`; the scorecard URL and the badge URL are built from it                                                                                                                                                                  | —       |
| `name`                   | Display name of the agreement, at most 120 characters                                                                                                                                                                                                     | —       |
| `poolId`                 | A pool id as the observatory uses it: `<dex>:0x<pool address>` for `uniswap-v3`, `aerodrome-v2`, `aerodrome-slipstream`, `aero-v2` and `aero-slipstream`, `uniswap-v4:0x<poolId>` (64 hex digits) for Uniswap v4; any case is accepted, stored lowercase  | —       |
| `marketMaker`            | Display name of the market maker, at most 120 characters                                                                                                                                                                                                  | —       |
| `addresses`              | The market maker's onchain identities, lowercase, at least one and at most 50 (see [Attribution](#attribution))                                                                                                                                           | —       |
| `kpis.minDepthUsd`       | USD depth the market maker must provide on **each** side (price up and price down) at `±bandPct`                                                                                                                                                          | —       |
| `kpis.bandPct`           | Half-width of the band in percent                                                                                                                                                                                                                         | `2`     |
| `kpis.maxSpreadBps`      | Maximum effective spread, in bps, measured on the market maker's liquidity alone; `null` = no spread KPI                                                                                                                                                  | `null`  |
| `kpis.spreadNotionalUsd` | Round-trip notional at which the spread KPI is measured                                                                                                                                                                                                   | `10000` |
| `kpis.targetUptime`      | Agreed uptime share, 0..1. Informational: shown next to the measured uptime, never evaluated                                                                                                                                                              | `0.95`  |
| `alertWebhookUrl`        | `http(s)` URL at a public host that receives breach and recovery alerts (no user info, no `localhost`, loopback, private, link-local or carrier-grade NAT address; see [Alerts](#alerts)); `null` = no alerts. A secret: stored, never served (see below) | `null`  |
| `alertAfterSamples`      | Consecutive breached samples before a breach alert is sent                                                                                                                                                                                                | `3`     |
| `active`                 | Inactive mandates are kept, listed and served, but no longer sampled. A re-registration that leaves it out keeps the stored value                                                                                                                         | `true`  |
| `createdAt`              | Unix seconds. A re-registration that leaves it out keeps the stored value                                                                                                                                                                                 | now     |
| `notes`                  | Free text, at most 2,000 characters                                                                                                                                                                                                                       | `null`  |

Validation (`parseMandate` in core) reports every problem at once: the id pattern; non-empty
`name` and `marketMaker` of at most 120 characters each; a `poolId` of one of the six DEXes with
a 40-hex-digit pool address (64 hex digits for a Uniswap v4 pool id), in any case and stored
lowercase, so it matches the observatory's pool ids; one to 50 valid addresses (any case is
accepted, stored lowercase, duplicates dropped); `minDepthUsd > 0`; `0 < bandPct < 100`;
`maxSpreadBps` null or `> 0`; `spreadNotionalUsd > 0`; `0 < targetUptime ≤ 1`; `alertWebhookUrl`
null or an `http(s)` URL without user info at a public host (not `localhost` or a loopback,
private, link-local, carrier-grade NAT or unique-local IP literal; see [Alerts](#alerts));
`alertAfterSamples` an integer `≥ 1`; `notes` null or at most 2,000 characters. The limits are
core's `MANDATE_LIMITS`: every pass reads the holdings of every address, so a mandate stays small.
Unknown properties are ignored.

The webhook URL is a bearer secret: whoever holds it can post through it (a Slack or Discord
style URL carries its token in the path). It is kept in the database and read only by alert
delivery. Everything public shows the mandate as `PublicMandate`, with the boolean
`alertWebhookConfigured` instead of `alertWebhookUrl`: the API (`GET /api/mm`, `GET /api/mm/:id`
and the answer of `POST /api/mm`), the static export and the dashboard. The operator's CLI
`mm show` prints the URL masked to scheme and host (`https://hooks.example.com/…`); `mm list`
does not print it. The error of a failed delivery is recorded and logged with every URL cut to its
origin, like every error the CLI logs.

### Attribution

Attribution answers "which liquidity in this pool belongs to the market maker". It depends on the
DEX, because each one records ownership differently.

| DEX                  | What a project registers                                                                                                        | How holdings are found at sampling time                                                                                                                                                                                                                      | Method      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Uniswap v3           | Position owners as the NonfungiblePositionManager reports them (`ownerOf`)                                                      | The indexed positions of the pool (`depthwatch positions`) whose owner is one of the addresses                                                                                                                                                               | `positions` |
| Uniswap v4           | Position owners as the PositionManager reports them; for liquidity added by a hook or a vault contract, that contract's address | As for v3                                                                                                                                                                                                                                                    | `positions` |
| Aerodrome Slipstream | Position owners; for positions staked in the pool's `CLGauge`, the **depositor** (the gauge shows up as `ownerOf`, not the LP)  | Indexed positions whose owner is the pool's gauge (`CLPool.gauge()`) are resolved with `CLGauge.stakedContains(candidate, tokenId)` for each registered address and rewritten to the matching depositor (first match wins); then filtered by owner as for v3 | `positions` |
| Aerodrome v2         | LP-token holders; LP tokens staked in the pool's gauge count too                                                                | `balanceOf(address)` and `totalSupply()` on the pool (the LP token) and, when `Voter.gauges(pool)` is set, `Gauge.balanceOf(address)` for the staked part, all at the snapshot block                                                                         | `lp-share`  |
| Aero Slipstream      | As for Aerodrome Slipstream: position owners, and the depositor of a position staked in the pool's `CLGauge`                    | As for Aerodrome Slipstream: the gauge is `CLPool.gauge()` and answers `stakedContains(candidate, tokenId)`; positions come from Aero's own NonfungiblePositionManager                                                                                       | `positions` |
| Aero v2              | LP-token holders; LP tokens staked in the pool's gauge count too                                                                | As for Aerodrome v2, with the gauge read from Aero's FactoryRegistry, `targetToGauge(pool)` (none when it answers address(0)), never from a voter                                                                                                            | `lp-share`  |

Where the gauges live. On 2026-10-21 Aerodrome and Velodrome merged into Aero, which runs its own
factories and gauges on Base (docs/research/base-contracts.md, `## aero`). An Aerodrome v2 pool's
gauge is still whatever the Aerodrome Voter's `gauges(pool)` returns at the snapshot block: every
Aerodrome gauge has been dead since the kills at blocks 52,918,274–52,918,331 (§2.8), but a killed
gauge is still returned and LP still staked there still counts. An Aero v2 pool's gauge is the FactoryRegistry's
`targetToGauge(pool)`, because Aero's LeafVoter has none of the old Voter's pool views; a
Slipstream pool's, Aerodrome or Aero, is `CLPool.gauge()`. Liquidity that moved from an Aerodrome
pool to an Aero pool is in another pool with another id, so a market maker that moved registers a
new mandate for the Aero pool; the mandate on the Aerodrome pool keeps its history.

From the holdings, core builds a **market-maker-only pool state**:
- **Concentrated pools** (`buildMmConcentratedState`): a state that contains only the market
  maker's positions. Its ticks are rebuilt from the positions' `tickLower` / `tickUpper` liquidity
  deltas, its active liquidity is the sum of the liquidity of the positions straddling the current
  tick, and its `sqrtPriceX96`, tick, fee, tick spacing, known tick bounds and block are those of
  the whole pool. Depth on this state is "how far would the price move if only the market maker's
  positions were in the pool".
- **Reserve pools** (`buildMmReserveState`): the pool's reserves scaled by the market maker's
  share of the LP supply, `share = Σ(balance + staked) / totalSupply` as an exact fraction clamped
  to [0, 1] (`lpShare`). An LP supply of zero means no share and zero reserves.

Alongside, `shareOfPool` is the market maker's share of the pool's in-band liquidity weight:
`positionsBandWeight / poolBandWeight` with the same weighting as owner concentration in
METRICS.md (`liquidity × clipped (√Pupper − √Plower)`), clamped to 1; for reserve pools it is the
LP share. `holdings` counts the positions or LP holdings that were attributed.

A concentrated pool whose positions have never been indexed (no `positions` run has reached it)
cannot be attributed at all: its mandates are reported as attribution failures and get no sample
until a run publishes the positions, so a registration never records a false breach. `depthwatch
positions` indexes the pools of active mandates whether or not they are tracked yet; `depthwatch
run` indexes them before the snapshot of every pass (`--with-positions` extends that to every
tracked pool) and `depthwatch start` in the pass that finds such a mandate, so a registration
waits one pass at most. Once a pool is indexed and holds no positions at all, the method is
`none`: nothing can be attributed and the sample is a breach (rule 1 below).

A hooked pool is not modelled (METRICS.md, "Rated and unrated pools": a Uniswap v4 pool with a
hook, or an Aero Slipstream pool off the reviewed swap hook or charging each block's first swap an
initial fee; the hook runs its own swap code, so the swap walk would guess its depth and spread).
Its mandates are attribution failures (`hooked pool: not modelled`) at every pass and get no
sample, so they record no uptime, no breach and no alert, whatever the pool's positions.

### Measurement

Each sample carries an `MmAttribution`, computed with exactly the functions METRICS.md defines:

| Field                                | How                                                                                                                                                                                           |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `depthUpUsd`, `depthDownUsd`         | `computeDepth(mmState, decimals, [bandPct])` → `depthToUsd`: the ±`bandPct` depth of the market-maker-only state, USD per side. `null` on a side whose input token has no USD price           |
| `poolDepthUpUsd`, `poolDepthDownUsd` | The same on the whole pool, for context                                                                                                                                                       |
| `spreadBps`                          | `computeEffectiveSpread(mmState, …, [spreadNotionalUsd])`: the round-trip spread of the market maker's liquidity. `null` when infeasible (a leg cannot be filled, or costs 50 %+) or unpriced |
| `poolSpreadBps`                      | The same on the whole pool                                                                                                                                                                    |
| `method`, `holdings`, `shareOfPool`  | As defined under [Attribution](#attribution)                                                                                                                                                  |

Without holdings (`mmState` null) the market-maker depths are `0` on every priced side (not
`null`: zero liquidity is a measurement), `spreadBps` is `null` and `holdings` is `0`.

### Sample evaluation

`evaluateKpis(attr, kpis)` turns one attribution into `withinKpi` (`true`, `false` or `null`) and a
list of breaches (`depthUp`, `depthDown`, `spread`, `noLiquidity`). The rules, in order, as the
contract states them:
1. If `attr.method === 'none'` or `attr.holdings === 0` → breaches `['noLiquidity','depthUp','depthDown']`
   (+ `'spread'` when `maxSpreadBps !== null`), `withinKpi = false`.
2. If `depthUpUsd` or `depthDownUsd` is null (unpriced) → `withinKpi = null`, breaches `[]`
   (not evaluable; the sample is stored but excluded from uptime).
3. `depthUpUsd < minDepthUsd` → `'depthUp'`; `depthDownUsd < minDepthUsd` → `'depthDown'`.
4. `maxSpreadBps !== null` and (`spreadBps === null` or `spreadBps > maxSpreadBps`) → `'spread'`.
5. `withinKpi = breaches.length === 0`.

A sample is **evaluable** when `withinKpi` is not `null`. Unevaluable samples (a required USD
price was missing at that block) are kept with their attribution so the gap is visible, but they
count neither for nor against the market maker anywhere below.

### Uptime windows

`computeUptime(samples, windowHours, now)`: over the window `(now − windowHours·3600, now]`,
`samples` is the number of evaluable samples, `withinKpi` the number of them within KPI, and
`uptime = withinKpi / samples`, or `null` when there are no evaluable samples. The scorecard
reports three windows: `h24` (24 h), `d7` (168 h) and `d30` (720 h). `now` is the time of the
request, so a mandate whose pool stopped being snapshotted sees its windows empty out.

### Worst excursions

`worstExcursions(samples, kpis)`, over the evaluable samples of the summary (at most the last
30 days): the minimum `depthUpUsd`, the minimum `depthDownUsd` (a value of `0` counts) and, when
the mandate has a spread KPI, the maximum `spreadBps`, where a `null` spread is the worst possible
value and is reported as an excursion with `value: null`. Each excursion carries the sample's
`timestamp` and `blockNumber` and the `threshold` it is measured against (`minDepthUsd` or
`maxSpreadBps`). A side no sample measured, or the spread of a mandate without a spread KPI, is
`null`.

### Streak and status

`currentStreak(samples)` walks back from the newest evaluable sample while `withinKpi` stays the
same, skipping unevaluable samples: `breached` is the state of that run, `samples` its length and
`since` the timestamp of its oldest sample (`null` without evaluable samples, in which case the
streak is empty and not breached).

`scorecardStatus(mandate, latest, streak)`: an inactive mandate is `inactive`; no samples is
`no-data`; a latest sample with `withinKpi === false` is `breached`; otherwise `ok`. When the
latest sample is not evaluable, the current streak decides (`breached` while it is breached).

The full `ScorecardSummary` is `summarizeScorecard(mandate, samples, now)` over the mandate's
samples of the last 30 days: `{ mandate, latest, uptime: { h24, d7, d30 }, worst, streak, status }`.
On the wire its `mandate` is the public view (`alertWebhookConfigured` instead of
`alertWebhookUrl`, see [Mandate](#mandate)).

### Alerts

After the samples of a snapshot are stored, for each mandate that has a webhook:
- The streak is computed over the mandate's last `alertAfterSamples + 1` samples. A breached
  streak starts after the mandate's newest within-KPI sample; an alert belongs to the streak when
  it was recorded after that sample.
- **Breach:** the streak is breached, `streak.samples ≥ alertAfterSamples`, no `breach` of this
  streak has been delivered and fewer than `MAX_ALERT_ATTEMPTS` (5) breach attempts have been
  recorded for it. One delivered alert per streak, however long it lasts; an undelivered one is
  attempted again at the following samples of the streak, up to the cap.
- **Recovered:** the latest delivered alert is a `breach`, the mandate is now within KPI and fewer
  than `MAX_ALERT_ATTEMPTS` recovery attempts have been recorded since that breach. A recovery is
  never sent for a breach the recipient did not receive, and always owed for one it did: the
  retention prune keeps each mandate's newest delivered alert, however old.

The alert is a `POST` of a JSON body to `alertWebhookUrl` with a 5 s timeout; redirects are not
followed (a 3xx answer is a failed delivery) and the response body is discarded:

```json
{
  "event": "breach",
  "mandateId": "acme-weth-usdc",
  "name": "ACME / WETH-USDC 0.05 %",
  "poolId": "uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224",
  "timestamp": 1792000000,
  "blockNumber": "52000000",
  "streakSamples": 3,
  "breaches": ["depthDown"],
  "attribution": {
    "method": "positions",
    "holdings": 2,
    "shareOfPool": 0.183,
    "depthUpUsd": 61250.4,
    "depthDownUsd": 48310.9,
    "poolDepthUpUsd": 338400.2,
    "poolDepthDownUsd": 301275.6,
    "spreadBps": 24.6,
    "poolSpreadBps": 11.2
  },
  "scorecardUrl": "https://depthwatch.example/mm/acme-weth-usdc"
}
```

`event` is `breach` or `recovered`; `timestamp`, `blockNumber` (a decimal string, like every bigint
on the wire), `breaches` and `attribution` are those of the latest sample; `streakSamples` is the
length of the current streak; `scorecardUrl` is the scorecard page of this deployment,
`<DEPTHWATCH_PUBLIC_URL>/mm/<id>` (without that variable, `http://<host>:<port>` of `serve`). A
`recovered` event has `breaches: []`.

Every attempt is recorded in `mm_alerts` (`delivered`, the HTTP `responseStatus`, the `error`
message of a failed request) whether or not the webhook answered. Delivery never throws into the
pipeline: a failed attempt is recorded and tried again at the next sample that still calls for the
same event, at most `MAX_ALERT_ATTEMPTS` times per event (a breach per streak, a recovery per
delivered breach); after that, the next event (a recovery, or a new streak) produces the next
attempt. Delivery is a request from the indexer's own network, so the webhook must name a public
host: a URL with user info, or with `localhost` or a loopback, private, link-local, carrier-grade
NAT or unique-local IP literal as its host, is rejected at registration.

## Registration

### The registration JSON

The registration JSON is the mandate without `active` and `createdAt` (both optional; a new
mandate takes `true` and the registration time, a re-registration keeps the stored values).
Omitted KPI fields take their defaults.

```json
{
  "id": "acme-weth-usdc",
  "name": "ACME / WETH-USDC 0.05 %",
  "poolId": "uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224",
  "marketMaker": "Example Markets Ltd",
  "addresses": [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222"
  ],
  "kpis": {
    "minDepthUsd": 50000,
    "bandPct": 2,
    "maxSpreadBps": 30,
    "spreadNotionalUsd": 10000,
    "targetUptime": 0.95
  },
  "alertWebhookUrl": "https://hooks.example.com/depthwatch",
  "alertAfterSamples": 3,
  "notes": "Agreement of 2026-01-15, annex B. Addresses are the NFPM position owners."
}
```

The pool is the Uniswap v3 WETH/USDC 0.05 % pool on Base; the two addresses are placeholders. The
minimal registration is `id`, `name`, `poolId`, `marketMaker`, `addresses` and
`kpis.minDepthUsd`.

Registering an id that already exists replaces the mandate (an upsert); its samples and alerts are
kept, so KPIs can be corrected without losing history, and so are its `active` flag and its
`createdAt` unless the JSON sets them (core's `mergeRegistration`, which the CLI and the API both
apply): registering a deactivated mandate again from the same file keeps it deactivated, and
`"active": true` resumes sampling. Note that the stored samples were evaluated
against the KPIs in force at the time, while excursions and the dashboard's threshold lines and
targets use the current ones. The dashboard's pass / fail marks, like the status, follow the
latest sample's stored evaluation, so after a KPI change a mark can disagree with the target shown
next to it until the next sample.

### With the CLI

```sh
pnpm depthwatch mm register --file mandate.json   # validate, store, print the scorecard URL
pnpm depthwatch mm list                           # every mandate, active first
pnpm depthwatch mm show acme-weth-usdc            # the ScorecardSummary as JSON (webhook masked)
pnpm depthwatch mm deactivate acme-weth-usdc      # stop sampling; the scorecard stays served
pnpm depthwatch mm sample                         # re-run sampling for mandated pools now
```

`register` validates with `parseMandate` and prints every problem when the file is rejected (exit
code 1); on success it prints the scorecard URL, built from `DEPTHWATCH_PUBLIC_URL` (or
`--public-url`), else from `http://<host>:<port>` of `serve`. From the next `snapshot` on, the
pool is tracked whether or not it ranks in the top N. A pool the database does not know yet
(`depthwatch discover` has not seen it) is accepted with a warning; the snapshot skips the mandate
until the pool is discovered and the scorecard reads `no-data` meanwhile. A `poolId` that is not a
well-formed pool id is rejected like any other problem. `sample` reads the latest
block, the pool state and the stored positions, and inserts one sample per active mandate of each
mandated pool (a mandate already sampled at that block keeps the sample it has) without writing a snapshot row and without waiting for the next pipeline pass; it
needs `DEPTHWATCH_RPC_URL`. Exit codes follow the rest of the CLI: 0 ok, 1 error, 2 usage; a
`sample` whose every mandate failed stored nothing and exits 1, while a partial failure is a
warning per mandate and exit 0.

### With the API

`POST /api/mm` takes the same JSON (an existing id is replaced, its samples and alerts kept, and
its `active` flag and `createdAt` survive unless the body sets them) and `DELETE /api/mm/:id` removes a mandate
together with its stored samples and alerts (its scorecard stops being served; the response is
`{ id, deleted: true, samplesDeleted, alertsDeleted }`, 404 for an unknown id). Neither checks
that the pool has been discovered; like the CLI, a mandate on an unknown pool reads `no-data`
until `discover` finds the pool. Both require `Authorization: Bearer <DEPTHWATCH_ADMIN_TOKEN>`,
the environment variable `serve` and `demo` hand to the API. Without a configured token the
server answers `403 { "error": "registration disabled" }`; a missing or wrong token answers
`401`; a body over 64 KiB answers `413 { "error": "request body too large" }`; a registration
that fails validation answers `400` with the problems; success answers `201` with the scorecard
summary, whose mandate shows `alertWebhookConfigured` and never the webhook URL. The server logs
every request it answers (method, path without the query string, status, milliseconds) and a
warning for each `401`, naming whether the token was missing or wrong and the peer address; the
token itself is never logged.

```sh
curl -X POST "$DEPTHWATCH_URL/api/mm" \
  -H "Authorization: Bearer $DEPTHWATCH_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data @mandate.json
```

`depthwatch demo` registers two mandates before its pipeline runs, so the offline demo has a
scorecard that is `ok` (`demo-slipstream-weth-usdc`, a gauge-staked Slipstream position) and one
that is `breached` (`demo-aero-usdc-aero`, an Aerodrome v2 LP share below its `minDepthUsd`). The
dashboard's `VITE_MOCK=1` mode mirrors the same two.

## Reading a scorecard

### API

| Route                                                | Returns                                                                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/mm?pool=&active=`                          | `{ items: ScorecardSummary[] }`, active first, then by name; `pool` filters by pool id, `active` by `true` / `false`                              |
| `GET /api/mm/:id`                                    | `ScorecardSummary & { pool: PoolSummary \| null }`; `pool` is the observatory's row for the pool (null until it is scored); 404 for an unknown id |
| `GET /api/mm/:id/samples?window=24h\|7d\|30d&limit=` | `{ window, from, to, points: MmSample[] }`, ascending by time; default `7d`; `limit` (default and maximum 10 000) keeps the newest of the window  |
| `GET /api/mm/:id/badge.svg`                          | The SVG badge (see [Badge](#badge))                                                                                                               |
| `POST /api/mm`                                       | Register (see [With the API](#with-the-api))                                                                                                      |
| `DELETE /api/mm/:id`                                 | Remove a mandate; same authorization as `POST`                                                                                                    |

Summaries are computed from the samples of the last 30 days, so `uptime.d30` is the full history
the API keeps in view; samples older than 35 days and alerts older than 90 are deleted by
`depthwatch prune`, which `run` and `start` run once a day; each mandate's newest delivered alert
is kept whatever its age, so the alert rules below hold for a streak of any length. The server keeps the last summary per
mandate and serves it again until a new sample is stored, the mandate changes or a minute has
passed. Bigints (`blockNumber`) are decimal strings. A sample on the wire:

```json
{
  "mandateId": "acme-weth-usdc",
  "poolId": "uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224",
  "blockNumber": "52000000",
  "timestamp": 1792000000,
  "attribution": {
    "method": "positions",
    "holdings": 2,
    "shareOfPool": 0.183,
    "depthUpUsd": 61250.4,
    "depthDownUsd": 48310.9,
    "poolDepthUpUsd": 338400.2,
    "poolDepthDownUsd": 301275.6,
    "spreadBps": 24.6,
    "poolSpreadBps": 11.2
  },
  "withinKpi": false,
  "breaches": ["depthDown"]
}
```

Read against the example mandate: the up side ($61,250) clears `minDepthUsd` ($50,000), the down
side ($48,311) does not, the spread (24.6 bps) is inside `maxSpreadBps` (30), so the sample is a
`depthDown` breach. The pool as a whole is six times deeper than the market maker's share of it,
which is the distinction the scorecard exists to make.

### Dashboard

`/mm` lists every scorecard: name, pool, market maker, status, uptime over the three windows, the
market maker's depth per side against `minDepthUsd`, spread against `maxSpreadBps`, and the time
of the last sample. `/mm/:id` shows one scorecard: the KPIs with target and current value and a
pass / fail mark, the uptime tiles, a chart of the market maker's depth per side with the
`minDepthUsd` line (and the spread with its line when a spread KPI is set) over 24 h / 7 d / 30 d,
the worst excursions, the recent breaches and an embed block with the badge snippet.

### Badge

`GET /api/mm/:id/badge.svg` is a flat SVG badge reading `depthwatch | <status> · 7d <uptime>%`:
green for `ok`, red for `breached`, grey for `no-data` and `inactive`; the uptime reads `n/a`
while the 7 d window holds no evaluable sample. It is served as `image/svg+xml` with
`Cache-Control: public, max-age=300`, so a README or a docs page can embed it directly:

```html
<a href="https://depthwatch.example/mm/acme-weth-usdc">
  <img src="https://depthwatch.example/api/mm/acme-weth-usdc/badge.svg" alt="Depthwatch scorecard" />
</a>
```

```md
[![Depthwatch scorecard](https://depthwatch.example/api/mm/acme-weth-usdc/badge.svg)](https://depthwatch.example/mm/acme-weth-usdc)
```

The badge shows the status and the 7 d uptime only; the page it links to carries the numbers.

## Reproducing a sample by hand

Every sample names its block, and everything that produced it is public:
1. Read the pool state at that block (`readState`, or `slot0` / `liquidity` / `tickBitmap` /
   `ticks` directly; `getReserves` for Aerodrome v2 and Aero v2).
2. Find the market maker's holdings at that block: the position manager's positions owned by the
   addresses (for Slipstream, also the positions the pool's gauge holds for which
   `stakedContains(address, tokenId)` is true); for Aerodrome v2 and Aero v2, `balanceOf`,
   `Gauge.balanceOf` (the gauge from the Aerodrome Voter or Aero's FactoryRegistry) and
   `totalSupply`.
3. Build the market-maker-only state (`buildMmConcentratedState` or `buildMmReserveState`).
4. Run `computeDepth` at `bandPct` and `computeEffectiveSpread` at `spreadNotionalUsd` on it, in
   USD at the token prices the snapshot of that block recorded (`token0Usd`, `token1Usd`).
5. Apply the five evaluation rules.

The core functions take plain data and have no I/O, so steps 3 to 5 run in a test or a script
against the state read in steps 1 and 2.

## Limitations

- **Uniswap v4 liquidity added by hooks and vaults.** v4 positions are keyed by the address that
  modified liquidity. A market maker working through a vault or a hook contract shows up as that
  contract; register the contract's address, and be aware that the attribution then covers every
  user of the contract, not only the market maker.
- **Slipstream ALM wrappers.** Automated liquidity managers hold Slipstream NFTs on behalf of many
  depositors; the pool sees the wrapper as the owner. A market maker whose liquidity sits in a
  wrapper cannot be separated from the other depositors; registering the wrapper attributes all of
  it.
- **Positions minted outside the NonfungiblePositionManager.** v3-style pools accept liquidity
  from any contract that calls `mint`. Only positions held through the NFPM (and the v4
  PositionManager) are indexed; liquidity minted directly on the pool is invisible to attribution
  and counts for the whole pool only.
- **The position index lags the state.** Positions are indexed by `depthwatch positions` (`run`
  and `start` run it for mandated pools, see [Attribution](#attribution)), so a position changed
  between the last positions run and the snapshot block is attributed with its indexed liquidity,
  while the pool state is read at the snapshot block. A mandated concentrated pool whose positions are not indexed yet is not sampled (an
  attribution failure); once indexed, a pool without any position samples as `method: 'none'`,
  a breach by rule 1. Aerodrome v2 and Aero v2 holdings are read at the snapshot block and have no lag.
- **Band width.** The snapshot reads ticks for at least ±10 % around the price. A `bandPct` beyond
  the known tick range reports the depth up to the edge of what was read, not the full band.
- **USD prices.** Depth is measured in USD at the observatory's derived prices (a widest-path
  search over the pools, anchored at stables; see METRICS.md). A side whose token has no USD price
  is unevaluable rather than guessed, and a thin route can make the USD figure move with the route.
- **Sampling cadence.** A sample is taken at every snapshot of the pool, so uptime is a share of
  snapshots, not of blocks or of time; a 5-minute `run` interval gives about 288 samples a day.
  Whatever happens between two snapshots is not observed.
- **One evaluation per sample.** A sample is evaluated against the KPIs in force when it was
  taken; re-registering a mandate with different KPIs does not re-evaluate stored samples.
- **Not an accounting of fees or PnL.** The scorecard measures depth and spread provided; it says
  nothing about what the market maker earned or lost.

## Where each piece lives

| Piece                      | Module                                                | Function(s)                                                                                                               |
| -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Types and defaults         | `packages/core/src/mm/types.ts`                       | `Mandate`, `MandateKpis`, `MmAttribution`, `MmSample`, `ScorecardSummary`, `DEFAULT_MANDATE_KPIS`, `UPTIME_WINDOWS_HOURS` |
| Registration validation    | `packages/core/src/mm/mandate.ts`                     | `parseMandate`, `MandateValidationError`                                                                                  |
| Attribution                | `packages/core/src/mm/attribution.ts`                 | `filterPositionsByOwners`, `buildMmConcentratedState`, `buildMmReserveState`, `lpShare`, `computeMmAttribution`           |
| Sample evaluation          | `packages/core/src/mm/kpi.ts`                         | `evaluateKpis`                                                                                                            |
| Uptime, excursions, status | `packages/core/src/mm/scorecard.ts`                   | `computeUptime`, `worstExcursions`, `currentStreak`, `scorecardStatus`, `summarizeScorecard`                              |
| Holdings readers           | `packages/chain/src/reader.ts`                        | `readLpHoldings`, `resolveStakedOwners`                                                                                   |
| Storage                    | `packages/db` (`mandates`, `mm_samples`, `mm_alerts`) | repositories `mandates`, `mmSamples`, `mmAlerts`                                                                          |
| Sampling and alerts        | `apps/cli/src/pipeline/mm.ts`, `alerts.ts`            | `sampleMandates`, alert delivery after each snapshot                                                                      |
| Routes                     | `apps/api` (`/api/mm…`)                               | summaries, samples, badge, registration                                                                                   |
| Pages                      | `apps/web` (`/mm`, `/mm/:id`)                         | scorecard table, detail, embed block                                                                                      |
