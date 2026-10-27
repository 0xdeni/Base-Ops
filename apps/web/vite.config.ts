import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { agentDocs, staticSiteInfo } from './plugins/agentDocs.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The bundle the static build ships: written by `depthwatch export` (the root `pnpm build:static`
 * exports the demo world here first). Git-ignored.
 */
const STATIC_BUNDLE_SOURCE = resolve(HERE, 'static-data/bundle.json')
/** Where the static site reads it, relative to its index.html (`STATIC_BUNDLE_URL`). */
const STATIC_BUNDLE_PATH = 'data/bundle.json'

/** The bundle's text after a sanity check of its envelope; throws a readable error otherwise. */
function readBundle(source: string): string {
  if (!existsSync(source)) {
    throw new Error(
      `static build: ${source} not found. Run \`pnpm build:static\` from the repository root, or ` +
        '`pnpm depthwatch export --demo --out apps/web/static-data/bundle.json` first.',
    )
  }
  const text = readFileSync(source, 'utf8')
  const parsed: unknown = JSON.parse(text)
  const envelope = parsed as { v?: unknown; source?: unknown } | null
  if (envelope === null || envelope.v !== 1 || typeof envelope.source !== 'string') {
    throw new Error(`static build: ${source} is not a v1 Depthwatch static bundle`)
  }
  return text
}

/**
 * Static mode only: copies the exported bundle into the output as `data/bundle.json` (failing the
 * build when it is missing) and serves it at the same path from the dev server.
 */
function staticBundle(source: string): Plugin {
  return {
    name: 'depthwatch-static-bundle',
    configureServer(server) {
      server.middlewares.use(`/${STATIC_BUNDLE_PATH}`, (_req, res) => {
        try {
          const text = readBundle(source)
          res.setHeader('Content-Type', 'application/json')
          res.end(text)
        } catch (error) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
    buildStart() {
      readBundle(source)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: STATIC_BUNDLE_PATH, source: readBundle(source) })
    },
  }
}

/**
 * Two build modes (docs/design/web-v2.md §4):
 * - default (`vite build`): `dist/`, absolute base, BrowserRouter, `/api` with the mock fallback;
 * - static (`VITE_STATIC=1 vite build`, script `build:static`): `dist-static/`, relative base
 *   `./`, HashRouter and the client answering from `data/bundle.json`.
 * Both emit the agent documents (`AGENTS.md`, `llms.txt`, `openapi.json`, see
 * `plugins/agentDocs.ts`); the static copies carry a note generated from the shipped bundle.
 */
export default defineConfig(({ mode }) => {
  const isStatic = loadEnv(mode, HERE, 'VITE_').VITE_STATIC === '1'
  const staticSite = () => staticSiteInfo(readBundle(STATIC_BUNDLE_SOURCE))
  return {
    base: isStatic ? './' : '/',
    plugins: isStatic
      ? [react(), staticBundle(STATIC_BUNDLE_SOURCE), agentDocs({ staticSite })]
      : [react(), agentDocs()],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
    build: {
      outDir: isStatic ? 'dist-static' : 'dist',
      sourcemap: true,
    },
  }
})
