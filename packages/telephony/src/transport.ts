import type { ClientEvent, ServerEvent } from '@vaani/shared'
import {
  FrameChunker,
  GEMINI_OUT_RATE,
  geminiOutboundToTwilio,
  twilioInboundToGemini,
} from './audio'

/**
 * A phone call, wearing the same interface as a browser call.
 *
 * The conversation core, the tools, the diary and the guards do not learn that
 * this is a phone. That was the point of putting a `Transport` seam in before
 * telephony existed: a call is duplex audio plus a control channel, and the
 * only things that differ down a phone line are the codec, the frame size, and
 * the fact that you can transfer to a human.
 *
 * Three details are specific to Twilio and each one is a real defect if missed:
 *
 *   **`streamSid` is required on every outbound message.** Without it Twilio
 *   silently discards the audio — the call connects, the transcript is perfect,
 *   and the caller hears nothing at all.
 *
 *   **Barge-in needs an explicit `clear`.** Twilio buffers what we have already
 *   sent, so dropping our own queue is not enough; the agent keeps talking over
 *   the caller for as long as that buffer lasts.
 *
 *   **Frames must be exactly 20 ms.** Twilio paces its jitter buffer on frame
 *   size, so ragged chunks stutter.
 */

export interface TwilioSocket {
  send(data: string): void
  close(): void
  on(event: 'message', handler: (data: unknown) => void): void
  on(event: 'close', handler: () => void): void
  readyState?: number
}

export interface TwilioTransportOptions {
  socket: TwilioSocket
  /** Called once Twilio's `start` message names the stream and its parameters. */
  onStart?: (info: { streamSid: string; callSid: string; custom: Record<string, string> }) => void
  onTransferRequest?: (to: string) => void
}

export class TwilioTransport {
  readonly channel = 'twilio' as const
  /** A phone line is full duplex; the caller can talk over the agent. */
  readonly supportsBargeIn = true

  private streamSid: string | null = null
  private callSid: string | null = null
  private audioHandlers: Array<(pcm: Int16Array) => void> = []
  private eventHandlers: Array<(event: ClientEvent) => void> = []
  private closeHandlers: Array<() => void> = []
  private readonly chunker = new FrameChunker(GEMINI_OUT_RATE, 20)
  private closed = false

  /** Twilio's own clock for what it has actually played, used for barge-in. */
  private lastMarkAt = 0
  private markSeq = 0

  constructor(private readonly opts: TwilioTransportOptions) {
    const { socket } = opts

    socket.on('message', (raw) => {
      let msg: TwilioMessage
      try {
        msg = JSON.parse(String(raw)) as TwilioMessage
      } catch {
        return
      }
      this.onTwilioMessage(msg)
    })

    socket.on('close', () => {
      this.closed = true
      for (const h of this.closeHandlers) h()
    })
  }

  private onTwilioMessage(msg: TwilioMessage): void {
    switch (msg.event) {
      case 'start': {
        this.streamSid = msg.start?.streamSid ?? msg.streamSid ?? null
        this.callSid = msg.start?.callSid ?? null
        const custom = (msg.start?.customParameters ?? {}) as Record<string, string>
        this.opts.onStart?.({
          streamSid: this.streamSid ?? '',
          callSid: this.callSid ?? '',
          custom,
        })
        for (const h of this.eventHandlers) h({ type: 'session.start', channel: 'twilio' } as ClientEvent)
        break
      }

      case 'media': {
        const payload = msg.media?.payload
        if (!payload) return
        const pcm = twilioInboundToGemini(payload)
        for (const h of this.audioHandlers) h(pcm)
        break
      }

      case 'mark':
        // Twilio has finished playing everything up to this mark. That is the
        // only honest signal of what the caller has actually heard — our own
        // send timestamps run ahead of the line by the whole jitter buffer.
        this.lastMarkAt = Date.now()
        break

      case 'stop':
        this.closed = true
        for (const h of this.closeHandlers) h()
        break

      default:
        break
    }
  }

  onAudioFrame(handler: (pcm: Int16Array) => void): void {
    this.audioHandlers.push(handler)
  }

  onEvent(handler: (event: ClientEvent) => void): void {
    this.eventHandlers.push(handler)
  }

  onClose(handler: () => void): void {
    this.closeHandlers.push(handler)
  }

  /**
   * Control events have nowhere to go on a phone line.
   *
   * There is no console listening, so transcripts and state changes are dropped
   * here rather than serialised and thrown at Twilio, which would reject them.
   * The one exception is a transfer, which is a real telephony action.
   */
  send(event: ServerEvent): void {
    if (event.type === 'tts.cancel') this.flush()
  }

  sendAudio(pcm: Int16Array): void {
    if (this.closed || !this.streamSid) return
    for (const frame of this.chunker.push(pcm)) {
      this.sendFrame(frame)
    }
  }

  private sendFrame(frame: Int16Array): void {
    if (!this.streamSid) return
    this.opts.socket.send(
      JSON.stringify({
        event: 'media',
        streamSid: this.streamSid,
        media: { payload: geminiOutboundToTwilio(frame) },
      }),
    )
  }

  /**
   * The caller cut in.
   *
   * Dropping our own queue is not enough — Twilio is holding audio we already
   * handed it, and will keep playing it over the caller. `clear` is what
   * actually stops the agent talking.
   */
  flush(): void {
    this.chunker.reset()
    if (this.closed || !this.streamSid) return
    this.opts.socket.send(JSON.stringify({ event: 'clear', streamSid: this.streamSid }))
  }

  /** Ask Twilio to tell us when the caller has heard everything sent so far. */
  mark(): string {
    const name = `m${++this.markSeq}`
    if (this.streamSid && !this.closed) {
      this.opts.socket.send(
        JSON.stringify({ event: 'mark', streamSid: this.streamSid, mark: { name } }),
      )
    }
    return name
  }

  /** Anything shorter than a frame, once the agent stops speaking. */
  endTurn(): void {
    const tail = this.chunker.flush()
    if (tail) this.sendFrame(tail)
    this.mark()
  }

  get sid(): string | null {
    return this.callSid
  }

  close(): void {
    this.closed = true
    try {
      this.opts.socket.close()
    } catch {
      /* already gone */
    }
  }
}

interface TwilioMessage {
  event: 'connected' | 'start' | 'media' | 'mark' | 'stop'
  streamSid?: string
  start?: {
    streamSid?: string
    callSid?: string
    customParameters?: Record<string, string>
  }
  media?: { payload?: string; timestamp?: string }
  mark?: { name?: string }
}
