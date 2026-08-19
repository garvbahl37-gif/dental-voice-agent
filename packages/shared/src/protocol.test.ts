import { describe, it, expect } from 'vitest'
import { parseClientEvent, safeParseClientEvent, parseServerEvent } from './protocol'

describe('parseClientEvent', () => {
  it('accepts a well-formed session.start', () => {
    const ev = parseClientEvent({ type: 'session.start', channel: 'web' })
    expect(ev.type).toBe('session.start')
  })

  it('defaults the channel to web', () => {
    const ev = parseClientEvent({ type: 'session.start' })
    expect(ev).toMatchObject({ channel: 'web' })
  })

  it('rejects an unknown event type', () => {
    expect(() => parseClientEvent({ type: 'nope' })).toThrow()
  })

  it('rejects a bare language code without a region', () => {
    expect(() => parseClientEvent({ type: 'control.set_lang', lang: 'hi' })).toThrow()
  })

  it('accepts Hinglish as a first-class language', () => {
    const ev = parseClientEvent({ type: 'control.set_lang', lang: 'hi-Latn-IN' })
    expect(ev).toMatchObject({ lang: 'hi-Latn-IN' })
  })

  it('rejects playback.progress with a negative position', () => {
    expect(() =>
      parseClientEvent({ type: 'playback.progress', utteranceId: 'u1', playedMs: -5 }),
    ).toThrow()
  })

  it('accepts playback.progress at zero', () => {
    const ev = parseClientEvent({ type: 'playback.progress', utteranceId: 'u1', playedMs: 0 })
    expect(ev).toMatchObject({ type: 'playback.progress', playedMs: 0 })
  })

  it('accepts a partial tier override', () => {
    const ev = parseClientEvent({ type: 'control.set_tier', tier: { tts: 'cloud' } })
    expect(ev).toMatchObject({ tier: { tts: 'cloud' } })
  })
})

describe('safeParseClientEvent', () => {
  it('reports failure instead of throwing, so one bad frame cannot drop a call', () => {
    const r = safeParseClientEvent({ type: 'garbage' })
    expect(r.ok).toBe(false)
  })

  it('returns the parsed event on success', () => {
    const r = safeParseClientEvent({ type: 'control.interrupt' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.event.type).toBe('control.interrupt')
  })
})

describe('parseServerEvent', () => {
  it('accepts tts.begin carrying word marks', () => {
    const ev = parseServerEvent({
      type: 'tts.begin',
      utteranceId: 'u1',
      turnId: 't1',
      text: 'Doctor Sharma is available',
      lang: 'en-IN',
      marks: [{ word: 'Doctor', startMs: 0, endMs: 400 }],
      cached: false,
    })
    expect(ev.type).toBe('tts.begin')
  })

  it('accepts tts.cancel with the spoken prefix', () => {
    const ev = parseServerEvent({
      type: 'tts.cancel',
      utteranceId: 'u1',
      truncateAtMs: 980,
      spokenPrefix: 'Doctor Sharma is—',
    })
    expect(ev).toMatchObject({ spokenPrefix: 'Doctor Sharma is—' })
  })

  it('rejects a ui.event with an unrecognised domain event', () => {
    expect(() =>
      parseServerEvent({ type: 'ui.event', event: 'appointment.exploded', payload: {} }),
    ).toThrow()
  })
})
