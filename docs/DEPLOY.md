# Running Depthwatch on a server

A server runs one command, `depthwatch start`: one process that serves the website and the API
and keeps the data fresh on a schedule. This page lists what that process needs from its host and
how to follow it once it runs. [ARCHITECTURE.md](ARCHITECTURE.md#running-as-a-service) explains the
schedule and the budget arithmetic behind the defaults.

## What runs

```sh
pnpm install --frozen-lockfile
pnpm build                  # the dashboard (apps/web/dist), which start serves
pnpm depthwatch start       # website + API + the pipeline, until SIGTERM
```

- The server listens at once on `0.0.0.0`, port `DEPTHWATCH_PORT`, else the `PORT` a hosting
  platform sets, else 8787. It answers from the database as it is, empty at first; `GET
  /api/health` is the health check.
- The database must be writable by the process. `start` writes a probe row before it listens
  and exits 1 with `database is not writable: <path>` otherwise (a file restored as root and
  run as another user, a mount that refused the chown), so the host's restart policy or
  `docker ps` shows the problem instead of a healthy site whose every pass fails.
- The pipeline runs a pass every 30 minutes: snapshot and score every pass, volume every hour,
  LP positions every 6 hours, factory-log discovery for up to 15 minutes a pass, and once a day
  the retention prune ([Disk](#disk)). On an empty
  database the first pass seeds the pools of the reference tokens first, so the site shows data
  within minutes; full discovery from the factories' deployment blocks then completes over the
  following passes, in about half a day. A mandate registered on a pool whose LP positions are
  not indexed yet makes positions run in the next pass, whatever the cadence; its scorecard gets
  no sample before then (an attribution failure in the logs, never a false breach).
- A failing step is logged and tried again at its next slot; the site keeps serving. A volume or
  positions run that found no tracked pool yet (a failed first snapshot) is due again at the next
  pass.
- SIGTERM (or Ctrl-C) stops the step in flight, which stores nothing more (no partial snapshot
  enters the history), closes the database and exits 0 within 8 seconds. A host's stop timeout
  of 10 seconds (Docker's default) is enough.
- A restart resumes where the last run stopped: every step keeps its cursors in the database.

The same process ships as a Docker image ([Docker](#docker)). Either way, put a reverse proxy
with TLS in front ([A reverse proxy with TLS](#a-reverse-proxy-with-tls)) and back the database
up through SQLite ([Backups](#backups)).

## Docker

The `Dockerfile` at the repository root builds the server as an image: the dependencies are
installed and the dashboard is built inside the build, and the container runs `depthwatch start`
as the unprivileged `node` user with the database at `/data/depthwatch.db` (the image sets
`DEPTHWATCH_DB`). [deploy/compose.yaml](../deploy/compose.yaml) says the same as these commands:

```sh
docker build -t depthwatch .
docker run -d --name depthwatch --restart unless-stopped --stop-timeout 10 \
  --env-file .env -e DEPTHWATCH_DB=/data/depthwatch.db \
  -p 127.0.0.1:8787:8787 -v depthwatch-data:/data depthwatch
# or, with Compose, from the repository root:
docker compose -f deploy/compose.yaml up -d --build
```

- `--env-file .env` hands the container the [settings](#settings) below (`DEPTHWATCH_RPC_URL` at
  least); Docker reads the file, which never enters the image. `DEPTHWATCH_DB` stays at
  `/data/depthwatch.db` whatever the file says (`-e` wins over the file; Compose sets it under
  `environment`), and the entrypoint refuses a relative `DEPTHWATCH_DB` (exit code 2), which
  would point inside the image. The port inside the container is 8787 unless the file sets
  `DEPTHWATCH_PORT`, in which case `-p` (`ports:`) must map that port; a platform's `PORT` is
  honoured when the file does not set `DEPTHWATCH_PORT` (`.env.example` leaves it unset).
- `-p 127.0.0.1:8787:8787` publishes the port on the host's loopback only, for the reverse proxy
  of the next section. Docker publishes ports through its own iptables chain, which the host's
  firewall does not filter, so a port published without the address (on every interface) would
  expose the API, and the admin token's plain-HTTP routes, to the internet whatever `ufw` or
  `firewalld` allow. A proxy that runs as another container joins the Compose network instead
  and reaches `depthwatch:8787` directly, with no published port at all.
- `-v depthwatch-data:/data` keeps the database in a named volume that outlives the container.
  The entrypoint starts as root only to `chown` `/data` to the `node` user, then runs as that
  user for good (`setpriv` with no new privileges and an empty capability bounding set, so a
  compromised process cannot regain root through a setuid binary), so a bind mount
  (`-v /srv/depthwatch:/data`) should be a directory dedicated to Depthwatch: its files change
  owner. Under `--user node` (`user:` in Compose) the entrypoint skips the chown: the directory
  and its files must already belong to `node`, or `start` refuses the database.
- `--restart unless-stopped` brings the server back after a crash or a reboot. `--stop-timeout 10`
  (`stop_grace_period: 10s`, Docker's default) gives `docker stop` 10 seconds before SIGKILL,
  more than the 8 seconds of `DEPTHWATCH_SHUTDOWN_GRACE` the server takes at most to end the step
  in flight, close the database and exit 0.
- The image's health check asks `GET /api/health` every 30 seconds (after a 60-second start
  period; three failures in a row mark the container `unhealthy` in `docker ps`, and an
  orchestrator restarts it). A healthy container proves that the process is up and reads its
  database, not that the pipeline runs or that the data is fresh: `latestSnapshotAt` in that
  response and the `done` lines in the logs show that.
- The container's `depthwatch` entrypoint takes the other commands too, for the ones that only
  touch the database: `docker compose exec -u node depthwatch depthwatch mm list` (`docker exec
  -u node depthwatch depthwatch mm list` without Compose). `docker exec` defaults to root; `-u
  node` runs the command as the server's own user, so it never needs the root start-up path and
  creates no root-owned file in `/data`. Do not run the live commands (`snapshot`, `volume`,
  `mm sample`, …) beside `start`: it runs them on its schedule, and a second writer appends
  duplicate rows.

## A reverse proxy with TLS

Expose the server only through a reverse proxy that terminates TLS (Caddy, nginx, a platform's
load balancer). `DEPTHWATCH_ADMIN_TOKEN` is a bearer token: `POST /api/mm` and `DELETE
/api/mm/:id` send it in the `Authorization` header, which plain HTTP shows to everyone on the
path. The image's commands above publish the port on `127.0.0.1` for that reason: the proxy on
the host reaches `http://127.0.0.1:8787`, nothing else does. Set `DEPTHWATCH_PUBLIC_URL` to the
proxy's address so the links the server prints are the public ones.

## Settings

Everything is an environment variable (a `./.env` file in the working directory works too, see
[.env.example](../.env.example)). For Alchemy's free tier and Base's public RPC:

```sh
DEPTHWATCH_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>   # every read but eth_getLogs
DEPTHWATCH_LOGS_RPC_URL=https://mainnet.base.org                 # eth_getLogs only
DEPTHWATCH_DB=/var/lib/depthwatch/depthwatch.db                  # on a disk that survives restarts
DEPTHWATCH_PUBLIC_URL=https://depthwatch.example                 # the site's public address
```

The API key stays in the URL and the URL is never logged: error messages keep only its origin.
Keep `DEPTHWATCH_LOG_CHUNK` at its default of 2,000 blocks, what Base's public RPC accepts.

The schedule, with its defaults (durations take `90s`, `30m`, `6h`, `1d`; a plain number is
seconds):

| Variable                        | Default | What it sets                                                          |
| ------------------------------- | ------- | --------------------------------------------------------------------- |
| `DEPTHWATCH_SNAPSHOT_INTERVAL`  | `30m`   | Time between passes; each pass snapshots and scores.                  |
| `DEPTHWATCH_VOLUME_INTERVAL`    | `1h`    | Time between volume runs.                                             |
| `DEPTHWATCH_POSITIONS_INTERVAL` | `6h`    | Time between LP position runs; `off` disables them.                   |
| `DEPTHWATCH_POSITIONS_BUDGET`   | `10m`   | Longest a positions run starts new work.                              |
| `DEPTHWATCH_DISCOVER_BUDGET`    | `15m`   | Longest factory-log discovery runs per pass; `off` keeps to the seed. |
| `DEPTHWATCH_SHUTDOWN_GRACE`     | `8s`    | How long SIGTERM waits for the step in flight.                        |

Each has a flag of the same name for `start` (`--snapshot-interval 1h`), except the grace period.
`DEPTHWATCH_TOP_POOLS` (default 200) is the other lever: snapshot cost grows with the pools
tracked. `DEPTHWATCH_KEEP_DAYS` (default 30) bounds the disk ([Disk](#disk)).

## The logs endpoint

`eth_getLogs` (discovery, volume, positions) goes to `DEPTHWATCH_LOGS_RPC_URL`, everything else to
`DEPTHWATCH_RPC_URL`. Alchemy's free tier serves log ranges of 10 blocks only, and keeping volume
current there would cost more than its monthly units, so the logs go elsewhere:
- **Base's public RPC**, `https://mainnet.base.org`, needs no sign-up and has no monthly quota. It
  accepts 2,000-block spans and allows about 5 requests a second per IP address, so the server
  needs its own outbound IP: on hosts whose traffic leaves from shared addresses, neighbours use up
  that limit and every request is answered HTTP 429. Base's documentation describes the public
  endpoint as not meant for production.
- **If the server's address gets HTTP 429** all the time (`eth_getLogs backoff reason=rate-limit`
  warnings that never stop), use a keyed endpoint that accepts at least 2,000-block ranges, or set
  `DEPTHWATCH_LOG_CHUNK` to the largest range it accepts (a provider capped at 1,000 blocks:
  `DEPTHWATCH_LOG_CHUNK=1000`). The first full discovery can still be run against the public RPC.

## Following it

Logs go to stderr, one line per event, which a host's log viewer shows as they come. Every step
ends with one `done` line: its duration, its result and the requests it sent, with Alchemy's
compute units estimated:

```
INFO  [snapshot] done ms=19021 … pools=580 tracked=200 snapshots=200 … requests=528 main=528 logs=0 alchemyCu=13718
INFO  [volume] done ms=9120 … requests=9 main=3 logs=6 alchemyCu=48
```

The first line of each UTC day totals the day before and projects a 30-day month at that rate:

```
INFO  daily total day=2026-10-25 requests=26300 main=25820 logs=480 alchemyCu=665000 alchemyCuMonthPace=19950000 alchemyFreeTierPct=67
```

`alchemyFreeTierPct` above 100 means the month will run out: set `DEPTHWATCH_SNAPSHOT_INTERVAL=1h`
or lower `DEPTHWATCH_TOP_POOLS`. Errors are `ERROR` lines naming the step; a logs endpoint that
cannot serve the chunk size says how to fix it.

## Data

The database is one SQLite file in WAL mode, with `-wal` and `-shm` files beside it while it is
open. Keep the directory on persistent disk (the `/data` volume of the image). Deleting the
database starts over from the seed.

### Disk

Snapshots are the bulk of the file: about 1.4 KB per pool per pass, so 200 tracked pools every
30 minutes add about 13 MB a day (every 5 minutes with `run`, about 80 MB). Once a day, at the
end of a pass, the server deletes snapshots and hourly volume older than `DEPTHWATCH_KEEP_DAYS`
(default 30 days; snapshots keep at least 8, the dashboard's 7-day windows plus a day), scorecard
samples older than 35 days and alerts older than 90, then checkpoints the WAL; the same runs on
demand as `depthwatch prune` (`docker compose exec -u node depthwatch depthwatch prune`,
database only, safe beside `start`). At the defaults the file settles around 400 MB for 200
pools (`run` at 5 minutes: around 2.5 GB), plus the WAL's size between checkpoints. SQLite reuses
the freed pages rather than shrinking the file; `VACUUM` (with the server stopped, or `VACUUM
INTO` a copy as in [Backups](#backups)) compacts it when that matters.

### Backups

While the server runs, its latest writes sit in `depthwatch.db-wal` and `depthwatch.db-shm`
beside the file, so copying the `.db` file of a running server, or the three files one after the
other, gives an inconsistent copy. Take a hot backup through SQLite instead, which writes a
consistent snapshot while the server keeps going; the target file must not exist yet:

```sh
# On the host, with the sqlite3 CLI and the directory at hand (a bind mount or a bare install):
sqlite3 /srv/depthwatch/depthwatch.db ".backup /srv/backups/depthwatch-$(date +%F).db"
# In the container, with Node's own SQLite (the image has no sqlite3 CLI), then copied out:
docker compose exec -u node depthwatch node -e "
  const { DatabaseSync } = require('node:sqlite')
  new DatabaseSync('/data/depthwatch.db', { readOnly: true }).exec(\"VACUUM INTO '/data/backup.db'\")
"
docker compose cp depthwatch:/data/backup.db "./depthwatch-$(date +%F).db"
docker compose exec -u node depthwatch rm /data/backup.db
```

Node prints a warning that its SQLite module is experimental; the copy is complete. A plain copy
of the three files is sound only while the server is stopped. A backup restores by replacing the
`.db` file while the server is stopped, with no `-wal` or `-shm` file beside it. The restored
file must be writable by the user the server runs as: the image's entrypoint hands `/data` to
`node` when the container starts as root; under `--user node`, or on a bare install, `chown` a
file copied as root yourself, or `start` exits with `database is not writable`.
