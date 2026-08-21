import { describe, expect, it, vi } from 'vitest'
import { TwilioTransport, type TwilioSocket } from './transport'
import { pcm16ToMulaw } from './audio'

/**
 * These pin the three Twilio-specific mistakes that all present as "the call
 * connected and the transcript looks perfect, but something is wrong with the
 * audio" — the hardest class of bug to diagnose from a phone call.
 */

function fakeSocket() {
  const sent: string[] = []
  const handlers: Record<string, ((data: unknown) => void)[]> = {}
  const socket: TwilioSocket = {
    send: (d) => sent.push(d),
    close: () => undefined,
    on: (event: string, handler: (data: unknown) => void) => {
      ;(handlers[event] ??= []).push(handler)
    },
  }
  const emit = (event: string, data: unknown) => {
    for (const h of handlers[event] ?? []) h(data)
  }
  const parsed = () => sent.map((s) => JSON.parse(s) as Record<string, unknown>)
  return { socket, sent, emit, parsed }
}

function start(f: ReturnType<typeof fakeSocket>, custom: Record<string, string> = {}) {
  f.emit(
    'message',
    JSON.stringify({
      event: 'start',
      start: { streamSid: 'MZ123', callSid: 'CA999', customParameters: custom },
    }),
  )
}

describe('TwilioTransport', () => {
  it('passes the tenant through from the stream parameters', () => {
    const f = fakeSocket()
    const onStart = vi.fn()
    new TwilioTransport({ socket: f.socket, onStart })
    start(f, { orgId: 'org_smile', callId: 'call_1', branchId: 'br_bandra' })

    expect(onStart).toHaveBeenCalledWith({
      streamSid: 'MZ123',
      callSid: 'CA999',
      custom: { orgId: 'org_smile', callId: 'call_1', branchId: 'br_bandra' },
    })
  })

  it('never sends audio without a streamSid — Twilio silently drops it', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    // No `start` yet.
    t.sendAudio(new Int16Array(480))
    expect(f.sent).toHaveLength(0)

    start(f)
    t.sendAudio(new Int16Array(480))
    const media = f.parsed().filter((m) => m.event === 'media')
    expect(media).toHaveLength(1)
    expect(media[0]!.streamSid).toBe('MZ123')
  })

  it('emits exactly 20 ms frames — 160 mu-law bytes each', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)

    // 1000 samples at 24 kHz is two whole 480-sample frames, 40 left over.
    t.sendAudio(new Int16Array(1000))
    const media = f.parsed().filter((m) => m.event === 'media')
    expect(media).toHaveLength(2)
    for (const m of media) {
      const payload = (m.media as { payload: string }).payload
      expect(Buffer.from(payload, 'base64')).toHaveLength(160)
    }
  })

  it('carries the remainder rather than padding mid-stream', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)
    t.sendAudio(new Int16Array(479))
    expect(f.parsed().filter((m) => m.event === 'media')).toHaveLength(0)
    t.sendAudio(new Int16Array(1))
    expect(f.parsed().filter((m) => m.event === 'media')).toHaveLength(1)
  })

  it('sends `clear` on barge-in — dropping our own queue is not enough', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)
    t.sendAudio(new Int16Array(480))

    t.send({ type: 'tts.cancel', utteranceId: 'u1', truncateAtMs: 0, spokenPrefix: '' } as never)

    const clears = f.parsed().filter((m) => m.event === 'clear')
    expect(clears).toHaveLength(1)
    expect(clears[0]!.streamSid).toBe('MZ123')
  })

  it('barge-in also drops carried audio, so it cannot leak into the next turn', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)
    t.sendAudio(new Int16Array(100)) // carried, not sent
    t.flush()
    t.endTurn()
    // endTurn would have flushed a padded frame if the carry had survived.
    expect(f.parsed().filter((m) => m.event === 'media')).toHaveLength(0)
  })

  it('decodes caller audio to 16 kHz PCM', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    const frames: Int16Array[] = []
    t.onAudioFrame((pcm) => frames.push(pcm))
    start(f)

    const mulaw = pcm16ToMulaw(Int16Array.from({ length: 160 }, (_, i) => i * 100))
    f.emit(
      'message',
      JSON.stringify({
        event: 'media',
        media: { payload: Buffer.from(mulaw).toString('base64') },
      }),
    )
    expect(frames).toHaveLength(1)
    // 160 samples at 8 kHz upsampled to 16 kHz.
    expect(frames[0]).toHaveLength(320)
  })

  it('reports close when Twilio stops the stream', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    const onClose = vi.fn()
    t.onClose(onClose)
    start(f)
    f.emit('message', JSON.stringify({ event: 'stop' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('ignores malformed frames rather than dropping the call', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)
    expect(() => f.emit('message', 'not json at all')).not.toThrow()
    expect(() => f.emit('message', JSON.stringify({ event: 'media' }))).not.toThrow()
  })

  it('stops sending once closed', () => {
    const f = fakeSocket()
    const t = new TwilioTransport({ socket: f.socket })
    start(f)
    f.emit('message', JSON.stringify({ event: 'stop' }))
    const before = f.sent.length
    t.sendAudio(new Int16Array(480))
    expect(f.sent).toHaveLength(before)
  })
})
