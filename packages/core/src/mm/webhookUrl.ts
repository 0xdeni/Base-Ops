/**
 * Where an alert webhook may point (docs/SCORECARDS.md, "Alerts"): an http(s) URL without user
 * info whose host is not the indexer's own machine or network. Delivery is a server-side POST, so
 * a URL naming `localhost` or a loopback, private, link-local, carrier-grade NAT or unique-local
 * address would turn the alert into a request against the operator's network. Host names are
 * taken as written (`localhost` and `*.localhost` are refused, nothing is resolved); IP literals
 * are judged by their range in the form the URL parser normalises them to (`127.1` is
 * `127.0.0.1`, `[::ffff:127.0.0.1]` is `[::ffff:7f00:1]`).
 */

export const WEBHOOK_URL_PROBLEM = 'alertWebhookUrl must be null or an http(s) URL'
export const WEBHOOK_USERINFO_PROBLEM = 'alertWebhookUrl must not carry a username or password'
export const WEBHOOK_HOST_PROBLEM =
  'alertWebhookUrl must name a public host, not localhost or a loopback, private, link-local, carrier-grade NAT or unique-local address'

/** 0/8, 10/8, 127/8, 100.64/10, 169.254/16, 172.16/12 and 192.168/16. */
function isPrivateIpv4(octets: readonly number[]): boolean {
  const [a = 0, b = 0] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** The eight 16-bit groups of an IPv6 literal (`::` expanded), or null when it is not one. */
function ipv6Groups(text: string): number[] | null {
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (half: string | undefined): number[] =>
    half === undefined || half === '' ? [] : half.split(':').map((g) => Number.parseInt(g, 16))
  const head = parse(halves[0])
  const tail = parse(halves[1])
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...new Array<number>(missing).fill(0), ...tail]
  return groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** `::1`, `::`, fc00::/7, fe80::/10 and an IPv4-mapped address (::ffff:a.b.c.d) in a private range. */
function isPrivateIpv6(groups: readonly number[]): boolean {
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = groups
  if (groups.slice(0, 7).every((g) => g === 0) && g7 <= 1) return true
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80) return true
  if (groups.slice(0, 5).every((g) => g === 0) && g5 === 0xffff)
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff])
  return false
}

/**
 * True for a host the indexer must not post to: `localhost` (and `*.localhost`), or an IP literal
 * in a loopback, unspecified, private, link-local, carrier-grade NAT or unique-local range. A
 * bracketed literal that does not parse as IPv6 is refused too.
 */
export function isPrivateWebhookHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.startsWith('[') && host.endsWith(']')) {
    const groups = ipv6Groups(host.slice(1, -1))
    return groups === null || isPrivateIpv6(groups)
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isPrivateIpv4(host.split('.').map(Number))
  return false
}

/** Why `value` cannot be a mandate's webhook URL (a `parseMandate` problem), or null when it can. */
export function webhookUrlProblem(value: string): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return WEBHOOK_URL_PROBLEM
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return WEBHOOK_URL_PROBLEM
  if (url.username !== '' || url.password !== '') return WEBHOOK_USERINFO_PROBLEM
  if (isPrivateWebhookHost(url.hostname)) return WEBHOOK_HOST_PROBLEM
  return null
}
