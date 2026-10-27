/**
 * The settings `depthwatch start` reads: schedule durations (flag over variable over default,
 * units, `off`, bounds), the platform's PORT, and the flags that belong to `start` alone.
 */
import { describe, expect, it } from 'vitest'
import { ConfigError, DEFAULTS, loadConfig, parseCliArgs } from '../config.js'
import { parseDuration } from '../configValues.js'
import { formatSeconds } from './scheduler.js'
import { loadScheduleSettings, SCHEDULE_DEFAULTS, SCHEDULE_SETTINGS } from './settings.js'

describe('parseDuration', () => {
  it('reads plain seconds and units', () => {
    expect(parseDuration('x', '300')).toBe(300)
    expect(parseDuration('x', '90s')).toBe(90)
    expect(parseDuration('x', '30m')).toBe(1_800)
    expect(parseDuration('x', ' 6H ')).toBe(21_600)
    expect(parseDuration('x', '1h30m')).toBe(5_400)
    expect(parseDuration('x', '1d')).toBe(86_400)
  })

  it('takes off (and 0) only where a setting can be switched off', () => {
    expect(parseDuration('x', 'off', { off: true })).toBe(0)
    expect(parseDuration('x', '0', { off: true, min: 60 })).toBe(0)
    expect(() => parseDuration('x', 'off')).toThrow(/x must be a duration/)
    expect(() => parseDuration('x', '0', { min: 60 })).toThrow('x must be ≥ 60 s, got 0 s')
  })

  it('rejects anything else, naming the setting', () => {
    for (const bad of ['', 'm', '1.5', '-5', '5 min', '30m1h', 'soon'])
      expect(() => parseDuration('DEPTHWATCH_X', bad)).toThrow(ConfigError)
    expect(() => parseDuration('DEPTHWATCH_X', '2d', { max: 86_400 })).toThrow(
      'DEPTHWATCH_X must be ≤ 86400 s, got 172800 s',
    )
  })
})

describe('loadScheduleSettings', () => {
  it('defaults to the documented schedule', () => {
    expect(loadScheduleSettings({})).toEqual(SCHEDULE_DEFAULTS)
    expect(loadConfig({}).schedule).toEqual(SCHEDULE_DEFAULTS)
    expect(Object.values(SCHEDULE_DEFAULTS).map(formatSeconds)).toEqual([
      '30m',
      '1h',
      '6h',
      '10m',
      '15m',
      '8s',
    ])
  })

  it('lets flags win over variables, which win over the defaults', () => {
    const env = {
      DEPTHWATCH_SNAPSHOT_INTERVAL: '1h',
      DEPTHWATCH_VOLUME_INTERVAL: '2h',
      DEPTHWATCH_POSITIONS_INTERVAL: 'off',
      DEPTHWATCH_POSITIONS_BUDGET: '5m',
      DEPTHWATCH_DISCOVER_BUDGET: '20m',
      DEPTHWATCH_SHUTDOWN_GRACE: '20',
    }
    expect(loadScheduleSettings(env)).toEqual({
      snapshotIntervalSeconds: 3_600,
      volumeIntervalSeconds: 7_200,
      positionsIntervalSeconds: 0,
      positionsBudgetSeconds: 300,
      discoverBudgetSeconds: 1_200,
      shutdownGraceSeconds: 20,
    })
    const args = parseCliArgs([
      'start',
      '--snapshot-interval',
      '15m',
      '--positions-interval',
      '12h',
      '--discover-budget',
      'off',
    ])
    expect(loadConfig(env, args.flags).schedule).toEqual({
      snapshotIntervalSeconds: 900,
      volumeIntervalSeconds: 7_200,
      positionsIntervalSeconds: 43_200,
      positionsBudgetSeconds: 300,
      discoverBudgetSeconds: 0,
      shutdownGraceSeconds: 20,
    })
    // Blank variables count as unset, like every other DEPTHWATCH_ variable.
    expect(loadScheduleSettings({ DEPTHWATCH_SNAPSHOT_INTERVAL: '  ' })).toEqual(SCHEDULE_DEFAULTS)
  })

  it('names the flag or the variable in errors and enforces the bounds', () => {
    expect(() => loadScheduleSettings({ DEPTHWATCH_SNAPSHOT_INTERVAL: '10s' })).toThrow(
      'DEPTHWATCH_SNAPSHOT_INTERVAL must be ≥ 60 s, got 10 s',
    )
    expect(() => loadScheduleSettings({}, { volumeInterval: 'hourly' })).toThrow(
      /--volume-interval must be a duration/,
    )
    expect(() => loadScheduleSettings({ DEPTHWATCH_VOLUME_INTERVAL: 'off' })).toThrow(ConfigError)
    expect(() => loadScheduleSettings({ DEPTHWATCH_POSITIONS_BUDGET: '0' })).toThrow(/≥ 30 s/)
    for (const setting of Object.values(SCHEDULE_SETTINGS))
      expect(setting.env).toMatch(/^DEPTHWATCH_[A-Z_]+$/)
  })

  it('keeps the schedule flags to start', () => {
    expect(() => parseCliArgs(['run', '--snapshot-interval', '5m'])).toThrow(
      '--snapshot-interval only applies to start',
    )
    expect(() => parseCliArgs(['serve', '--discover-budget', 'off'])).toThrow(ConfigError)
    expect(parseCliArgs(['start', '--volume-interval', '2h']).flags.volumeInterval).toBe('2h')
    expect(() => parseCliArgs(['start', '--interval', '30m'])).toThrow(
      '--interval does not apply to start, whose schedule takes --snapshot-interval and friends',
    )
    expect(() => parseCliArgs(['start', '--from-block', '1'])).toThrow(/--from-block does not/)
    expect(() => parseCliArgs(['start', '--with-positions'])).toThrow(ConfigError)
    expect(() => parseCliArgs(['start', '--seed'])).toThrow(
      '--seed only applies to discover and run',
    )
  })
})

describe('loadConfig: port and interval for a server', () => {
  it('takes the platform PORT when DEPTHWATCH_PORT is unset; the variable and --port win', () => {
    expect(loadConfig({}).port).toBe(DEFAULTS.port)
    expect(loadConfig({ PORT: '10000' }).port).toBe(10_000)
    expect(loadConfig({ PORT: '10000', DEPTHWATCH_PORT: '9000' }).port).toBe(9_000)
    expect(loadConfig({ PORT: '10000' }, { port: '8888' }).port).toBe(8_888)
    expect(loadConfig({ PORT: ' ' }).port).toBe(DEFAULTS.port)
    expect(() => loadConfig({ PORT: 'web' })).toThrow(/port must be an integer/)
    expect(loadConfig({ PORT: '10000' }).hostname).toBe('0.0.0.0')
  })

  it('reads run --interval as seconds or a duration', () => {
    expect(loadConfig({}, { interval: '300' }).intervalSeconds).toBe(300)
    expect(loadConfig({}, { interval: '30m' }).intervalSeconds).toBe(1_800)
  })
})
