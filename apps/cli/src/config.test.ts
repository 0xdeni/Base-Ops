import { DEXES } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import {
  COMMANDS,
  ConfigError,
  DEFAULTS,
  LIVE_COMMANDS,
  loadConfig,
  parseCliArgs,
} from './config.js'
import { requireRpcUrl } from './rpc.js'

describe('parseCliArgs', () => {
  it('recognises every command and no command', () => {
    for (const command of COMMANDS) expect(parseCliArgs([command]).command).toBe(command)
    expect(parseCliArgs([]).command).toBeUndefined()
  })

  it('parses flags, repeated flags and short help/version', () => {
    const args = parseCliArgs([
      'snapshot',
      '--top',
      '10',
      '--pool',
      'uniswap-v3:0xAB',
      '--pool',
      'aerodrome-v2:0xcd',
      '--db',
      '/tmp/x.sqlite',
      '--rpc-url',
      'https://rpc.example',
      '--log-chunk',
      '500',
    ])
    expect(args.command).toBe('snapshot')
    expect(args.flags).toMatchObject({
      top: '10',
      pool: ['uniswap-v3:0xAB', 'aerodrome-v2:0xcd'],
      db: '/tmp/x.sqlite',
      rpcUrl: 'https://rpc.example',
      logChunk: '500',
    })
    expect(parseCliArgs(['-h']).help).toBe(true)
    expect(parseCliArgs(['--version']).version).toBe(true)
    expect(parseCliArgs(['run', '--once', '--with-positions']).flags).toMatchObject({
      once: true,
      withPositions: true,
    })
  })

  it('parses --keep-days for prune, run and start and refuses it elsewhere', () => {
    expect(parseCliArgs(['prune', '--keep-days', '14']).flags.keepDays).toBe('14')
    expect(parseCliArgs(['run', '--keep-days', '14']).command).toBe('run')
    expect(parseCliArgs(['start', '--keep-days', '14']).command).toBe('start')
    expect(() => parseCliArgs(['snapshot', '--keep-days', '14'])).toThrow(
      /--keep-days only applies to prune, run and start/,
    )
    expect(loadConfig({}).keepDays).toBe(DEFAULTS.keepDays)
    expect(loadConfig({ DEPTHWATCH_KEEP_DAYS: '9' }).keepDays).toBe(9)
    expect(loadConfig({ DEPTHWATCH_KEEP_DAYS: '9' }, { keepDays: '14' }).keepDays).toBe(14)
    expect(() => loadConfig({}, { keepDays: '1' })).toThrow(/keep days/)
    expect(() => loadConfig({}, { keepDays: '1.5' })).toThrow(/keep days must be an integer/)
  })

  it('parses export --out and --demo, and keeps --demo to export', () => {
    const args = parseCliArgs(['export', '--out', 'site/bundle.json', '--demo'])
    expect(args.command).toBe('export')
    expect(args.flags).toMatchObject({ out: 'site/bundle.json', demo: true })
    expect(loadConfig({}, args.flags)).toMatchObject({
      outFile: 'site/bundle.json',
      exportDemo: true,
    })
    expect(loadConfig({})).toMatchObject({ outFile: undefined, exportDemo: false })
    expect(() => parseCliArgs(['serve', '--demo'])).toThrow(/--demo only applies to export/)
    expect(() => parseCliArgs(['export', '--out', ' '])).toThrow(/--out needs a file path/)
  })

  it('rejects unknown commands, unknown options and extra positionals', () => {
    expect(() => parseCliArgs(['frobnicate'])).toThrow(ConfigError)
    expect(() => parseCliArgs(['discover', '--bogus'])).toThrow(ConfigError)
    expect(() => parseCliArgs(['discover', 'extra'])).toThrow(/unexpected argument/)
  })
})

