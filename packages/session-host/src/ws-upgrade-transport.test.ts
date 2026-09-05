import { describe, expect, it } from 'vitest'
import { WsUpgradeTransport, type UpgradedSocket } from './ws-upgrade-transport'
import type { ClientEvent } from '@vaani/shared'

/** A socket that lets a test hand the transport whatever `ws` would hand it. */
function fakeSocket(): {
  socket: UpgradedSocket
  deliver: (data: unknown, isBinary: boolean) => void
  sent: (string | Uint8Array)[]
} {
  let onMessage: (data: unknown, isBinary: boolean) => void = () => {}
  const sent: (string | Uint8Array)[] = []
  const socket: UpgradedSocket = {
    on(event: string, handler: (...args: never[]) => void) {
      if (event === 'message') {
        onMessage = handler as unknown as (d: unknown, b: boolean) => void
      }
    },
    send: (data) => void sent.push(data),
    close: () => {},
  } as UpgradedSocket
  return { socket, deliver: (data, isBinary) => onMessage(data, isBinary), sent }
}

function wire(): {
  deliver: (data: unknown, isBinary: boolean) => void
  events: ClientEvent[]
  audio: Int16Array[]
} {
  const { socket, deliver } = fakeSocket()
  const transport = new WsUpgradeTransport(socket)
  const events: ClientEvent[] = []
  const audio: Int16Array[] = []
  transport.onEvent((e) => void events.push(e))
  transport.onAudioFrame((pcm) => void audio.push(pcm))
  return { deliver, events, audio }
}

describe('WsUpgradeTransport', () => {
  /**
   * The bug this file exists for.
   *
   * `ws` hands every frame over as a Buffer, text included, and says which is
   * which only through `isBinary`. Deciding by `typeof data === 'string'` meant
   * that test never passed: on the deployed console every control message —
   * the language the caller picked, how much of a reply had actually played,
   * the end of the call — was read as audio and fed to the model as noise.
   */
  it('reads a text frame delivered as a Buffer as a control event', () => {
    const { deliver, events, audio } = wire()

    deliver(Buffer.from(JSON.stringify({ type: 'control.set_lang', lang: 'hi-IN' })), false)

    expect(events).toEqual([{ type: 'control.set_lang', lang: 'hi-IN' }])
    expect(audio).toHaveLength(0)
  })

  it('still reads a text frame delivered as a string', () => {
    const { deliver, events } = wire()

    deliver(JSON.stringify({ type: 'control.interrupt' }), false)

    expect(events).toEqual([{ type: 'control.interrupt' }])
  })

  it('reads a binary frame as PCM, little-endian', () => {
    const { deliver, events, audio } = wire()
    const pcm = new Int16Array([0, 1000, -1000, 32767])

    deliver(Buffer.from(pcm.buffer.slice(0)), true)

    expect(audio).toHaveLength(1)
    expect(Array.from(audio[0]!)).toEqual([0, 1000, -1000, 32767])
    expect(events).toHaveLength(0)
  })

  it('joins a fragmented frame rather than dropping it', () => {
    const { deliver, events } = wire()
    const json = JSON.stringify({ type: 'playback.complete', utteranceId: 'u1' })

    deliver([Buffer.from(json.slice(0, 10)), Buffer.from(json.slice(10))], false)

    expect(events).toEqual([{ type: 'playback.complete', utteranceId: 'u1' }])
  })

  it('drops a malformed frame instead of failing the call', () => {
    const { deliver, events, audio } = wire()

    deliver(Buffer.from('not json at all'), false)
    deliver(Buffer.from(JSON.stringify({ type: 'no.such.event' })), false)

    expect(events).toHaveLength(0)
    expect(audio).toHaveLength(0)
  })

  it('ignores a binary frame too short to hold a sample', () => {
    const { deliver, audio } = wire()

    deliver(Buffer.from([1]), true)

    expect(audio).toHaveLength(0)
  })

  /**
   * `ws` reuses a pooled allocation for inbound frames, so a transport that
   * kept a view over it would see decoded audio change underneath it.
   */
  it('copies audio out of the incoming buffer', () => {
    const { deliver, audio } = wire()
    const buf = Buffer.from(new Int16Array([500, 600]).buffer.slice(0))

    deliver(buf, true)
    buf.writeInt16LE(-1, 0)

    expect(audio[0]![0]).toBe(500)
  })
})
