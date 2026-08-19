import type { WebSocket } from 'ws'
import { safeParseClientEvent, type ClientEvent, type ServerEvent } from '@vaani/shared'
import type { Transport } from '@vaani/core'

/**
 * Browser WebSocket transport.
 *
 * The first `Transport` implementation, and the reference for the telephony
 * ones. Binary frames carry canonical PCM16 16 kHz; text frames carry the
 * control protocol.
 *
 * Note what is *not* here: no turn-taking, no agent, no provider logic. If a
 * later transport needs any of that, it belongs in `Session`, not in an
 * adapter.
 */
export class WsTransport implements Transport {
  readonly channel = 'web' as const
  readonly supportsBargeIn = true

  /**
   * Handler *lists*, not single slots.
   *
   * Storing one handler per channel meant a second subscriber silently
   * replaced the first — a diagnostic probe registered alongside the session
   * disabled the session's own audio path, with no error anywhere. Anything
   * that can be registered twice must support being registered twice.
   */
  private readonly audioHandlers: ((pcm: Int16Array) => void)[] = []
  private readonly eventHandlers: ((e: ClientEvent) => void)[] = []
  private readonly closeHandlers: (() => void)[] = []

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Copy into an aligned buffer: `ws` hands back views into a shared
        // pooled allocation, which would be overwritten under load.
        const pcm = new Int16Array(data.byteLength / 2)
        for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2)
        for (const h of this.audioHandlers) h(pcm)
        return
      }

      let raw: unknown
      try {
        raw = JSON.parse(data.toString('utf8'))
      } catch {
        return
      }
      const parsed = safeParseClientEvent(raw)
      // A malformed frame from a flaky client must never drop a live call.
      if (parsed.ok) for (const h of this.eventHandlers) h(parsed.event)
    })

    socket.on('close', () => this.closeHandlers.forEach((h) => h()))
    socket.on('error', () => this.closeHandlers.forEach((h) => h()))
  }

  onAudioFrame(handler: (pcm: Int16Array) => void): void {
    this.audioHandlers.push(handler)
  }

  onEvent(handler: (e: ClientEvent) => void): void {
    this.eventHandlers.push(handler)
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler)
  }

  send(event: ServerEvent): void {
    if (this.socket.readyState !== 1) return
    this.socket.send(JSON.stringify(event))
  }

  sendAudio(pcm: Int16Array): void {
    if (this.socket.readyState !== 1) return
    this.socket.send(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2), { binary: true })
  }

  flushAudio(): void {
    // The browser client owns its own playback queue and clears it on
    // `tts.cancel`. Nothing is buffered server-side to discard.
  }

  close(): void {
    this.socket.close()
  }
}
