import { describe, expect, it } from 'vitest'
import {
  isPrivateWebhookHost,
  WEBHOOK_HOST_PROBLEM,
  WEBHOOK_URL_PROBLEM,
  WEBHOOK_USERINFO_PROBLEM,
  webhookUrlProblem,
} from './webhookUrl.js'

describe('webhookUrlProblem', () => {
  it('accepts http(s) URLs at public hosts', () => {
    for (const url of [
      'https://hooks.slack.com/services/T000/B000/s3cr3t',
      'http://hooks.example.com:8080/x?token=1',
      'https://8.8.8.8/hook',
      'http://[2606:4700::1111]/hook',
      'http://[::ffff:8.8.8.8]/hook',
      'http://172.32.0.1/x',
      'http://100.128.0.1/x',
      'http://[fec0::1]/x',
      'http://localhost.example.com/x',
    ])
      expect(webhookUrlProblem(url), url).toBeNull()
  })

  it('rejects anything but an http(s) URL', () => {
    for (const value of ['not a url', 'ftp://host/x', 'mailto:a@b.c', 'file:///etc/hosts', ''])
      expect(webhookUrlProblem(value), value).toBe(WEBHOOK_URL_PROBLEM)
  })

  it('rejects user info', () => {
    expect(webhookUrlProblem('https://user:pw@hooks.example.com/x')).toBe(WEBHOOK_USERINFO_PROBLEM)
    expect(webhookUrlProblem('https://user@hooks.example.com/x')).toBe(WEBHOOK_USERINFO_PROBLEM)
  })

  it('rejects localhost and loopback, private, link-local, CGNAT and unique-local literals', () => {
    for (const url of [
      'http://localhost:8787/api/mm',
      'http://api.localhost/x',
      'http://LOCALHOST/x',
      'http://127.0.0.1:8080/x',
      'http://127.1/x',
      'http://2130706433/x',
      'http://0x7f.0.0.1/x',
      'http://0.0.0.0/x',
      'http://10.0.0.5:9200/_cluster',
      'http://172.16.0.1/x',
      'http://172.31.255.255/x',
      'http://192.168.1.1/x',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/x',
      'http://100.127.255.255/x',
      'http://[::1]:8787/',
      'http://[::]/x',
      'http://[fc00::1]/x',
      'http://[fd12:3456::1]/x',
      'http://[fe80::1]/x',
      'http://[febf::1]/x',
      'http://[::ffff:127.0.0.1]/x',
      'http://[::ffff:7f00:1]/x',
      'http://[::ffff:10.0.0.5]/x',
      'http://[::ffff:a9fe:a9fe]/x',
    ])
      expect(webhookUrlProblem(url), url).toBe(WEBHOOK_HOST_PROBLEM)
  })

  it('names the field in every problem, the way the API maps problems to fields', () => {
    for (const problem of [WEBHOOK_URL_PROBLEM, WEBHOOK_USERINFO_PROBLEM, WEBHOOK_HOST_PROBLEM])
      expect(problem).toMatch(/^alertWebhookUrl must /)
  })
})

describe('isPrivateWebhookHost', () => {
  it('judges the host as the URL parser normalised it', () => {
    expect(isPrivateWebhookHost('hooks.example.com')).toBe(false)
    expect(isPrivateWebhookHost('[2001:db8::1]')).toBe(false)
    expect(isPrivateWebhookHost('[::1]')).toBe(true)
    expect(isPrivateWebhookHost('[not-an-address]')).toBe(true)
    expect(isPrivateWebhookHost('[1:2:3:4:5:6:7:8:9]')).toBe(true)
  })
})
