# Depthwatch

An open liquidity observatory for Base mainnet. Depthwatch indexes every Uniswap v3, Uniswap v4 and
Aerodrome (v2 AMM and Slipstream concentrated) pool on Base and publishes, per pool, how much
capital it takes to move the price by 1, 2 and 5 percent in each direction, the effective spread a
trader pays on a $1k / $10k / $100k round trip with fees included, how concentrated the liquidity
is by tick range and by owner, how stable that depth has been over the last 24 hours and 7 days,
and a single 0–100 Liquidity Health Score, graded A–F for the pools deep enough to be rated (both
sides of the ±2 % depth known, the thinner holding at least $5,000; the others show "not rated" and
why). A "liquidity gaps" feed lists pools that have real
trading volume but thin depth. Price trackers show price and pool TVL; Depthwatch measures
executable depth, which is what market makers quote against and what protocol teams need when they
evaluate one. There is no token, no custody and no trading capital: it is indexing, analytics and a
dashboard, released under MIT.

The same snapshots feed **market-maker scorecards**: a project registers a mandate (one pool,
the market maker's addresses, the depth and spread KPIs from its agreement) and gets a public
scorecard with uptime over 24 h / 7 d / 30 d, computed from the liquidity those addresses own
and reproducible block by block. See [Market-maker scorecards](#market-maker-scorecards).

**Status: MVP under active development; not yet validated against Base mainnet at scale.** The
math is unit-tested against hand-computed values and a brute-force simulator, and the pipeline runs
end to end against recorded fixtures, but coverage of the long tail of pools, USD pricing of thinly
traded tokens and RPC cost at full scale are still being measured. Numbers from a live deployment
should be read with that in mind until the validation milestone in [docs/ROADMAP.md](docs/ROADMAP.md)
is reached.

## What it measures

Every metric is defined once, in [docs/METRICS.md](docs/METRICS.md), and implemented once, in
`packages/core`. Summary:

| Metric                 | Question it answers                                                       | Unit                                |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| Depth at ±1 / 2 / 5 %  | How much token1 (up) or token0 (down) moves the price by p %?             | raw token amounts and USD           |
| Effective spread       | What does a round trip of $1k / $10k / $100k cost, fees included?         | basis points                        |
| LP concentration       | Is in-band liquidity one range or many; how much does the top owner hold? | HHI 0..1, shares 0..1               |
| Liquidity persistence  | Over 24 h / 7 d, how much of the depth was there whenever we looked?      | stability 0..1, uptime 0..1         |
| Liquidity Health Score | 35 depth + 25 spread + 20 concentration + 20 persistence                  | 0–100; grade A–F if rated           |
| Gap score              | How large is 24 h volume relative to ±2 % depth?                          | 0–100 (turnover 1× → 0, 100× → 100) |
| TVL                    | Reserves at USD prices (lower bound when one side is unpriced)            | USD                                 |

Conventions that matter when reading the numbers: `price` is always token1 per token0, decimal
adjusted; fees are in pips (1e-6); the "up" side is buy pressure on token0 paid in token1 and the
"down" side is sell pressure paid in token0; USD prices come from a widest-path search over the
pools themselves, anchored at USDC and other stables, so a token with no deep route to a stable has
no USD price and its USD metrics are null rather than guessed.

## Screenshot

_Screenshot placeholder: the overview page (stats strip, top pools table sorted by health, gaps
feed) will be added here once the dashboard has run against mainnet data. Until then,
`pnpm depthwatch demo` serves the same UI from the synthetic fixture set._

## Quick start

Requirements: Node ≥ 22.13 (see `.nvmrc`) and pnpm 10 (`corepack enable` is enough).

```sh
pnpm install
cp .env.example .env        # set DEPTHWATCH_RPC_URL to a Base mainnet JSON-RPC endpoint

pnpm depthwatch discover    # incremental factory log scan; upserts pools, stores sync state
pnpm depthwatch snapshot    # overview of all pools, USD prices, TVL ranking, full depth for top N
pnpm depthwatch volume      # last 24 h of Swap events for tracked pools, hourly buckets in USD
pnpm depthwatch score       # persistence 24h/7d, health score and gap score per tracked pool
pnpm depthwatch serve       # REST API on :8787, plus the dashboard when apps/web/dist exists
```

The CLI reads `./.env` when it exists (variables already set in the environment win) and flags win
over both; `pnpm depthwatch --help` lists them. `discover`, `snapshot`, `volume`, `positions`,
`run` and `start` read the chain and refuse to start without `DEPTHWATCH_RPC_URL` (or
`--rpc-url`): one line on stderr, exit code 1. Exit codes are 0 ok, 1 error, 2 usage (unknown
command, flag or value). Logs go to stderr; stdout carries only program output: the `--help` and
`--version` text, the URL line of `serve`, `start` and `demo`, and the scorecard URL, listing and
JSON of `mm register`, `mm list` and `mm show`.

Or run the whole pipeline on a loop (`--once` runs a single pass, `--with-positions` adds the LP
position index to each pass):

```sh
pnpm depthwatch run --interval 300
```

Or, on a server, serve and keep the data fresh in one process (see
[Run it on a server](#run-it-on-a-server)):

```sh
pnpm depthwatch start
```

No RPC endpoint at hand? The demo runs the same pipeline over the synthetic fixture set into an
in-memory database and serves it. It makes no network calls and never opens `DEPTHWATCH_DB`, so
the live database from `.env` is safe; `--db <file>` keeps the synthetic world in a file instead,
provided the file is empty or was seeded by an earlier demo run:

```sh
pnpm depthwatch demo
```

Dashboard development runs separately from the API and proxies `/api` to port 8787:

```sh
pnpm --filter @depthwatch/web dev               # against a running `depthwatch serve`
VITE_MOCK=1 pnpm --filter @depthwatch/web dev   # against in-repo mock JSON, no backend
pnpm build                                      # builds apps/web/dist for `depthwatch serve`
```

The mock data is for development only: it is used with `VITE_MOCK=1`, or by the dev server when
`/api/health` does not answer. A production build (`pnpm build`) does not contain it. When the data
service does not answer, the dashboard shows "The data service is not answering." with a "Try
again" button that probes again, never made-up pools.

### Environment

Every variable but `DEPTHWATCH_ADMIN_TOKEN` and `DEPTHWATCH_SHUTDOWN_GRACE` has a flag with the
same meaning. Flags win over the environment, which wins over `./.env`. Durations take units
(`90s`, `30m`, `6h`, `1d`); a plain number is seconds.

| Variable                        | Flag                   | Default                | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPTHWATCH_RPC_URL`            | `--rpc-url`            | none (required)        | Base mainnet JSON-RPC over http(s) (WebSocket URLs are refused), required by the live commands. Error messages keep only a URL's origin, never its key. `.env.example` points at the public `https://mainnet.base.org`; a paid endpoint is advisable for full snapshots.                                                                                                                                                                    |
| `DEPTHWATCH_LOGS_RPC_URL`       | `--logs-rpc-url`       | `DEPTHWATCH_RPC_URL`   | Endpoint for `eth_getLogs` only (`discover`, `volume`, `positions`); everything else stays on `DEPTHWATCH_RPC_URL`. Unset, logs use the main endpoint. See [Running on a free RPC](#running-on-a-free-rpc).                                                                                                                                                                                                                                 |
| `DEPTHWATCH_DB`                 | `--db`                 | `depthwatch.db`        | SQLite file; created and migrated on first run. `demo` ignores it: in-memory unless `--db` is given.                                                                                                                                                                                                                                                                                                                                        |
| `DEPTHWATCH_PORT`               | `--port`               | `PORT`, else `8787`    | Port for `serve`, `start` and `demo`. Unset, the `PORT` a hosting platform sets is used.                                                                                                                                                                                                                                                                                                                                                    |
| `DEPTHWATCH_HOST`               | `--host`               | `0.0.0.0`              | Interface for `serve` and `demo`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DEPTHWATCH_TOP_POOLS`          | `--top`                | `200`                  | Pools (ranked by TVL) that get full depth snapshots.                                                                                                                                                                                                                                                                                                                                                                                        |
| `DEPTHWATCH_LOG_CHUNK`          | `--log-chunk`          | `2000`                 | Blocks per `eth_getLogs` request. Base's public RPC rejects larger spans; raise it on a provider that allows them, or set it to a capped plan's limit (10 on Alchemy's free tier) for small scans such as `volume`.                                                                                                                                                                                                                         |
| `DEPTHWATCH_LOG_LEVEL`          | `--log-level`          | `info`                 | `debug`, `info`, `warn`, `error` or `silent`; logs go to stderr.                                                                                                                                                                                                                                                                                                                                                                            |
| `DEPTHWATCH_PUBLIC_URL`         | `--public-url`         | `http://<host>:<port>` | Public base URL of the deployment: the scorecard link `mm register` prints and the `scorecardUrl` of webhook alerts are built from it.                                                                                                                                                                                                                                                                                                      |
| `DEPTHWATCH_ADMIN_TOKEN`        | —                      | unset                  | Bearer token that `POST /api/mm` and `DELETE /api/mm/:id` require (`serve`, `start` and `demo`), at least 32 characters (`openssl rand -hex 32`). A bearer secret: send it only over HTTPS, through a reverse proxy that terminates TLS and rate-limits ([docs/DEPLOY.md](docs/DEPLOY.md#a-reverse-proxy-with-tls)). Unset, those routes answer `403 registration disabled` and mandates are registered with `depthwatch mm register` only. |
| `DEPTHWATCH_SNAPSHOT_INTERVAL`  | `--snapshot-interval`  | `30m`                  | `start`: time between passes; each pass snapshots and scores.                                                                                                                                                                                                                                                                                                                                                                               |
| `DEPTHWATCH_VOLUME_INTERVAL`    | `--volume-interval`    | `1h`                   | `start`: time between volume runs.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DEPTHWATCH_POSITIONS_INTERVAL` | `--positions-interval` | `6h`                   | `start`: time between LP position runs; `off` disables them.                                                                                                                                                                                                                                                                                                                                                                                |
| `DEPTHWATCH_POSITIONS_BUDGET`   | `--positions-budget`   | `10m`                  | `start`: longest a positions run starts new work.                                                                                                                                                                                                                                                                                                                                                                                           |
| `DEPTHWATCH_DISCOVER_BUDGET`    | `--discover-budget`    | `15m`                  | `start`: longest factory-log discovery runs per pass; `off` leaves discovery to the seed.                                                                                                                                                                                                                                                                                                                                                   |
| `DEPTHWATCH_SHUTDOWN_GRACE`     | —                      | `8s`                   | `start`: how long SIGTERM waits for the step in flight before abandoning it.                                                                                                                                                                                                                                                                                                                                                                |

### Running on a free RPC

`eth_getLogs` is what free plans limit, and only `discover` (unless `--seed`), `volume` and
`positions` send it. `DEPTHWATCH_LOGS_RPC_URL` moves those requests to a second endpoint while
multicalls and block headers stay on `DEPTHWATCH_RPC_URL`; with one URL nothing changes.
- **Rate limits and gateway failures** (HTTP 429, e.g. Base's public endpoint above 5 requests
  per second per IP; a gateway's 5xx such as a 504 "upstream request timeout" or Cloudflare's 524;
  a timeout or no answer) are retried on the same range with exponential backoff, 1 s doubling to
  30 s, eight times at most (`Retry-After` wins), each logged as a warning. Then the request fails
  as an ordinary error: a `run` pass logs the failed step and goes on.
- **Range limits.** A logs endpoint that cannot serve the `DEPTHWATCH_LOG_CHUNK` span, such as
  Alchemy's free tier (10 blocks) against the default 2,000, stops the command after the first
  request of each log scan (one per DEX for `volume`; `positions` starts no further pool after
  the first refusal) with an error that names the provider's limit and the two fixes: set
  `DEPTHWATCH_LOGS_RPC_URL` to an endpoint that accepts larger ranges, or, for small scans, set
  `DEPTHWATCH_LOG_CHUNK` to the limit.
- **On a 10-block plan** (Alchemy's free tier), seed instead of scanning factory logs, then run
  the other steps as usual, `volume` at the plan's limit:

  ```sh
  depthwatch discover --seed              # pools of the reference tokens, no eth_getLogs
  depthwatch snapshot
  DEPTHWATCH_LOG_CHUNK=10 depthwatch volume
  depthwatch score
  ```

  or `DEPTHWATCH_LOG_CHUNK=10 depthwatch run --seed --once`. At 10 blocks per request, volume
  costs one `eth_getLogs` per 10 blocks per DEX: the first pass reads 24 h (about 18,000 requests,
  about 1.4 M compute units with four DEXes tracked; on Base in October 2026, with 200 pools
  tracked and about 265,000 swaps, it took 37 minutes, a fifth of the requests answered HTTP 429
  and retried with backoff). A later pass starts at the hour that held the previous pass's head,
  so it rereads up to an hour: about 100 requests per DEX five minutes after the last pass, about
  300 an hour after. Keeping volume current therefore reads every block at
  least once, at least about 17,300 requests (about 1.3 M units) a day with four DEXes, and a
  5-minute loop rereads so much that it costs about ten times that. A looping `run` does not fit a
  30 M-unit/month free plan: run single passes when you need fresh numbers (a month covers about
  20 daily ones).

  `discover --seed` asks each DEX's factory (StateView for Uniswap v4) for every pair of the
  reference tokens in `packages/chain/src/addresses.ts` and dates each new pool exactly by binary
  search over archive state, about 26 requests per pool, storing every 50 pools so an interrupted
  seed resumes. On Base in October 2026 that was 580 pools in 9.5 minutes and about 13,400
  requests (some 350,000 compute units), once; a rerun takes seconds. `positions` is unavailable
  on such a plan, and pools outside the reference-token pairs are only found by the log-based
  `discover`: both need a logs endpoint that takes 2,000-block spans, such as
  `https://mainnet.base.org` from a host with its own IP.
  `discover` saves its cursor every 50 chunks, so an interrupted scan resumes where it stopped;
  seeding never moves that cursor.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#rate-limits-range-limits-and-free-plans) has the
request counts.

### CLI commands

| Command                                                                                                                             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `discover [--dex <dex,…>] [--from-block N] [--seed]`                                                                                | Scan factory / PoolManager logs in chunks, upsert pools and advance the last block per DEX every 50 chunks, logging progress and ETA; a rerun resumes. `--seed` reads no logs: it asks each DEX for the pools of every reference-token pair, finds each new pool's creation block by binary search over archive state, upserts the pools and records `seed:<dex>:lastBlock`, leaving the log cursors alone.                                                                                                                                                                                                                                                                                                                 |
| `snapshot [--top N] [--pool <id>…]`                                                                                                 | Read every pool's overview, derive USD prices, rank by TVL, read tick state for the top N (plus every pool with an active mandate), compute depth, spread and concentration, insert snapshots, rebuild `prices`; sample every active mandate of a snapshotted pool and deliver alerts.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `volume [--hours 24]`                                                                                                               | Fetch Swap events for tracked pools, bucket per hour, value in USD. A later pass starts at the hour that held the previous pass's head (`volume:<pool>:lastBlock`), rewrites that hour and keeps the ones before it; a newly tracked pool, or a wider `--hours`, reads the whole window.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `positions`                                                                                                                         | Index LP positions (owners, ranges, liquidity) for tracked concentrated pools and concentrated pools with an active mandate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `score`                                                                                                                             | Persistence 24 h / 7 d from stored snapshots, 24 h volume, health score, gap score; scores of pools no longer tracked are deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `run [--interval 300] [--once] [--with-positions] [--seed]`                                                                         | Loop: discover → snapshot → volume → score. `--interval` takes seconds or a duration (`5m`); `--once` runs a single pass; `--with-positions` adds `positions` to each pass; `--seed` makes each pass's discover step seed instead of scanning logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `start [--snapshot-interval 30m] [--volume-interval 1h] [--positions-interval 6h] [--positions-budget 10m] [--discover-budget 15m]` | The server: API and dashboard as `serve` does, listening at once, plus the pipeline on a schedule in the same process. Each pass (every 30 min) snapshots and scores, runs volume hourly and positions every 6 h within a budget (at once for a mandate whose pool has no positions yet), and discovers from factory logs within a budget; on an empty database the first pass seeds first. Failing steps are logged and retried; every step logs its requests and estimated Alchemy compute units, and each day a total. An unwritable database is refused at start-up. SIGTERM stops the step in flight, which stores nothing more, and exits 0 within `DEPTHWATCH_SHUTDOWN_GRACE`. See [docs/DEPLOY.md](docs/DEPLOY.md). |
| `serve [--port N] [--host H]`                                                                                                       | API and dashboard (`apps/web/dist`, once `pnpm build` has run).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `demo [--port N] [--db <file>]`                                                                                                     | Seed an in-memory database (or an empty / demo-seeded `--db` file; `DEPTHWATCH_DB` is ignored) from the synthetic fixture set, register two demo mandates and serve; works offline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `export --out <file> [--demo] [--note <text>]`                                                                                      | Write the static dashboard bundle (JSON) of the database, read through the API; `pnpm --filter @depthwatch/web build:static` builds the site from `apps/web/static-data/bundle.json` (the root `pnpm build:static` re-exports the demo bundle over it first). `--demo` bundles the offline demo instead. A live bundle's site says it is a Base mainnet snapshot with its UTC time that does not update; `--note` adds the text of its “About this snapshot” popover.                                                                                                                                                                                                                                                       |
| `mm register --file <json>`                                                                                                         | Validate a registration JSON ([docs/SCORECARDS.md](docs/SCORECARDS.md)), store the mandate (an existing id is replaced, keeping its `active` flag and registration time unless the file sets them, and its samples and alerts), print its scorecard URL. The pool is tracked from the next `snapshot` on; a pool not discovered yet is a warning and is sampled once `discover` finds it.                                                                                                                                                                                                                                                                                                                                   |
| `mm list`                                                                                                                           | Every mandate with its status.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `mm show <id>`                                                                                                                      | The scorecard summary (status, uptime 24 h / 7 d / 30 d, worst excursions, current streak, latest sample) as JSON.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `mm deactivate <id>`                                                                                                                | Stop sampling a mandate; its scorecard stays served as `inactive`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `mm sample`                                                                                                                         | Sample every active mandate now against the latest block (pool state from the chain, positions from the database) without waiting for the next `snapshot`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

`--dex` takes `uniswap-v3`, `uniswap-v4`, `aerodrome-v2` or `aerodrome-slipstream` (repeatable or
comma-separated); `--pool` takes pool ids such as `uniswap-v3:0x…` (repeatable). The global flags
`--db`, `--rpc-url`, `--logs-rpc-url`, `--log-chunk`, `--log-level`, `--port`, `--host`, `--top`
and `--public-url` mirror the environment variables above. Ctrl-C finishes the current step and
shuts down cleanly; `start` stops the step in flight instead, so SIGTERM ends it within seconds.
`mm sample` is a live command like `snapshot`; the other `mm` commands only touch the database.

### Run it on a server

`depthwatch start` is the one command a server runs: the website and the API, listening at once,
and the pipeline on a schedule in the same process, against one SQLite file. Its defaults fit
Alchemy's free tier for `DEPTHWATCH_RPC_URL` with `eth_getLogs` on Base's public RPC
(`DEPTHWATCH_LOGS_RPC_URL=https://mainnet.base.org`) from a host with its own IP address.
[docs/DEPLOY.md](docs/DEPLOY.md) lists what the host needs, the settings and how to follow the
request budget in the logs; [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#running-as-a-service)
explains the schedule. The `Dockerfile` at the root packages that process as an image and
[deploy/compose.yaml](deploy/compose.yaml) runs it; the [Docker](docs/DEPLOY.md#docker) section
of docs/DEPLOY.md has the commands.

`serve`, `start` and `demo` listen on `0.0.0.0` unless `--host` says otherwise and log one
`request` line per request (method, path without the query string, status, milliseconds) and an
`admin request refused` warning for each `401` on `POST /api/mm` or `DELETE /api/mm/:id`, with the
reason and the peer address. The server does not terminate TLS or limit request rates: on a public
host it belongs behind a reverse proxy that does both, since `DEPTHWATCH_ADMIN_TOKEN` travels in
the `Authorization` header ([docs/DEPLOY.md](docs/DEPLOY.md#a-reverse-proxy-with-tls)).

## Architecture

A pnpm workspace with three library packages and three apps. The dependency direction is strict:
`core` has no dependencies and does no I/O; everything else builds on it.

| Path             | Package             | Responsibility                                                                                                            |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`  | `@depthwatch/core`  | Tick math, swap simulation for all three pool kinds, every metric, USD price graph. Pure.                                 |
| `packages/chain` | `@depthwatch/chain` | viem adapters for Base: discovery, overview, tick-bitmap state walks, positions, swaps; fixture and recording transports. |
| `packages/db`    | `@depthwatch/db`    | `node:sqlite` schema, migrations and typed repositories.                                                                  |
| `apps/api`       | `@depthwatch/api`   | Hono REST API with zod validation; serves the built dashboard.                                                            |
| `apps/web`       | `@depthwatch/web`   | Vite + React dashboard; talks only to `/api`.                                                                             |
| `apps/cli`       | `@depthwatch/cli`   | The `depthwatch` command: the pipeline above.                                                                             |

Data flows discover → overview → prices → rank → state → metrics → snapshots → volume → scores →
API → web. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes each step, the RPC cost model
(multicall batching, tick-bitmap walks, chunked `getLogs`), the storage model and how to add a DEX
adapter. [DESIGN.md](DESIGN.md) is the contract between packages.

## API

Responses are JSON (except the badge SVG and the agent documents); bigints are decimal strings.
Invalid query parameters return `400 { "error", "issues" }`; unknown pools or tokens return
`404 { "error" }`. Pool ids contain a colon (`uniswap-v3:0x…`, `uniswap-v4:0x<poolId>`) and may be
percent-encoded. Listings cover scored pools only; a pool that has been discovered but not
snapshotted and scored yet still answers on `/api/pools/:id` with `null` metrics. Responses are
gzip-compressed when the client accepts it and carry an `ETag` (`304` on a matching
`If-None-Match`); successful `GET /api/*` responses carry `Cache-Control: public, max-age=30`
(`/api/health`: none; the badge: `max-age=300`; a pool's history: `max-age=60`), the dashboard's hashed `/assets/*` files
`public, max-age=31536000, immutable` and `index.html` `no-cache`.

| Route                                                | Returns                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health?maxAge=`                            | `{ ok, poolCount, trackedCount, latestSnapshotAt, snapshotAgeSeconds, latestBlock, source }` (`snapshotAgeSeconds`: server clock minus `latestSnapshotAt`, `null` before the first snapshot; `source` is `demo` or `live`); `503 { ok: false, error }` when the database cannot be read or, with `maxAge` (seconds), when the newest snapshot is older than that or missing (`error: stale: …`, counts kept); `400` for an invalid `maxAge`                                      |
| `GET /api/stats`                                     | `{ byDex: [{ dex, pools, tracked, scored, rated, depth2Usd, volume24hUsd, medianHealth }], totals }`: per DEX and overall, the sum of ±2 % depth and of 24 h volume and the median health over rated pools (`null` when none is rated)                                                                                                                                                                                                                                           |
| `GET /api/pools`                                     | `{ items: PoolSummary[], total }`; query `sort=health\|depth\|volume\|gap\|tvl\|spread\|top` (default `health`; `spread` is `spread10kBps`, `top` is `ownerTop1Share`), `dir=asc\|desc` (default `desc`), `dex`, `q` (substring of a token symbol or address, pool address or v4 pool id), `minVolume` (USD), `rated=true\|false`, `limit` (default 50, max 200), `offset`                                                                                                       |
| `GET /api/pools/:id`                                 | `{ pool, tracked, latest, score, gap, persistence24h, persistence7d, volume24hUsd, scoredAt }`; `latest` is the newest snapshot; it and the score fields are `null` until the pool has been snapshotted and scored                                                                                                                                                                                                                                                               |
| `GET /api/pools/:id/history?window=24h\|7d`          | `{ window, from, to, points: [{ timestamp, price, depth2Usd, spread10kBps, tvlUsd, health }] }`; the window ends at the pool's newest snapshot; `Cache-Control: public, max-age=60`                                                                                                                                                                                                                                                                                              |
| `GET /api/gaps?limit=&offset=&minVolume=`            | `{ items: [{ pool: PoolSummary, gap: { volume24hUsd, depth2Usd, turnoverRatio, gapScore } }], total, meaningful, minVolumeUsd }`: pools with 24 h volume ≥ `minVolume` (default $10k) ranked by gap score; `total` counts the whole feed and `meaningful` its pools trading 3× their ±2 % depth or more, ignoring `limit` / `offset`                                                                                                                                             |
| `GET /api/tokens/:address`                           | `{ token, usd, via, priceUpdatedAt, pools: PoolSummary[], total, poolCount, depth2UsdTotal, depthKnownPools }`: USD price with the pool ids it was derived through (plus `wrap:weth` for the ETH ↔ WETH step), and the scored pools containing the token (`sort`, `dir`, `limit`, `offset` as for `/api/pools`; default deepest first); `depth2UsdTotal` sums the ±2 % depth of every scored pool of the token with a known depth (`depthKnownPools` of them), whatever the page |
| `GET /api/mm?pool=&active=`                          | `{ items: ScorecardSummary[] }`: one scorecard per registered mandate (mandate with `alertWebhookConfigured`, never the webhook URL; latest sample, uptime 24 h / 7 d / 30 d, worst excursions, current streak, status), active first then by name; `pool` filters by pool id, `active` by `true` / `false`                                                                                                                                                                      |
| `GET /api/mm/:id`                                    | `ScorecardSummary & { pool: PoolSummary \| null }`; 404 for an unknown id                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GET /api/mm/:id/samples?window=24h\|7d\|30d&limit=` | `{ window, from, to, points: MmSample[] }` ascending by time; default `7d`; `limit` (default and maximum 10 000) keeps the newest samples of the window                                                                                                                                                                                                                                                                                                                          |
| `GET /api/mm/:id/badge.svg`                          | SVG badge `depthwatch \| <status> · 7d <uptime>%` (green `ok`, red `breached`, grey `no-data` and `inactive`; `n/a` while the window has no evaluable sample); `image/svg+xml`, `Cache-Control: public, max-age=300`                                                                                                                                                                                                                                                             |
| `POST /api/mm`                                       | Register a mandate (body: the registration JSON; an existing id is replaced, its samples kept, and its `active` flag and registration time unless the body sets them); requires `Authorization: Bearer <DEPTHWATCH_ADMIN_TOKEN>`; 201 with the summary, 400 with the validation problems, 401 for a missing or wrong token, 403 `registration disabled` when no token is configured, 413 for a body over 64 KiB                                                                  |
| `DELETE /api/mm/:id`                                 | Remove a mandate together with its samples and alerts → `{ id, deleted, samplesDeleted, alertsDeleted }`; same authorization as `POST`; 404 for an unknown id                                                                                                                                                                                                                                                                                                                    |
| `GET /AGENTS.md`                                     | Guide for AI agents using the API (conventions and units, every GET route, curl examples, how to pick a pool for a trade); `text/markdown; charset=utf-8`                                                                                                                                                                                                                                                                                                                        |
| `GET /llms.txt`                                      | llms.txt index of the agent documents and the main routes; `text/plain; charset=utf-8`                                                                                                                                                                                                                                                                                                                                                                                           |
| `GET /openapi.json`                                  | Hand-written OpenAPI 3.1 description of every GET route and its response schema; `application/json`                                                                                                                                                                                                                                                                                                                                                                              |

`PoolSummary` is `{ pool, price, tvlUsd, depth2Usd, depth2UpUsd, depth2DownUsd, spread10kBps, health: { total, grade, rated, unratedReason }, gapScore, volume24hUsd, ownerTop1Share, updatedAt }`;
`depth2UpUsd` and `depth2DownUsd` are the buy and sell sides of the ±2 % depth from the newest snapshot (`null` for a
side whose token has no USD price). `health` is always present: `grade` is `null` and `rated` false for a pool whose
thinner ±2 % side holds under $5,000, with `unratedReason` `thin`, `one-sided` or `unpriced`; its `total` is kept. Every
other `null` means "not measured (yet)".

## For AI agents

Base presents itself as the chain for onchain trading, payments and agents; Depthwatch belongs
to the trading pillar, measuring the liquidity that trades on Base execute against.
- [AGENTS.md](AGENTS.md) at the repository root is for coding agents working on this repository:
  layout, commands, the conventions that bite, where Base contract addresses come from.
- Every running server (`depthwatch serve`, `depthwatch demo`) serves the documents for agents
  that use the API: [`/AGENTS.md`](apps/api/src/agentDocs/AGENTS.md) (conventions and units,
  every GET route, curl examples, how to pick a pool for a trade),
  [`/llms.txt`](apps/api/src/agentDocs/llms.txt) (an llms.txt index) and
  [`/openapi.json`](apps/api/src/agentDocs/openapi.json) (OpenAPI 3.1 of the GET routes). They
  are written once, in `apps/api/src/agentDocs/`; `pnpm build` and `pnpm build:static` ship the
  same files with the dashboard, the static copies with a note that the static site serves only
  the bundled JSON, not the API.

## Market-maker scorecards

A mandate names one pool, the market maker's addresses (position owners on Uniswap v3 / v4 and
Slipstream, gauge depositors for staked Slipstream positions, LP-token holders on Aerodrome v2,
staked LP tokens included) and the KPIs of the agreement: `minDepthUsd` on each side at
`±bandPct` (default 2 %), optionally `maxSpreadBps` at `spreadNotionalUsd` (default $10k), and an
informational `targetUptime`. Every snapshot of the pool yields one sample: the depth and spread
of a pool state that contains only the market maker's positions (or the reserves scaled by its LP
share), evaluated against the KPIs with the same core code as the pool metrics. A sample whose USD
price is missing is stored but not evaluated. The scorecard reports the latest sample, uptime
(share of evaluable samples within KPI) over 24 h, 7 d and 30 d, the worst excursions, the current
streak and a status (`ok`, `breached`, `no-data`, `inactive`); an optional webhook receives a
`breach` event once a breach has lasted `alertAfterSamples` samples (default 3) and a `recovered`
event afterwards. The webhook URL is a secret (whoever has it can post through it): it stays in
the database, and the API, the export and the dashboard say only whether one is set
(`alertWebhookConfigured`).

```sh
pnpm depthwatch mm register --file mandate.json   # prints http://…/mm/<id>
pnpm depthwatch mm show <id>                      # the summary as JSON (webhook URL masked)
```

The scorecard lives at `/mm/<id>` on the dashboard, `GET /api/mm/<id>` on the API, and
`GET /api/mm/<id>/badge.svg` is a badge for the project's own README. Registration over the API
(`POST /api/mm`) needs `DEPTHWATCH_ADMIN_TOKEN`. Definitions (attribution per DEX, the evaluation
rules, uptime, excursions, alerts), a full registration example, the webhook payload and the
limitations (v4 vault and hook owners, Slipstream ALM wrappers, positions minted outside the
position manager) are in [docs/SCORECARDS.md](docs/SCORECARDS.md). `pnpm depthwatch demo`
registers two demo mandates, one within KPI and one breached.

## Roadmap

Three layers, each only started once the previous one has users. Details, week-by-week milestones,
acceptance criteria and explicit non-goals are in [docs/ROADMAP.md](docs/ROADMAP.md).
1. **Observatory (this repository, weeks 1–4).** Index every Aerodrome and Uniswap v3/v4 pool on
   Base; depth, spread, concentration, persistence, health score, gaps feed; public API and
   dashboard; validated against mainnet.
2. **Market-maker scorecards (weeks 5–8; engineering delivered, see above).** A project registers
   its market maker's addresses and KPIs (minimum depth, maximum spread, target uptime) and gets a
   live public scorecard computed from the same data. Onboarding of the first projects is open.
3. **Mandate escrow (only once 1 and 2 have users).** On-chain market-making agreements whose fees
   release against verified KPIs.

Flashblocks (sub-block preconfirmations, live on Base mainnet since July 2025) are a roadmap item
for near-real-time depth.

## Contributing

`pnpm check` runs lint (Biome), typecheck and tests, the same as CI. Rules that are not
negotiable: no new dependencies without updating `DESIGN.md`, raw token amounts stay `bigint`,
tests never touch the network, and every metric is defined in `docs/METRICS.md` before it is
implemented. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
