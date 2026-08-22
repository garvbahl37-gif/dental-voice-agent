import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isPrivateAddress } from './net-guard'

/**
 * Every case here is a way to make the server fetch something it should not.
 *
 * "Import my website" makes the *server* request a user-supplied URL, and that
 * server has database credentials in its environment and, on most hosts, an
 * unauthenticated metadata endpoint next door. If any of these stop failing,
 * the importer becomes a way to read cloud credentials out of the knowledge
 * base one passage at a time.
 */

describe('isPrivateAddress', () => {
  it('blocks loopback and the RFC1918 ranges', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
      expect(isPrivateAddress(ip)).toBe(true)
    }
  })

  it('blocks the cloud metadata endpoint specifically', () => {
    // The single most valuable target: hands out credentials to anything local.
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
    expect(isPrivateAddress('169.254.0.1')).toBe(true)
  })

  it('blocks 0.0.0.0, carrier-grade NAT and multicast', () => {
    expect(isPrivateAddress('0.0.0.0')).toBe(true)
    expect(isPrivateAddress('100.64.0.1')).toBe(true)
    expect(isPrivateAddress('224.0.0.1')).toBe(true)
  })

  it('does not block ordinary public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1', '13.235.1.1']) {
      expect(isPrivateAddress(ip)).toBe(false)
    }
  })

  it('blocks IPv6 loopback and unique-local', () => {
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('fd00::1')).toBe(true)
    expect(isPrivateAddress('fe80::1')).toBe(true)
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('sees through an IPv4 address wearing IPv6 clothes', () => {
    // ::ffff:127.0.0.1 is loopback however it is written.
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('treats anything unparseable as unsafe', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true)
    expect(isPrivateAddress('')).toBe(true)
  })
})

describe('assertPublicUrl', () => {
  const blocked = (url: string) => expect(assertPublicUrl(url)).rejects.toThrow()

  it('refuses non-web schemes', async () => {
    await blocked('file:///etc/passwd')
    await blocked('gopher://internal/')
    await blocked('ftp://internal/')
  })

  it('refuses localhost by every spelling', async () => {
    await blocked('http://localhost/')
    await blocked('http://localhost:5432/')
    await blocked('http://api.localhost/')
    await blocked('http://127.0.0.1/')
    await blocked('http://[::1]/')
  })

  it('refuses the metadata endpoint', async () => {
    await blocked('http://169.254.169.254/latest/meta-data/')
    await blocked('http://metadata.google.internal/computeMetadata/v1/')
  })

  it('refuses a literal private IP', async () => {
    await blocked('http://10.0.0.1/')
    await blocked('http://192.168.0.1/admin')
    await blocked('http://172.20.0.5:8080/')
  })

  it('refuses a non-web port — that is a service, not a website', async () => {
    await blocked('http://example.com:5432/')
    await blocked('http://example.com:6379/')
    await blocked('http://example.com:22/')
  })

  it('refuses a hostname ending .internal', async () => {
    await blocked('http://db.internal/')
  })

  it('refuses a name that does not resolve', async () => {
    await blocked('http://this-name-does-not-exist-vaani-test.invalid/')
  })

  it('allows an ordinary public site', async () => {
    // Resolves publicly; the point is that a real clinic site still imports.
    const url = await assertPublicUrl('https://example.com/fees')
    expect(url.hostname).toBe('example.com')
  })

  it('allows standard web ports explicitly', async () => {
    await expect(assertPublicUrl('https://example.com:443/')).resolves.toBeTruthy()
    await expect(assertPublicUrl('http://example.com:80/')).resolves.toBeTruthy()
  })
})
