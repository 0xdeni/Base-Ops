# Depthwatch server image: `depthwatch start` (the website, the API and the schedule that keeps the
# data fresh) in one Node process, running as the unprivileged `node` user. The database lives in
# the /data volume. docs/DEPLOY.md is the guide.
#
#   docker build -t depthwatch .
#   docker run -p 127.0.0.1:8787:8787 -v depthwatch-data:/data -e DEPTHWATCH_RPC_URL=... depthwatch
#
# The port is published on loopback only, for a reverse proxy with TLS on the host. docs/DEPLOY.md
# "Docker" has the full command (restart policy, stop timeout, --env-file) and deploy/compose.yaml
# the same for Compose.
#
# Node 22 (node:sqlite needs >= 22.13), pinned to one release and its multi-platform digest. To
# update, change both; `docker buildx imagetools inspect node:<tag>` prints the digest.
ARG NODE_IMAGE=node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# --- The workspace manifests and pnpm, at the version package.json pins (`packageManager`).
FROM ${NODE_IMAGE} AS manifests
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/chain/package.json packages/chain/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN corepack enable && pnpm --version

# --- The dashboard, apps/web/dist: Vite and React are needed to build it, not to serve it.
FROM manifests AS web
RUN pnpm install --frozen-lockfile --filter "@depthwatch/web..."
COPY . .
RUN pnpm build

# --- What the server runs: the production dependencies of the CLI and the packages it imports,
# tsx among them (no compile step). The workspace root's tools (Biome, Vitest) stay out.
FROM manifests AS deps
RUN pnpm install --frozen-lockfile --prod --filter "@depthwatch/cli..."

# --- Their sources, without the tests.
FROM ${NODE_IMAGE} AS source
WORKDIR /app
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/cli ./apps/cli
RUN find packages apps -type f \( -name '*.test.ts' -o -name '*.test.tsx' \) -delete

# --- The image.
FROM ${NODE_IMAGE} AS runtime
ENV DEPTHWATCH_DB=/data/depthwatch.db
WORKDIR /app
COPY --from=deps /app ./
COPY --from=source /app ./
COPY --from=web /app/apps/web/dist ./apps/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/depthwatch
RUN chmod 0755 /usr/local/bin/depthwatch \
  && mkdir -p /data \
  && chown node:node /data \
  && depthwatch --version
VOLUME /data
# The port when neither DEPTHWATCH_PORT nor a platform's PORT is set.
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "const p = process.env.DEPTHWATCH_PORT || process.env.PORT || 8787; fetch(`http://127.0.0.1:${p}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Starts as root only to hand /data to `node`, then runs as `node` with no way back to root
# (deploy/docker-entrypoint.sh); `docker exec -u node` for the database-only commands.
ENTRYPOINT ["depthwatch"]
CMD ["start"]
