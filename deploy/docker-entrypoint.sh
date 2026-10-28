#!/bin/sh
# The `depthwatch` command inside the Docker image (installed as /usr/local/bin/depthwatch and used
# as the image's entrypoint): `depthwatch start` by default; the database-only commands (`mm
# list`, `mm register`, …) with `docker compose exec -u node depthwatch depthwatch <command>`,
# never a live command beside `start` but `discover --seed`, which writes pools only. See
# docs/DEPLOY.md.
set -eu

# The database stays in the /data volume: a relative DEPTHWATCH_DB (the .env.example default, when
# a .env file is passed as it is) would resolve inside the image, under the root-owned /app, and
# fail to open. The image sets /data/depthwatch.db; an absolute path or :memory: is left alone.
case "${DEPTHWATCH_DB:-}" in
  '' | /* | :memory:) ;;
  *)
    echo "error: DEPTHWATCH_DB must be an absolute path inside the container (got '$DEPTHWATCH_DB'); the image keeps it at /data/depthwatch.db" >&2
    exit 2
    ;;
esac

# Started as root: hosts mount a fresh volume owned by root, so hand the data directory to the
# unprivileged `node` user, then run as that user for good: no new privileges (setuid binaries
# cannot raise them again), no capability kept or regainable. Nothing else runs as root.
if [ "$(id -u)" = 0 ]; then
  mkdir -p /data
  find /data ! -user node -exec chown node:node {} + ||
    echo "warning: could not hand /data to the node user; the database may not be writable" >&2
  exec env HOME=/home/node setpriv --reuid=node --regid=node --init-groups \
    --no-new-privs --inh-caps=-all --bounding-set=-all -- "$0" "$@"
fi

# tsx's loader in this Node process (the file `node --import tsx` loads), so the server is the
# process the host signals and no compile step is needed. The image build runs
# `depthwatch --version`, so a tsx upgrade that moves this file fails the build, not the server.
exec node --import file:///app/apps/cli/node_modules/tsx/dist/loader.mjs \
  /app/apps/cli/src/main.ts "$@"
