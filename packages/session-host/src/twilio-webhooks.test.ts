import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { OrgRepo, resetDatabase, seedOrganization, useDatabase, SMILE_DENTAL } from '@vaani/db'
// The harness is a separate entry point on purpose: pglite is a test
// dependency and must never be reachable from the production barrel.
import { createTestDb, type TestDb } from '@vaani/db/testing'
import { twilioSignature } from '@vaani/telephony'

/**
 * The inbound call path, end to end, against a real database.
 *
 * Two tenants are always present. The question these answer is not "does the
 * handler run" but "can a caller, or a forged request, reach the wrong
 * practice's data" — which is the failure that matters and the one a
 * single-tenant fixture cannot catch.
 *
 * The module is imported dynamically after `useDatabase`, because it reads the
 * handle at call time and a static import would bind the real connection first.
 */

const TOKEN = 'test_twilio_auth_token'
const STREAM_URL = 'wss://voice.test/twilio/stream'
const SMILE_NUMBER = '+912226551200'
const PEARL_NUMBER = '+912226559999'

let t: TestDb
let smile: OrgRepo
let pearl: OrgRepo
let handlers: typeof import('./twilio-webhooks')

beforeEach(async () => {
  process.env.TWILIO_AUTH_TOKEN = TOKEN
  t = await createTestDb()
  useDatabase(t.db)

  const a = await seedOrganization(t.db, { ...SMILE_DENTAL, phoneNumbers: [SMILE_NUMBER] })
  const b = await seedOrganization(t.db, {
    slug: 'pearl',
    name: 'Pearl Dental',
    phoneNumbers: [PEARL_NUMBER],
    branches: [{ key: 'main', name: 'Pearl — Colaba', area: 'Colaba', city: 'Mumbai' }],
    providers: [{ key: 'khan', name: 'Dr. Sara Khan', title: 'General Dentist' }],
    services: [{ key: 'clean', name: 'Cleaning', durationMin: 30 }],
  })
  smile = new OrgRepo(t.db, a.orgId)
  pearl = new OrgRepo(t.db, b.orgId)

  handlers = await import('./twilio-webhooks')
})

afterEach(async () => {
  resetDatabase()
  await t.close()
})

/** A Twilio POST, signed unless told otherwise. */
function request(params: Record<string, string>, opts: { sign?: boolean; path?: string } = {}) {
  const path = opts.path ?? '/twilio/voice'
  const url = `https://voice.test${path}`
  const body = new URLSearchParams(params).toString()
  const signature = opts.sign === false ? 'bogus' : twilioSignature(TOKEN, url, params)

  const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
  req.headers = {
    host: 'voice.test',
    'x-forwarded-proto': 'https',
    'x-twilio-signature': signature,
    'content-type': 'application/x-www-form-urlencoded',
  }
  req.url = path
  req.method = 'POST'

  let status = 0
  let payload = ''
  const res = {
    writeHead(code: number) {
      status = code
      return this
    },
    end(chunk?: string) {
      if (chunk) payload = chunk
      return this
    },
  } as unknown as ServerResponse

  return { req, res, get status() { return status }, get body() { return payload } }
}

const inbound = (to: string, from = '+919820011001', sid = 'CA_test_1') => ({
  CallSid: sid,
  AccountSid: 'AC1',
  From: from,
  To: to,
  CallStatus: 'ringing',
})

