import { safeParseClientEvent, type ClientEvent, type ServerEvent } from '@vaani/shared'
import type { Transport } from '@vaani/core'

/**
 * The shape `experimental_upgradeWebSocket` hands back.
 *
 * Narrower than the `ws` package's socket — enough of it to carry a call, and
 * nothing this adapter does not actually use.
 */
export interface UpgradedSocket {
  on(event: 'message', handler: (data: unknown, isBinary: boolean) => void): void
  on(event: 'close', handler: () => void): void
  on(event: 'error', handler: () => void): void
  send(data: string | Uint8Array): void
  close(): void
}

/**
 * The browser transport, for a call running inside a serverless function.
 *
 * Same wire protocol as the long-running server's: binary frames carry
 * canonical PCM16 at 16 kHz, text frames carry the control protocol. Only the
 * socket API underneath differs, which is the entire reason this file exists
 * rather than a second copy of the session logic.
 */
export class WsUpgradeTransport implements Transport {
  readonly channel = 'web' as const
  readonly supportsBargeIn = true

  private readonly audioHandlers: ((pcm: Int16Array) => void)[] = []
  private readonly eventHandlers: ((e: ClientEvent) => void)[] = []
  private readonly closeHandlers: (() => void)[] = []
  private open = true

  constructor(private readonly socket: UpgradedSocket) {
    socket.on('message', (data: unknown, isBinary: boolean) => {
      /**
       * Binary is audio; text is a control event — and only the flag says which.
       *
       * `ws` delivers *every* frame as a Buffer, text included; the string case
       * this used to test for never happens. So every control message the
       * console sent was read as audio instead: the language dropdown did
       * nothing mid-call, barge-in never learned what had actually been played,
       * and the JSON bytes went into Live as noise loud enough to derail a turn.
       * The standalone server has always keyed off `isBinary`; this adapter,
       * written later, guessed.
       */
      if (!isBinary) {
        let raw: unknown
        try {
          raw = JSON.parse(toText(data))
        } catch {
          return
        }
        const parsed = safeParseClientEvent(raw)
        // A malformed frame from a flaky client must never drop a live call.
        if (parsed.ok) for (const h of this.eventHandlers) h(parsed.event)
        return
      }

      const bytes = toBytes(data)
      if (!bytes || bytes.byteLength < 2) return
      // Copy into an aligned buffer: the incoming view may sit at an odd offset
      // or share a pooled allocation that is overwritten under load.
      const pcm = new Int16Array(bytes.byteLength >> 1)
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true)
      for (const h of this.audioHandlers) h(pcm)
    })

    const shut = () => {
      if (!this.open) return
      this.open = false
      for (const h of this.closeHandlers) h()
    }
    socket.on('close', shut)
    socket.on('error', shut)
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
    if (!this.open) return
    try {
      this.socket.send(JSON.stringify(event))
    } catch {
      /* the line went away between the check and the write */
    }
  }

  sendAudio(pcm: Int16Array): void {
    if (!this.open) return
    try {
      this.socket.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length * 2))
    } catch {
      /* as above */
    }
  }

  flushAudio(): void {
    // The browser client owns its playback queue and clears it on `tts.cancel`.
    // Nothing is buffered here to discard.
  }

  close(): void {
    this.open = false
    try {
      this.socket.close()
    } catch {
      /* already gone */
    }
  }
}

/** Reads a text frame, whichever shape the runtime hands it over in. */
function toText(data: unknown): string {
  if (typeof data === 'string') return data
  // `ws` may deliver a fragmented text frame as an array of chunks.
  if (Array.isArray(data)) return data.map(toText).join('')
  const bytes = toBytes(data)
  return bytes ? new TextDecoder().decode(bytes) : ''
}

/** Normalises whatever the runtime calls a binary frame into bytes. */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (Array.isArray(data)) {
    const parts = data.map(toBytes).filter((p): p is Uint8Array => p !== null)
    const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let at = 0
    for (const p of parts) {
      joined.set(p, at)
      at += p.byteLength
    }
    return joined
  }
  return null
}
