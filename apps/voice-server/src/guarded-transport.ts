import type { ClientEvent, Lang, ServerEvent } from '@vaani/shared'
import type { Transport } from '@vaani/core'
import { guard, speakable, type Violation } from '@vaani/agent'

/**
 * Wraps a transport so every outgoing utterance passes the clinical safety
 * guard before it can be synthesised.
 *
 * Placing the check here rather than inside the agent is deliberate. The agent
 * is a model, and a model can be argued out of its instructions. This is the
 * layer nothing routes around: if it does not pass here, it is never spoken,
 * regardless of what the prompt was persuaded to produce.
 */
export class GuardedTransport implements Transport {
  readonly channel: Transport['channel']
  readonly supportsBargeIn: boolean

  constructor(
    private readonly inner: Transport,
    private readonly onViolation: (v: Violation, original: string) => void,
  ) {
    this.channel = inner.channel
    this.supportsBargeIn = inner.supportsBargeIn
  }

  onAudioFrame(h: (pcm: Int16Array) => void): void {
    this.inner.onAudioFrame(h)
  }
  onEvent(h: (e: ClientEvent) => void): void {
    this.inner.onEvent(h)
  }
  onClose(h: () => void): void {
    this.inner.onClose(h)
  }
  sendAudio(pcm: Int16Array): void {
    this.inner.sendAudio(pcm)
  }
  flushAudio(): void {
    this.inner.flushAudio()
  }
  close(): void {
    this.inner.close()
  }

  send(event: ServerEvent): void {
    if (event.type === 'tts.begin') {
      // Strip notes-to-self before anything else. "(Waiting for the caller's
      // response.)" is harmless in a chat window and read aloud, brackets and
      // all, in a phone call.
      const spoken = speakable(event.text)
      if (spoken.length === 0) return
      if (spoken !== event.text) event = { ...event, text: spoken }

      const checked = guard(event.text, event.lang as Lang)
      if (!checked.safe && checked.violation) {
        this.onViolation(checked.violation, event.text)
        this.inner.send({ ...event, text: checked.text, marks: [] })
        return
      }
    }
    this.inner.send(event)
  }
}