describe('POST /twilio/voice', () => {
  it('answers a genuine call with a stream pointed at the right tenant', async () => {
    const r = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    expect(r.status).toBe(200)
    expect(r.body).toContain('<Connect>')
    expect(r.body).toContain(STREAM_URL)
    expect(r.body).toContain(`value="${smile.orgId}"`)
    expect(r.body).not.toContain(pearl.orgId)
  })

  it('routes each number to its own practice', async () => {
    const a = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(a.req, a.res, { streamUrl: STREAM_URL })
    const b = request(inbound(PEARL_NUMBER, '+919820011002', 'CA_test_2'))
    await handlers.handleVoice(b.req, b.res, { streamUrl: STREAM_URL })

    expect(a.body).toContain(smile.orgId)
    expect(b.body).toContain(pearl.orgId)
    expect(b.body).not.toContain(smile.orgId)
  })

  it('rejects an unsigned request — this is the whole security boundary', async () => {
    const r = request(inbound(SMILE_NUMBER), { sign: false })
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    expect(r.status).toBe(403)
    expect(r.body).not.toContain(smile.orgId)
    // And no call row was opened for a request we could not authenticate.
    expect(await smile.recentCalls()).toHaveLength(0)
  })

  it('rejects a request signed with the wrong account token', async () => {
    const params = inbound(SMILE_NUMBER)
    const r = request(params)
    r.req.headers['x-twilio-signature'] = twilioSignature('someone_else', 'https://voice.test/twilio/voice', params)
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })
    expect(r.status).toBe(403)
  })

  it('fails closed when the server has no auth token configured', async () => {
    // Read per request, so unsetting it takes effect without reimporting.
    delete process.env.TWILIO_AUTH_TOKEN
    const r = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })
    expect(r.status).toBe(403)
    expect(await smile.recentCalls()).toHaveLength(0)
  })

  it('hangs up politely on a number no tenant owns', async () => {
    const r = request(inbound('+912200000000'))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    expect(r.status).toBe(200)
    expect(r.body).toContain('<Hangup/>')
    expect(r.body).not.toContain('<Connect>')
  })

  it('opens a call record and a trace under the resolved tenant only', async () => {
    const r = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    const mine = await smile.recentCalls()
    expect(mine).toHaveLength(1)
    expect(mine[0]!.channel).toBe('twilio')
    expect(mine[0]!.externalId).toBe('CA_test_1')
    expect(mine[0]!.fromNumber).toBe('+919820011001')
    expect(await pearl.recentCalls()).toHaveLength(0)

    expect((await smile.callTrace(mine[0]!.id)).map((e) => e.kind)).toContain('inbound')
  })

  it('recognises a returning caller by their number', async () => {
    const known = await smile.createPatient({ name: 'Ravi Menon', phone: '+919820011001' })
    const r = request(inbound(SMILE_NUMBER, '+919820011001'))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    const [call] = await smile.recentCalls()
    expect(call!.patientId).toBe(known.id)
  })

  it('does not attach a patient from another practice with the same number', async () => {
    await pearl.createPatient({ name: 'Someone Else', phone: '+919820011001' })
    const r = request(inbound(SMILE_NUMBER, '+919820011001'))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })

    const [call] = await smile.recentCalls()
    expect(call!.patientId).toBeNull()
  })

  it('escapes tenant names so a practice cannot break the TwiML', async () => {
    const r = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(r.req, r.res, { streamUrl: STREAM_URL })
    // Well-formed enough that every opened tag is closed.
    expect(r.body.match(/<Response>/g)).toHaveLength(1)
    expect(r.body.match(/<\/Response>/g)).toHaveLength(1)
  })
})

describe('POST /twilio/status', () => {
  it('records duration against the right call', async () => {
    const v = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(v.req, v.res, { streamUrl: STREAM_URL })
    const [call] = await smile.recentCalls()

    const s = request(
      { CallSid: 'CA_test_1', To: SMILE_NUMBER, CallStatus: 'completed', CallDuration: '47' },
      { path: '/twilio/status' },
    )
    await handlers.handleStatus(s.req, s.res)

    const after = await smile.call(call!.id)
    expect(after!.durationSec).toBe(47)
    expect(after!.outcome).toBe('answered')
  })

  it('rejects an unsigned status callback', async () => {
    const s = request({ CallSid: 'CA_test_1', To: SMILE_NUMBER }, { path: '/twilio/status', sign: false })
    await handlers.handleStatus(s.req, s.res)
    expect(s.status).toBe(403)
  })
})

describe('POST /twilio/transfer', () => {
  it('raises an escalation when a transfer rings out', async () => {
    const v = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(v.req, v.res, { streamUrl: STREAM_URL })

    const r = request(
      { CallSid: 'CA_test_1', To: SMILE_NUMBER, DialCallStatus: 'no-answer' },
      { path: '/twilio/transfer' },
    )
    await handlers.handleTransferResult(r.req, r.res)

    const open = await smile.openEscalations()
    expect(open).toHaveLength(1)
    expect(open[0]!.urgency).toBe('high')
    expect(open[0]!.brief.recommendedAction).toMatch(/call this patient back/i)
    expect(r.body).toMatch(/call you back/i)
  })

  it('just hangs up when the transfer was answered', async () => {
    const v = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(v.req, v.res, { streamUrl: STREAM_URL })

    const r = request(
      { CallSid: 'CA_test_1', To: SMILE_NUMBER, DialCallStatus: 'completed' },
      { path: '/twilio/transfer' },
    )
    await handlers.handleTransferResult(r.req, r.res)

    expect(r.body).toContain('<Hangup/>')
    expect(await smile.openEscalations()).toHaveLength(0)
  })
})