describe('loadConfig', () => {
  it('applies defaults with an empty environment', () => {
    const config = loadConfig({})
    expect(config).toMatchObject({
      rpcUrl: undefined,
      dbPath: DEFAULTS.dbPath,
      dbPathSource: 'default',
      port: DEFAULTS.port,
      hostname: DEFAULTS.hostname,
      topPools: DEFAULTS.topPools,
      logChunkSize: DEFAULTS.logChunkSize,
      intervalSeconds: DEFAULTS.intervalSeconds,
      runOnce: false,
      hours: DEFAULTS.hours,
      fromBlock: undefined,
      poolIds: [],
      bandPct: 5,
      logLevel: 'info',
      publicUrl: undefined,
      adminToken: undefined,
    })
    expect(config.dexes).toEqual([...DEXES])
  })

  it('reads DEPTHWATCH_ADMIN_TOKEN from the environment only, ignoring blank values', () => {
    expect(loadConfig({ DEPTHWATCH_ADMIN_TOKEN: 's3cret' }).adminToken).toBe('s3cret')
    expect(loadConfig({ DEPTHWATCH_ADMIN_TOKEN: '   ' }).adminToken).toBeUndefined()
    expect(() => parseCliArgs(['serve', '--admin-token', 'x'])).toThrow(ConfigError)
  })

  it('reads the environment and lets flags win', () => {
    const env = {
      DEPTHWATCH_RPC_URL: 'https://mainnet.base.org',
      DEPTHWATCH_DB: '/data/dw.sqlite',
      DEPTHWATCH_PORT: '9000',
      DEPTHWATCH_TOP_POOLS: '25',
      DEPTHWATCH_LOG_CHUNK: '1500',
      DEPTHWATCH_LOG_LEVEL: 'warn',
    }
    const fromEnv = loadConfig(env)
    expect(fromEnv).toMatchObject({
      rpcUrl: 'https://mainnet.base.org',
      dbPath: '/data/dw.sqlite',
      dbPathSource: 'env',
      port: 9000,
      topPools: 25,
      logChunkSize: 1500,
      logLevel: 'warn',
    })
    const fromFlags = loadConfig(env, {
      port: '0',
      top: '3',
      db: ':memory:',
      rpcUrl: 'http://localhost:8545',
      logLevel: 'debug',
      hours: '48',
      interval: '60',
      fromBlock: '1_000_000',
      dex: ['uniswap-v3,aerodrome-v2', 'uniswap-v3'],
      pool: ['uniswap-v3:0xABCDEF', 'uniswap-v4:0x01,aerodrome-v2:0x02'],
    })
    expect(fromFlags).toMatchObject({
      port: 0,
      topPools: 3,
      dbPath: ':memory:',
      dbPathSource: 'flag',
      rpcUrl: 'http://localhost:8545',
      logLevel: 'debug',
      hours: 48,
      intervalSeconds: 60,
      fromBlock: 1_000_000n,
      dexes: ['uniswap-v3', 'aerodrome-v2'],
      poolIds: ['uniswap-v3:0xabcdef', 'uniswap-v4:0x01', 'aerodrome-v2:0x02'],
    })
  })

  it('reads DEPTHWATCH_LOGS_RPC_URL, lets --logs-rpc-url win and defaults to the main URL', () => {
    const main = { DEPTHWATCH_RPC_URL: 'https://main.example/v2' }
    expect(loadConfig(main).logsRpcUrl).toBe('https://main.example/v2')
    expect(loadConfig({}).logsRpcUrl).toBeUndefined()
    const both = { ...main, DEPTHWATCH_LOGS_RPC_URL: 'https://logs.example' }
    expect(loadConfig(both)).toMatchObject({
      rpcUrl: 'https://main.example/v2',
      logsRpcUrl: 'https://logs.example',
    })
    expect(loadConfig(both, { logsRpcUrl: 'https://flag.example' }).logsRpcUrl).toBe(
      'https://flag.example',
    )
    expect(loadConfig({ ...main, DEPTHWATCH_LOGS_RPC_URL: '  ' }).logsRpcUrl).toBe(
      'https://main.example/v2',
    )
    expect(() => loadConfig({ DEPTHWATCH_LOGS_RPC_URL: 'logs.example' })).toThrow(
      'DEPTHWATCH_LOGS_RPC_URL must be an http(s) URL, got no scheme',
    )
    expect(parseCliArgs(['volume', '--logs-rpc-url', 'https://l.example']).flags).toMatchObject({
      logsRpcUrl: 'https://l.example',
    })
  })

  it('refuses ws(s) endpoints for both URLs (HTTP transports only), never echoing the URL', () => {
    const key = 'wss://base-mainnet.g.alchemy.com/v2/SECRETKEY'
    for (const env of [{ DEPTHWATCH_RPC_URL: key }, { DEPTHWATCH_LOGS_RPC_URL: key }]) {
      const error = (() => {
        try {
          loadConfig(env)
        } catch (e) {
          return e as Error
        }
      })()
      expect(error?.message).toMatch(
        /^DEPTHWATCH_(LOGS_)?RPC_URL must be an http\(s\) URL, got a wss: URL \(WebSocket endpoints are not supported\)$/,
      )
      expect(error?.message).not.toContain('SECRETKEY')
    }
    expect(() => loadConfig({}, { logsRpcUrl: 'ws://127.0.0.1:8546' })).toThrow(/got a ws: URL/)
    expect(loadConfig({ DEPTHWATCH_RPC_URL: ' https://main.example/v2 ' }).rpcUrl).toBe(
      'https://main.example/v2',
    )
  })

  it('ignores blank environment values', () => {
    expect(loadConfig({ DEPTHWATCH_PORT: '  ', DEPTHWATCH_RPC_URL: '' })).toMatchObject({
      port: DEFAULTS.port,
      rpcUrl: undefined,
    })
  })

  it('rejects malformed numbers, urls, dexes, pool ids and log levels', () => {
    expect(() => loadConfig({ DEPTHWATCH_PORT: 'eighty' })).toThrow(/port must be an integer/)
    expect(() => loadConfig({ DEPTHWATCH_PORT: '70000' })).toThrow(/port must be ≤ 65535/)
    expect(() => loadConfig({ DEPTHWATCH_TOP_POOLS: '-1' })).toThrow(/top must be ≥ 0/)
    expect(() => loadConfig({ DEPTHWATCH_LOG_CHUNK: '0' })).toThrow(/log chunk size must be ≥ 1/)
    expect(() => loadConfig({ DEPTHWATCH_RPC_URL: 'mainnet.base.org' })).toThrow(/http\(s\)/)
    expect(() => loadConfig({}, { hours: '0' })).toThrow(/hours must be ≥ 1/)
    expect(() => loadConfig({}, { interval: '1.5' })).toThrow(/interval must be a duration/)
    expect(() => loadConfig({}, { fromBlock: '-5' })).toThrow(/block number/)
    expect(() => loadConfig({}, { dex: ['sushiswap'] })).toThrow(/unknown dex "sushiswap"/)
    expect(() => loadConfig({}, { pool: ['0xabc'] })).toThrow(/<dex>:<address>/)
    expect(() => loadConfig({}, { logLevel: 'loud' })).toThrow(/log level/)
  })
})

describe('requireRpcUrl', () => {
  it('returns the url when set and explains what to set otherwise', () => {
    expect(requireRpcUrl(loadConfig({ DEPTHWATCH_RPC_URL: 'https://x' }), 'discover')).toBe(
      'https://x',
    )
    expect(() => requireRpcUrl(loadConfig({}), 'snapshot')).toThrow(
      /"snapshot".*DEPTHWATCH_RPC_URL.*--rpc-url.*demo/,
    )
    expect(LIVE_COMMANDS).toEqual(['discover', 'snapshot', 'volume', 'positions', 'run', 'start'])
  })
})
