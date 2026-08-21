import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Proving a webhook really came from Twilio.
 *
 * Without this the voice endpoint is an open door: anyone who learns the URL
 * can POST a forged `From`/`To` and make the agent answer as any tenant, read
 * that tenant's diary down the phone, and spend the practice's model quota
 * doing it. The signature is the only thing standing between a public HTTP
 * endpoint and someone else's patient list.
 *
 * Twilio signs the full request URL concatenated with every POST parameter in
 * lexical order by key, HMAC-SHA1 under the account auth token. Reimplemented
 * here rather than pulled from the SDK so the voice server does not take a
 * heavyweight dependency for forty lines, and so the comparison is provably
 * constant-time.
 */

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function verifyTwilioSignature(input: {
  authToken: string
  signature: string | undefined
  url: string
  params: Record<string, string>
}): boolean {
  if (!input.signature || !input.authToken) return false
  const expected = twilioSignature(input.authToken, input.url, input.params)
  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  // Length differs → definitely not equal, and timingSafeEqual throws on
  // mismatched lengths rather than returning false.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * The URL Twilio signed, which is not always the URL the process received.
 *
 * Behind a load balancer the request arrives as plain HTTP on some internal
 * port, while Twilio signed the public HTTPS address. Reconstructing from the
 * forwarded headers is what makes signature checks work in production instead
 * of only on a laptop — and getting this wrong fails closed, which reads as
 * "Twilio is broken" rather than "the proxy rewrote the scheme".
 */
export function publicUrl(req: {
  headers: Record<string, string | string[] | undefined>
  url?: string
}, fallbackHost?: string): string {
  const header = (name: string): string | undefined => {
    const v = req.headers[name]
    return Array.isArray(v) ? v[0] : v
  }
  const proto = header('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'https'
  const host = header('x-forwarded-host')?.split(',')[0]?.trim() ?? header('host') ?? fallbackHost ?? ''
  const path = (req.url ?? '/').split('?')[0]
  return `${proto}://${host}${path}`
}

/** Twilio posts `application/x-www-form-urlencoded`, never JSON. */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(body)) out[k] = v
  return out
}

export interface TwilioVoiceRequest {
  CallSid: string
  AccountSid: string
  From: string
  To: string
  CallStatus: string
  Direction?: string
  ForwardedFrom?: string
  CallerName?: string
}

export function readVoiceRequest(params: Record<string, string>): TwilioVoiceRequest | null {
  if (!params.CallSid || !params.To) return null
  return {
    CallSid: params.CallSid,
    AccountSid: params.AccountSid ?? '',
    From: params.From ?? '',
    To: params.To,
    CallStatus: params.CallStatus ?? '',
    Direction: params.Direction,
    ForwardedFrom: params.ForwardedFrom,
    CallerName: params.CallerName,
  }
}