describe('loadStreamContext — the media socket carries no proof of its own', () => {
  it('resolves a call issued by the webhook', async () => {
    const v = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(v.req, v.res, { streamUrl: STREAM_URL })
    const [call] = await smile.recentCalls()

    const ctx = await handlers.loadStreamContext({ orgId: smile.orgId, callId: call!.id })
    expect(ctx).not.toBeNull()
    expect(ctx!.adapter.name).toBe('Smile Dental Care')
    expect(ctx!.adapter.providers.some((p: { name: string }) => p.name === 'Dr. Kavita Iyer')).toBe(true)
  })

  it('refuses a call id paired with the wrong org', async () => {
    const v = request(inbound(SMILE_NUMBER))
    await handlers.handleVoice(v.req, v.res, { streamUrl: STREAM_URL })
    const [call] = await smile.recentCalls()

    // Pearl claiming Smile's call — the exact cross-tenant attempt to block.
    expect(await handlers.loadStreamContext({ orgId: pearl.orgId, callId: call!.id })).toBeNull()
  })

  it('refuses a fabricated call id', async () => {
    expect(await handlers.loadStreamContext({ orgId: smile.orgId, callId: 'call_made_up' })).toBeNull()
  })

  it('refuses parameters with no tenant at all', async () => {
    expect(await handlers.loadStreamContext({})).toBeNull()
  })
})

/**
 * The same handlers, reached through a Web `Request`.
 *
 * The phone line runs in a serverless route now, which speaks `Request` and
 * `Response` rather than Node's streams. The signature check is the security
 * boundary for the whole line, so what matters is that it survives the
 * adaptation intact — a forged request must still be refused after passing
 * through it, and a genuine one must still verify against the URL Twilio
 * actually signed rather than whatever internal address the platform used.
 */
describe('through the serverless adapter', () => {
  /** A Twilio POST as a Web Request, signed unless told otherwise. */
  function webRequest(params: Record<string, string>, opts: { sign?: boolean } = {}) {
    const signed = 'https://voice.test/api/twilio/voice'
    const body = new URLSearchParams(params).toString()
    return new Request('http://internal.local/api/twilio/voice', {
      method: 'POST',
      // The forwarded headers are what the signature must be checked against.
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'voice.test',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature':
          opts.sign === false ? 'bogus' : twilioSignature(TOKEN, signed, params),
      },
      body,
    })
  }

  it('answers a genuine call', async () => {
    const { runNodeWebhook } = await import('./node-webhook')
    const res = await runNodeWebhook(webRequest(inbound(SMILE_NUMBER)), (req, rs) =>
      handlers.handleVoice(req, rs, { streamUrl: STREAM_URL }),
    )
    expect(res.status).toBe(200)
    const twiml = await res.text()
    expect(twiml).toContain('<Stream')
    expect(twiml).toContain(STREAM_URL)
  })

  it('refuses a forged one', async () => {
    const { runNodeWebhook } = await import('./node-webhook')
    const res = await runNodeWebhook(webRequest(inbound(SMILE_NUMBER), { sign: false }), (req, rs) =>
      handlers.handleVoice(req, rs, { streamUrl: STREAM_URL }),
    )
    expect(res.status).toBe(403)
  })

  it('checks the signature against the forwarded address, not the internal one', async () => {
    // Signed for the internal host the platform used rather than the public one
    // Twilio saw. Accepting this would mean the check could be sidestepped by
    // anyone who could guess the internal address.
    const params = inbound(SMILE_NUMBER)
    const wrong = new Request('http://internal.local/api/twilio/voice', {
      method: 'POST',
      headers: {
        host: 'internal.local',
        'x-forwarded-host': 'voice.test',
        'x-forwarded-proto': 'https',
        'content-type': 'application/x-www-form-urlencoded',
        'x-twilio-signature': twilioSignature(
          TOKEN,
          'http://internal.local/api/twilio/voice',
          params,
        ),
      },
      body: new URLSearchParams(params).toString(),
    })
    const { runNodeWebhook } = await import('./node-webhook')
    const res = await runNodeWebhook(wrong, (req, rs) =>
      handlers.handleVoice(req, rs, { streamUrl: STREAM_URL }),
    )
    expect(res.status).toBe(403)
  })

  it('sets the content type TwiML needs', async () => {
    const { runNodeWebhook } = await import('./node-webhook')
    const res = await runNodeWebhook(webRequest(inbound(SMILE_NUMBER)), (req, rs) =>
      handlers.handleVoice(req, rs, { streamUrl: STREAM_URL }),
    )
    expect(res.headers.get('content-type')).toContain('xml')
  })
})
