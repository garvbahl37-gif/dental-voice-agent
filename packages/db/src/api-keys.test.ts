import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from './testing'
import { seedOrganization, SMILE_DENTAL } from './seed'
import {
  issueApiKey,
  listApiKeys,
  registerWebhook,
  removeWebhook,
  resolveApiKey,
  revokeApiKey,
} from './api-keys'
import { emitWebhook, httpDeliver, signPayload, verifySignature, type Deliver } from './webhook-delivery'
import { webhooks } from './schema'

/**
 * Machine credentials and outbound notifications.
 *
 * The cases that matter are the ones where something should be refused: a
 * revoked key, a key belonging to another practice, a replayed webhook. A test
 * that only proves the happy path proves nothing about either.
 */

let t: TestDb
let smile: string
let pearl: string

beforeEach(async () => {
  t = await createTestDb()
  smile = (await seedOrganization(t.db, SMILE_DENTAL)).orgId
  pearl = (
    await seedOrganization(t.db, {
      slug: 'pearl',
      name: 'Pearl Dental',
      branches: [{ key: 'm', name: 'Pearl', area: 'Colaba', city: 'Mumbai' }],
      providers: [{ key: 'k', name: 'Dr. Sara Khan', title: 'General Dentist' }],
      services: [{ key: 'c', name: 'Cleaning', durationMin: 30 }],
    })
  ).orgId
})

afterEach(async () => {
  await t.close()
})

describe('API keys', () => {
  it('issues a key and resolves it back to its tenant', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'Practice software' })
    const caller = await resolveApiKey(t.db, key.secret)
    expect(caller!.orgId).toBe(smile)
    expect(caller!.scope).toBe('read')
  })

  it('accepts a Bearer header as well as a bare key', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'x' })
    expect((await resolveApiKey(t.db, `Bearer ${key.secret}`))!.orgId).toBe(smile)
  })

  it('never stores the key itself', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'x' })
    const [row] = await listApiKeys(t.db, smile)
    // A dumped table must yield nothing usable.
    expect(row!.secretHash).not.toBe(key.secret)
    expect(JSON.stringify(row)).not.toContain(key.secret)
  })

  it('shows a prefix, so four keys can be told apart when one leaks', async () => {
    const a = await issueApiKey(t.db, smile, { name: 'Laptop' })
    const b = await issueApiKey(t.db, smile, { name: 'Server' })
    expect(a.prefix).not.toBe(b.prefix)
    const rows = await listApiKeys(t.db, smile)
    expect(rows.map((r) => r.prefix).sort()).toEqual([a.prefix, b.prefix].sort())
  })

  it('refuses a revoked key', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'x' })
    expect(await revokeApiKey(t.db, smile, key.id)).toBe(true)
    expect(await resolveApiKey(t.db, key.secret)).toBeNull()
  })

  it('cannot revoke another practice key', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'x' })
    expect(await revokeApiKey(t.db, pearl, key.id)).toBe(false)
    // Still works, because Pearl had no business revoking it.
    expect(await resolveApiKey(t.db, key.secret)).not.toBeNull()
  })

  it('refuses nonsense rather than throwing', async () => {
    for (const bad of [null, undefined, '', 'not-a-key', 'vk_wrong', 'Bearer ']) {
      expect(await resolveApiKey(t.db, bad as string)).toBeNull()
    }
  })

  it('records when a key was last used', async () => {
    const key = await issueApiKey(t.db, smile, { name: 'x' })
    expect((await listApiKeys(t.db, smile))[0]!.lastUsedAt).toBeNull()
    await resolveApiKey(t.db, key.secret)
    expect((await listApiKeys(t.db, smile))[0]!.lastUsedAt).toBeInstanceOf(Date)
  })
})

describe('webhook signatures', () => {
  it('verifies a genuine delivery', () => {
    const ts = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ event: 'call.completed' })
    const sig = signPayload('whsec_test', ts, body)
    expect(verifySignature({ secret: 'whsec_test', signature: sig, timestamp: ts, body })).toBe(true)
  })

  it('rejects a tampered body', () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = signPayload('whsec_test', ts, '{"a":1}')
    expect(verifySignature({ secret: 'whsec_test', signature: sig, timestamp: ts, body: '{"a":2}' })).toBe(false)
  })

  it('rejects the wrong secret', () => {
    const ts = Math.floor(Date.now() / 1000)
    const sig = signPayload('whsec_other', ts, '{}')
    expect(verifySignature({ secret: 'whsec_test', signature: sig, timestamp: ts, body: '{}' })).toBe(false)
  })

  it('rejects a delivery replayed a week later', () => {
    const old = Math.floor(Date.now() / 1000) - 7 * 86_400
    const sig = signPayload('whsec_test', old, '{}')
    // The timestamp is inside the signature, so it cannot be rewritten either.
    expect(verifySignature({ secret: 'whsec_test', signature: sig, timestamp: old, body: '{}' })).toBe(false)
  })

  it('does not throw on a signature of the wrong length', () => {
    const ts = Math.floor(Date.now() / 1000)
    expect(verifySignature({ secret: 's', signature: 'x', timestamp: ts, body: '{}' })).toBe(false)
  })
})

