/**
 * TwiML — the instructions Twilio executes for a call.
 *
 * Hand-built rather than taken from the SDK's builder, for one reason that
 * matters: everything interpolated here comes off a phone network or out of a
 * tenant's own settings, and TwiML is XML. A practice that names a branch
 * `Bandra & Khar` would otherwise emit malformed XML and drop the call, and a
 * hostile value could rewrite the verbs. Every insertion point goes through
 * `xml()`.
 */

export function xml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function doc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`
}

/**
 * Hand the call to the agent.
 *
 * `<Connect><Stream>` is bidirectional — the caller's audio arrives on the
 * socket and the agent's audio goes back down it. `<Start><Stream>` is a
 * one-way tap and cannot speak, which is the mistake that produces a call where
 * the transcript is perfect and the caller hears nothing.
 *
 * Custom parameters ride along on the socket's `start` message, which is how
 * the stream handler learns which tenant and which call row it belongs to
 * without a second lookup.
 */
export function connectStream(opts: {
  wsUrl: string
  callId: string
  orgId: string
  branchId?: string | null
}): string {
  const params = [
    `<Parameter name="callId" value="${xml(opts.callId)}"/>`,
    `<Parameter name="orgId" value="${xml(opts.orgId)}"/>`,
    opts.branchId ? `<Parameter name="branchId" value="${xml(opts.branchId)}"/>` : '',
  ].join('')
  return doc(`<Connect><Stream url="${xml(opts.wsUrl)}">${params}</Stream></Connect>`)
}

/**
 * Say something and hang up.
 *
 * Used when the call cannot proceed at all — an unrecognised number, or the
 * agent being unavailable. Twilio's own TTS, because at this point there is no
 * session to synthesise with.
 */
export function sayAndHangUp(message: string, language = 'en-IN'): string {
  return doc(`<Say language="${xml(language)}">${xml(message)}</Say><Hangup/>`)
}

/**
 * Put the caller through to a human.
 *
 * `<Dial>` with an action URL so the outcome comes back to us: a transfer that
 * rings out is the case that matters, and without the callback the call simply
 * ends and the practice never learns the patient went unanswered.
 */
export function transferTo(opts: {
  to: string
  callerId?: string
  actionUrl?: string
  timeoutSec?: number
  whisper?: string
}): string {
  const attrs = [
    `timeout="${opts.timeoutSec ?? 25}"`,
    opts.callerId ? `callerId="${xml(opts.callerId)}"` : '',
    opts.actionUrl ? `action="${xml(opts.actionUrl)}"` : '',
    'answerOnBridge="true"',
  ]
    .filter(Boolean)
    .join(' ')

  const say = opts.whisper ? `<Say language="en-IN">${xml(opts.whisper)}</Say>` : ''
  return doc(`${say}<Dial ${attrs}>${xml(opts.to)}</Dial>`)
}

/** The transfer failed. Say so honestly rather than dropping the line. */
export function transferFailed(message: string): string {
  return doc(`<Say language="en-IN">${xml(message)}</Say><Hangup/>`)
}

export function hangUp(): string {
  return doc('<Hangup/>')
}

export const TWIML_CONTENT_TYPE = 'text/xml; charset=utf-8'
