import type { ClientEvent, ServerEvent } from '@vaani/shared'

/**
 * Transport — the channel abstraction, and the most important boundary in the
 * system.
 *
 * A browser WebSocket, a Twilio Media Stream, and a WhatsApp voice exchange are
 * all the same thing: a duplex stream of audio frames plus a control channel.
 * Every one of them differs in codec, sample rate, and framing — and none of
 * those details belong anywhere near turn-taking or agent logic.
 *
 * So `Session` is written against this interface alone. Adding telephony is an
 * adapter that transcodes μ-law 8 kHz to canonical PCM16 16 kHz at its own
 * edge. It is not a second pipeline, and it is not a rewrite.
 */
export interface Transport {
  readonly channel: 'web' | 'twilio' | 'whatsapp'

  /**
   * Whether the caller can interrupt mid-utterance. True for full-duplex
   * channels; false for WhatsApp voice notes, where the exchange is turn-based
   * and barge-in is meaningless.
   */
  readonly supportsBargeIn: boolean

  /** Inbound caller audio, already normalised to PCM16 mono 16 kHz. */
  onAudioFrame(handler: (pcm: Int16Array) => void): void

  /** Inbound control events, already validated against the protocol schema. */
  onEvent(handler: (event: ClientEvent) => void): void

  onClose(handler: () => void): void

  /** Outbound control event. */
  send(event: ServerEvent): void

  /** Outbound agent audio, canonical PCM16 — the adapter transcodes if needed. */
  sendAudio(pcm: Int16Array): void

  /**
   * Discard any audio already handed to the transport but not yet heard.
   *
   * Essential for barge-in: without it, audio buffered in a jitter queue or in
   * the carrier's own buffer keeps playing after the caller has interrupted,
   * and the agent talks over them for another half second.
   */
  flushAudio(): void

  close(): void
}