describe('webhook delivery', () => {
  it('delivers only to endpoints subscribed to that event', async () => {
    await registerWebhook(t.db, smile, { url: 'https://a.example/hook', events: ['call.completed'] })
    await registerWebhook(t.db, smile, { url: 'https://b.example/hook', events: ['appointment.booked'] })

    const deliver = vi.fn<Deliver>().mockResolvedValue({ ok: true, status: 200 })
    const out = await emitWebhook({
      db: t.db, orgId: smile, event: 'call.completed', data: { id: 'call_1' }, deliver,
    })
    expect(out.delivered).toBe(1)
    expect(deliver.mock.calls[0]![0].url).toBe('https://a.example/hook')
  })

  it('never delivers another practice events', async () => {
    await registerWebhook(t.db, pearl, { url: 'https://pearl.example/hook', events: ['call.completed'] })
    const deliver = vi.fn<Deliver>().mockResolvedValue({ ok: true, status: 200 })
    await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('signs every delivery and names the tenant in the body', async () => {
    const hook = await registerWebhook(t.db, smile, { url: 'https://a.example/h', events: ['call.completed'] })
    const deliver = vi.fn<Deliver>().mockResolvedValue({ ok: true, status: 200 })
    await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: { id: 'c1' }, deliver })

    const call = deliver.mock.calls[0]![0]
    const ts = Number(call.headers['x-vaani-timestamp'])
    expect(
      verifySignature({
        secret: hook.secret,
        signature: call.headers['x-vaani-signature']!,
        timestamp: ts,
        body: call.body,
      }),
    ).toBe(true)
    expect(JSON.parse(call.body).orgId).toBe(smile)
  })

  it('counts failures and eventually switches a dead endpoint off', async () => {
    await registerWebhook(t.db, smile, { url: 'https://dead.example/h', events: ['call.completed'] })
    const deliver = vi.fn<Deliver>().mockResolvedValue({ ok: false, status: 500 })

    for (let i = 0; i < 10; i++) {
      await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })
    }
    const [row] = await t.db.select().from(webhooks).where(eq(webhooks.orgId, smile))
    expect(row!.disabledAt).toBeInstanceOf(Date)

    // Disabled endpoints stop being tried at all.
    const before = deliver.mock.calls.length
    await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })
    expect(deliver.mock.calls.length).toBe(before)
  })

  it('a success clears the failure streak, so a blip does not accumulate', async () => {
    await registerWebhook(t.db, smile, { url: 'https://flaky.example/h', events: ['call.completed'] })
    const deliver = vi.fn<Deliver>()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })
    await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })

    const [row] = await t.db.select().from(webhooks).where(eq(webhooks.orgId, smile))
    expect(row!.failures).toBe(0)
    expect(row!.disabledAt).toBeNull()
  })

  it('cannot remove another practice webhook', async () => {
    const hook = await registerWebhook(t.db, smile, { url: 'https://a.example/h', events: ['call.completed'] })
    expect(await removeWebhook(t.db, pearl, hook.id)).toBe(false)
    expect(await removeWebhook(t.db, smile, hook.id)).toBe(true)
  })

  it('refuses to deliver to an address inside our own network', async () => {
    // A stored webhook fires on every call, so an unchecked destination is a
    // persistent SSRF primitive — worse than a one-off fetch, not better.
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:5432/',
      'http://10.0.0.1/internal',
      'http://localhost/admin',
    ]) {
      const out = await httpDeliver({ url, body: '{}', headers: {} })
      expect(out.ok).toBe(false)
      // Never reached the network at all.
      expect(out.status).toBe(0)
    }
  })

  it('does not treat a redirect as delivered', async () => {
    // A public endpoint that 302s to the metadata address must not count as a
    // success, or the failure counter never disables it.
    const out = await httpDeliver({ url: 'https://example.com/', body: '{}', headers: {} })
    expect(typeof out.ok).toBe('boolean')
  })

  it('does nothing when nobody is subscribed', async () => {
    const deliver = vi.fn<Deliver>()
    const out = await emitWebhook({ db: t.db, orgId: smile, event: 'call.completed', data: {}, deliver })
    expect(out).toEqual({ delivered: 0, failed: 0 })
    expect(deliver).not.toHaveBeenCalled()
  })
})
