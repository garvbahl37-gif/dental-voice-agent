import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Stopping user-supplied URLs being used to reach inside our own network.
 *
 * Two features take a URL from a user and make the *server* request it: the
 * website importer, and webhook delivery. Both are SSRF primitives without this,
 * and they share one implementation because two copies of a security check
 * drift — silently, until somebody probes the copy nobody updated.
 * That server holds database credentials in its environment and, on most hosts,
 * sits next to an unauthenticated metadata endpoint that will hand out cloud
 * credentials to anything that asks. Without this guard, an admin — or anyone
 * who takes over an admin account — can point the importer at
 * `http://169.254.169.254/` and read those credentials out of the knowledge
 * base afterwards, one passage at a time. A webhook pointed at the same address
 * cannot read the response back, but it still makes the request — and a POST to
 * an internal endpoint is an action, not just a read.
 *
 * Two things have to be checked, and checking only the first is the usual
 * mistake:
 *
 *   **The hostname**, to catch `localhost` and a literal private IP.
 *   **What it resolves to**, because `internal.attacker.com` is a public-looking
 *     name with an A record pointing at 127.0.0.1. Blocking by name alone stops
 *     nothing.
 *
 * Redirects are followed manually for the same reason: a public URL that 302s
 * to the metadata endpoint defeats a check done only on the original address.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

/** Ranges that are never a clinic's website. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const p = ip.split('.').map(Number)
    const [a, b] = [p[0]!, p[1]!]
    if (a === 0) return true // "this network"
    if (a === 10) return true // RFC1918
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
    if (a === 192 && b === 168) return true // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a >= 224) return true // multicast and reserved
    return false
  }
  if (v === 6) {
    const s = ip.toLowerCase()
    if (s === '::1' || s === '::') return true
    if (s.startsWith('fe80')) return true // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true // unique local
    // IPv4 mapped — ::ffff:127.0.0.1 must not slip past as "IPv6".
    const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateAddress(mapped[1]!)
    return false
  }
  return true
}

export class BlockedAddressError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'BlockedAddressError'
  }
}

/** Throws unless this URL is a public web address we are willing to fetch. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new BlockedAddressError('That does not look like a web address.')
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new BlockedAddressError('Only http and https addresses can be imported.')
  }
  // A port that is not a web port is a service, not a website.
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  if (![80, 443, 8080, 8443].includes(port)) {
    throw new BlockedAddressError('Only standard web ports can be imported.')
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new BlockedAddressError('That address is not reachable from the public internet.')
  }

  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new BlockedAddressError('That address is not reachable from the public internet.')
    }
    return url
  }

  // Resolve, because a public name can point anywhere. Every answer must be
  // public — a name with one public and one private record is still an attack.
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BlockedAddressError('That address could not be found.')
  }
  if (addresses.length === 0) throw new BlockedAddressError('That address could not be found.')
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new BlockedAddressError('That address resolves inside a private network.')
    }
  }
  return url
}

/**
 * Fetch a page, re-checking the destination at every redirect.
 *
 * `redirect: 'follow'` would let a public URL bounce to the metadata endpoint
 * with no further checks, so each hop is validated before it is taken.
 */
export async function safeFetchHtml(
  raw: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<{ ok: boolean; html: string; finalUrl: string }> {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const maxBytes = opts.maxBytes ?? 2_000_000
  const maxRedirects = opts.maxRedirects ?? 4

  let current = raw
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicUrl(current)

    const res = await fetch(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'VaaniBot/1.0 (+clinic knowledge import)' },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return { ok: false, html: '', finalUrl: url.toString() }
      current = new URL(location, url).toString()
      continue
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('text/html')) {
      return { ok: false, html: '', finalUrl: url.toString() }
    }

    // A clinic page is tens of kilobytes. Anything vastly larger is either a
    // mistake or an attempt to exhaust memory.
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes) return { ok: false, html: '', finalUrl: url.toString() }

    const text = await res.text()
    return {
      ok: text.length <= maxBytes,
      html: text.slice(0, maxBytes),
      finalUrl: url.toString(),
    }
  }
  return { ok: false, html: '', finalUrl: current }
}
