/**
 * The documents a server owner reads name every setting `depthwatch start` reads, with the
 * defaults the code applies: `.env.example` lists every variable (and leaves the two the Docker
 * image and a hosting platform set unset), the README "Environment" table and the docs/DEPLOY.md
 * schedule table give each schedule variable its default, and `--help` names every schedule
 * flag. The Docker documents publish the port on loopback only and drop privileges for good.
 * DEPLOY.md's upgrade notes quote the refusal an older build gives the current schema version,
 * name the DEX ids an explicit `--dex` list has to add and give a changed Aero hook and a changed
 * fee module the remedies the snapshot step logs (`poolConfigFix`); DEPLOY.md and the entrypoint
 * name `discover --seed` as the one live command safe beside `start`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poolConfigFix } from '@depthwatch/chain'
import { DEXES } from '@depthwatch/core'
import { SCHEMA_VERSION } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { usage } from '../main.js'
import { formatSeconds } from './scheduler.js'
import { SCHEDULE_DEFAULTS, SCHEDULE_SETTINGS } from './settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8')

/** Variables config.ts reads (`env.NAME`), plus the schedule's. */
function variablesStartReads(): string[] {
  const config = readFileSync(join(HERE, '..', 'config.ts'), 'utf8')
  const fromConfig = [...config.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1] ?? '')
  const fromSchedule = Object.values(SCHEDULE_SETTINGS).map((s) => s.env)
  return [...new Set([...fromConfig, ...fromSchedule])].sort()
}

const schedule = Object.entries(SCHEDULE_SETTINGS) as Array<
  [keyof typeof SCHEDULE_DEFAULTS, (typeof SCHEDULE_SETTINGS)[keyof typeof SCHEDULE_SETTINGS]]
>

describe('start settings in the documents', () => {
  it('finds the variables config.ts reads', () => {
    expect(variablesStartReads()).toEqual(
      expect.arrayContaining(['DEPTHWATCH_RPC_URL', 'DEPTHWATCH_PORT', 'PORT', 'DEPTHWATCH_DB']),
    )
  })

  it('.env.example lists every variable start reads', () => {
    const example = read('.env.example')
    for (const name of variablesStartReads())
      expect(example).toMatch(new RegExp(`^#? ?${name}=`, 'm'))
  })

  it('.env.example leaves DEPTHWATCH_DB and DEPTHWATCH_PORT unset: the image default and a platform PORT survive --env-file', () => {
    const example = read('.env.example')
    expect(example).toMatch(/^# DEPTHWATCH_DB=/m)
    expect(example).toMatch(/^# DEPTHWATCH_PORT=/m)
    expect(example).not.toMatch(/^DEPTHWATCH_(DB|PORT)=/m)
  })

  it('the Docker documents publish the port on loopback only and keep root out of the server', () => {
    const documents = {
      Dockerfile: read('Dockerfile'),
      'deploy/compose.yaml': read('deploy', 'compose.yaml'),
      'docs/DEPLOY.md': read('docs', 'DEPLOY.md'),
    }
    for (const [file, text] of Object.entries(documents)) {
      expect(text, file).toContain('127.0.0.1:8787:8787')
      expect(text, file).not.toMatch(/-p 8787:8787|"8787:8787"/)
    }
    const entrypoint = read('deploy', 'docker-entrypoint.sh')
    for (const flag of ['--no-new-privs', '--inh-caps=-all', '--bounding-set=-all'])
      expect(entrypoint).toContain(flag)
    expect(entrypoint).toContain('DEPTHWATCH_DB must be an absolute path')
    expect(documents['docs/DEPLOY.md']).toContain('docker compose exec -u node depthwatch')
  })

  it('the README and DEPLOY.md give each schedule variable its default', () => {
    const readme = read('README.md')
    const deploy = read('docs', 'DEPLOY.md')
    for (const [key, setting] of schedule) {
      const value = `\`${formatSeconds(SCHEDULE_DEFAULTS[key])}\``
      const flag = setting.flag === undefined ? '—' : `\`${setting.flag}\``
      expect(readme).toMatch(new RegExp(`\\| \`${setting.env}\` +\\| ${flag} +\\| ${value} +\\|`))
      expect(deploy).toMatch(new RegExp(`\\| \`${setting.env}\` +\\| ${value} +\\|`))
    }
  })

  it('--help names every schedule flag and default', () => {
    for (const [key, setting] of schedule) {
      expect(usage()).toContain(setting.env)
      if (setting.flag !== undefined) expect(usage()).toContain(setting.flag)
      expect(usage()).toContain(formatSeconds(SCHEDULE_DEFAULTS[key]))
    }
  })
})

describe('docs/DEPLOY.md: upgrading', () => {
  const deploy = read('docs', 'DEPLOY.md')
  const upgrading = deploy.slice(deploy.indexOf('\n## Upgrading\n')).replace(/\s+/g, ' ')

  it('quotes the refusal an older build gives this schema version, and says to back up first', () => {
    expect(deploy).toContain('\n## Upgrading\n')
    expect(upgrading).toContain(
      `database schema version ${SCHEMA_VERSION} is newer than this build (${SCHEMA_VERSION - 1}); upgrade depthwatch`,
    )
    expect(upgrading).toContain('[Backups](#backups)')
  })

  it('names the DEX ids an explicit --dex list must add, all of them DEXES', () => {
    for (const dex of ['aero-v2', 'aero-slipstream']) {
      expect(DEXES).toContain(dex)
      expect(upgrading).toContain(`\`${dex}\``)
    }
    expect(DEXES).toHaveLength(6)
    expect(upgrading).toContain('`start` covers every DEX by default, now six.')
    for (const reason of ['swap hook changed', 'initial fee enabled', 'fee module changed'])
      expect(upgrading).toContain(reason)
  })

  it('gives hook changes and a fee module change the remedies the snapshot step logs', () => {
    const module = poolConfigFix('fee module changed')
    for (const text of [upgrading, module]) {
      expect(text).toMatch(/`?aeroV2\.volatileFeeModule`? \/ `?stableFeeModule`?/)
      expect(text).toMatch(/`?discover --seed`? does not help/)
    }
    for (const change of ['swap hook changed', 'initial fee enabled'] as const)
      expect(poolConfigFix(change)).toContain('then run discover --seed')
    expect(upgrading).toContain('It reads the hook of every stored Aero Slipstream pool again')
  })

  it('names discover --seed as the one live command safe beside start', () => {
    expect(deploy.replace(/\s+/g, ' ')).toContain(
      '`discover --seed` is the one live command that is safe beside `start`',
    )
    const entrypoint = read('deploy', 'docker-entrypoint.sh').replace(/\s+#?\s*/g, ' ')
    expect(entrypoint).toContain('never a live command beside `start` but `discover --seed`')
  })
})
