import { describe, it, expect } from 'vitest'
import { streamUrl } from './stream-url'

/**
 * Where a patient's call audio is sent.
 *
 * The reason this is worth its own tests: an earlier version read the host from
 * `x-forwarded-host`, which on the dialler's path is whatever the caller sent.
 * Anyone able to reach that endpoint could have had live call audio streamed to
 * a host of their choosing, which is about as bad as a bug in this system gets.
 */
describe('streamUrl', () => {
  it('prefers what was configured deliberately', () => {
    expect(
      streamUrl({
        explicit: 'wss://voice.clinic.example/api/twilio/stream',
        platformHost: 'something-else.vercel.app',
        requestHost: 'attacker.example',
      }),
    ).toBe('wss://voice.clinic.example/api/twilio/stream')
  })

  it('uses the platform hostname over anything from the request', () => {
    expect(
      streamUrl({ platformHost: 'vaani.vercel.app', requestHost: 'attacker.example' }),
    ).toBe('wss://vaani.vercel.app/api/twilio/stream')
  })

  it('falls back to the request only when there is no platform to ask', () => {
    // Local development, where there is no attacker boundary to protect.
    expect(streamUrl({ requestHost: 'localhost:3000' })).toBe(
      'wss://localhost:3000/api/twilio/stream',
    )
  })

  it('refuses to guess rather than pointing audio somewhere arbitrary', () => {
    expect(() => streamUrl({})).toThrow(/TWILIO_STREAM_URL/)
  })

  it('takes the first entry when a header arrives as a list', () => {
    // A proxy chain appends; the first is the one that reached the edge.
    expect(streamUrl({ platformHost: 'vaani.vercel.app, inner.local' })).toBe(
      'wss://vaani.vercel.app/api/twilio/stream',
    )
  })
})
