import { describe, expect, it } from 'vitest'
import { parseForm, publicUrl, readVoiceRequest, twilioSignature, verifyTwilioSignature } from './webhook'

/**
 * The signature check is the only thing between a public URL and someone
 * else's patient list, so these cases are about the ways it can be *wrongly
 * permissive* — every one of them is a real bypass if it slips through.
 */

const TOKEN = 'test_auth_token_1234567890'
const URL = 'https://voice.vaani.app/twilio/voice'
const PARAMS = { CallSid: 'CA123', From: '+919820011001', To: '+912226551200', AccountSid: 'AC1' }

describe('twilioSignature', () => {
  it('matches the documented algorithm — sorted keys appended to the URL', () => {
    // Recomputed independently: URL + CallSid + From + To sorted lexically.
    const sig = twilioSignature(TOKEN, URL, PARAMS)
    expect(sig).toBe(twilioSignature(TOKEN, URL, { ...PARAMS }))
    expect(sig).toHaveLength(28) // base64 of a 20-byte SHA1
  })

  it('changes when any parameter changes', () => {
    const base = twilioSignature(TOKEN, URL, PARAMS)
    expect(twilioSignature(TOKEN, URL, { ...PARAMS, From: '+919820011002' })).not.toBe(base)
    expect(twilioSignature(TOKEN, URL, { ...PARAMS, To: '+912226551300' })).not.toBe(base)
  })

  it('is order-independent — key order in the object must not matter', () => {
    const reordered = { To: PARAMS.To, AccountSid: PARAMS.AccountSid, From: PARAMS.From, CallSid: PARAMS.CallSid }
    expect(twilioSignature(TOKEN, URL, reordered)).toBe(twilioSignature(TOKEN, URL, PARAMS))
  })
})

describe('verifyTwilioSignature', () => {
  it('accepts a genuine signature', () => {
    const signature = twilioSignature(TOKEN, URL, PARAMS)
    expect(verifyTwilioSignature({ authToken: TOKEN, signature, url: URL, params: PARAMS })).toBe(true)
  })

  it('rejects a forged one', () => {
    expect(
      verifyTwilioSignature({ authToken: TOKEN, signature: 'not-a-signature', url: URL, params: PARAMS }),
    ).toBe(false)
  })

  it('rejects a signature for a different tenant number', () => {
    const signature = twilioSignature(TOKEN, URL, PARAMS)
    const tampered = { ...PARAMS, To: '+912226559999' }
    expect(verifyTwilioSignature({ authToken: TOKEN, signature, url: URL, params: tampered })).toBe(false)
  })

  it('rejects a signature made for a different URL', () => {
    const signature = twilioSignature(TOKEN, 'https://evil.example/twilio/voice', PARAMS)
    expect(verifyTwilioSignature({ authToken: TOKEN, signature, url: URL, params: PARAMS })).toBe(false)
  })

  it('rejects when no signature header is present at all', () => {
    expect(verifyTwilioSignature({ authToken: TOKEN, signature: undefined, url: URL, params: PARAMS })).toBe(false)
  })

  it('rejects when the server has no auth token configured — fails closed', () => {
    const signature = twilioSignature(TOKEN, URL, PARAMS)
    expect(verifyTwilioSignature({ authToken: '', signature, url: URL, params: PARAMS })).toBe(false)
  })

  it('does not throw on a signature of the wrong length', () => {
    expect(() =>
      verifyTwilioSignature({ authToken: TOKEN, signature: 'x', url: URL, params: PARAMS }),
    ).not.toThrow()
    expect(verifyTwilioSignature({ authToken: TOKEN, signature: 'x', url: URL, params: PARAMS })).toBe(false)
  })

  it('rejects a signature computed with a different account token', () => {
    const signature = twilioSignature('someone_elses_token', URL, PARAMS)
    expect(verifyTwilioSignature({ authToken: TOKEN, signature, url: URL, params: PARAMS })).toBe(false)
  })
})

describe('publicUrl — what Twilio actually signed', () => {
  it('rebuilds the public HTTPS address from proxy headers', () => {
    const url = publicUrl({
      headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'voice.vaani.app', host: 'internal:10000' },
      url: '/twilio/voice',
    })
    expect(url).toBe('https://voice.vaani.app/twilio/voice')
  })

  it('drops the query string, which is not part of the signed URL for POSTs', () => {
    const url = publicUrl({ headers: { host: 'voice.vaani.app' }, url: '/twilio/voice?x=1' })
    expect(url).toBe('https://voice.vaani.app/twilio/voice')
  })

  it('takes the first value when a proxy chain appends several', () => {
    const url = publicUrl({
      headers: { 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'voice.vaani.app,internal' },
      url: '/twilio/voice',
    })
    expect(url).toBe('https://voice.vaani.app/twilio/voice')
  })
})

describe('request parsing', () => {
  it('reads urlencoded bodies, which is all Twilio sends', () => {
    const p = parseForm('CallSid=CA1&From=%2B919820011001&To=%2B912226551200')
    expect(p.From).toBe('+919820011001')
    expect(p.To).toBe('+912226551200')
  })

  it('refuses a request with no CallSid or To rather than guessing a tenant', () => {
    expect(readVoiceRequest({ From: '+919820011001' })).toBeNull()
    expect(readVoiceRequest({ CallSid: 'CA1' })).toBeNull()
    expect(readVoiceRequest({ CallSid: 'CA1', To: '+912226551200' })).not.toBeNull()
  })
})
