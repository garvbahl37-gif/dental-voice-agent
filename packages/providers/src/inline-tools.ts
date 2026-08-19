import type { ToolCall } from './types'

/**
 * Rescues tool calls that a model emits as text instead of as tool calls.
 *
 * Several strong open models — Llama 3.3 among them — sometimes ignore the
 * native `tool_calls` channel and write the call into the response body as
 * pseudo-XML:
 *
 *   <function=check_availability>{"service": "scaling"}</function>
 *
 * Left alone this fails twice over: the tool never runs, and the raw markup is
 * handed to TTS and read aloud to the caller. In a voice product the second
 * failure is the serious one — a caller hearing "less than function equals
 * check underscore availability" is unrecoverable.
 *
 * So text is filtered on the way through: markup is extracted as a real tool
 * call and never reaches synthesis. Streaming-safe, since a tag can be split
 * across chunk boundaries.
 */

const OPEN = '<function='
const CLOSE = '</function>'

export class InlineToolExtractor {
  private buf = ''
  private inTool = false
  private seq = 0

  push(chunk: string): { text: string; calls: ToolCall[] } {
    this.buf += chunk
    return this.drain(false)
  }

  /** Emit whatever remains once the stream ends. */
  flush(): { text: string; calls: ToolCall[] } {
    const out = this.drain(true)
    this.buf = ''
    this.inTool = false
    return out
  }

  private drain(final: boolean): { text: string; calls: ToolCall[] } {
    let text = ''
    const calls: ToolCall[] = []

    for (;;) {
      if (this.inTool) {
        const end = this.buf.indexOf(CLOSE)
        if (end === -1) {
          // Tag still incomplete. On a final drain the model never closed it,
          // so discard rather than speak a fragment of markup.
          if (final) this.buf = ''
          return { text, calls }
        }
        const body = this.buf.slice(0, end)
        this.buf = this.buf.slice(end + CLOSE.length)
        this.inTool = false

        const split = body.indexOf('>')
        if (split !== -1) {
          const name = body.slice(0, split).trim()
          const raw = body.slice(split + 1).trim()
          let args: Record<string, unknown> = {}
          try {
            args = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
          } catch {
            args = {}
          }
          if (name) calls.push({ id: `inline${++this.seq}`, name, args })
        }
        continue
      }

      const start = this.buf.indexOf(OPEN)
      if (start !== -1) {
        text += this.buf.slice(0, start)
        this.buf = this.buf.slice(start + OPEN.length)
        this.inTool = true
        continue
      }

      // No tag in sight. Hold back a possible partial opening tag split across
      // chunks, so "<func" is never spoken before "tion=" arrives.
      const hold = final ? 0 : partialPrefixLength(this.buf, OPEN)
      text += this.buf.slice(0, this.buf.length - hold)
      this.buf = this.buf.slice(this.buf.length - hold)
      return { text, calls }
    }
  }
}

/** Length of the longest suffix of `s` that is a proper prefix of `token`. */
function partialPrefixLength(s: string, token: string): number {
  const max = Math.min(s.length, token.length - 1)
  for (let n = max; n > 0; n--) {
    if (s.endsWith(token.slice(0, n))) return n
  }
  return 0
}
