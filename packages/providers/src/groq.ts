import { detectLang } from './lang-detect'
import { fetchWithRetry } from './retry'
import { InlineToolExtractor } from './inline-tools'
import { acceptTranscript, hasSpeechEnergy } from './hallucination'
import type {
  LlmDelta,
  LlmOptions,
  LlmProvider,
  Message,
  SttOptions,
  SttProvider,
  SttResult,
  SttStream,
  ToolCall,
  ToolDef,
} from './types'

/**
 * Groq — the low-latency cloud tier.
 *
 * Groq's LPU inference is fast enough to change what the pipeline feels like:
 * `whisper-large-v3-turbo` transcribes several seconds of audio in a fraction
 * of real time, and a 70B model streams its first token faster than most
 * providers manage with an 8B one.
 *
 * For a voice agent, time-to-first-token *is* the product. This is the cloud
 * configuration to reach for when latency matters more than anything else.
 */

const GROQ_KEY = (): string => process.env.GROQ_API_KEY ?? ''
// gpt-oss-120b is the only Groq model measured to use the native tool-calling
// channel reliably across booking, knowledge, and triage turns. Llama models
// tend to write the call into the response body instead — see InlineToolExtractor.
const LLM_MODEL = (): string => process.env.GROQ_LLM_MODEL ?? 'openai/gpt-oss-120b'
const STT_MODEL = (): string => process.env.GROQ_STT_MODEL ?? 'whisper-large-v3-turbo'
const BASE = 'https://api.groq.com/openai/v1'

// ─── STT: Whisper large-v3-turbo ─────────────────────────────────────────────

function wav(pcm: Int16Array, sampleRate = 16_000): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length * 2, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length * 2, 40)
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 2)])
}

class GroqSttStream implements SttStream {
  private chunks: Int16Array[] = []
  private partialCb: ((r: SttResult) => void) | null = null
  private aborted = false
  private inFlight = false
  private lastPartialAt = 0

  constructor(private readonly opts: SttOptions) {}

  private samples(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0)
  }

  private flatten(): Int16Array {
    const out = new Int16Array(this.samples())
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }

  push(pcm: Int16Array): void {
    if (this.aborted) return
    this.chunks.push(pcm)

    // Whisper is not a streaming model. Re-decoding the buffer on a cadence is
    // how interim text is obtained from it — viable here only because Groq
    // returns in well under the interval.
    const now = Date.now()
    if (!this.inFlight && now - this.lastPartialAt > 900 && this.samples() > 12_000) {
      this.lastPartialAt = now
      void this.transcribe(true)
    }
  }

  private async transcribe(partial: boolean): Promise<SttResult> {
    const pcm = this.flatten()

    // Do not ask the model what silence says. Given room tone Whisper does not
    // return nothing — it returns subtitle credits and stock sign-offs, which
    // then enter the conversation as things the caller said.
    if (!hasSpeechEnergy(pcm)) {
      return { text: '', lang: this.opts.lang ?? 'en-IN', confidence: 0, codeSwitched: false }
    }

    this.inFlight = true
    try {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(wav(pcm))], { type: 'audio/wav' }), 'a.wav')
      form.append('model', STT_MODEL())
      form.append('response_format', 'json')
      form.append('temperature', '0')
      // Whisper transcribes Hindi into Devanagari by default. Left unbiased it
      // will also silently *translate* Hinglish into English, which destroys
      // the very code-switching this agent needs to mirror.
      if (this.opts.lang) form.append('language', this.opts.lang.startsWith('hi') ? 'hi' : 'en')
      if (this.opts.hints?.length) form.append('prompt', this.opts.hints.join(', '))

      const res = await fetch(`${BASE}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${GROQ_KEY()}` },
        body: form,
      })
      const json = (await res.json()) as { text?: string }
      const text = acceptTranscript((json.text ?? '').trim(), pcm)
      const det = detectLang(text, this.opts.lang)
      const result: SttResult = {
        text,
        lang: det.lang,
        confidence: det.confidence,
        codeSwitched: det.codeSwitched,
      }
      // Partials are rendered on screen, so they must clear the same bar as a
      // final. An invented partial is still an invented thing the caller said.
      if (partial && !this.aborted && text.trim().length > 0) this.partialCb?.(result)
      return result
    } catch {
      return { text: '', lang: this.opts.lang ?? 'en-IN', confidence: 0, codeSwitched: false }
    } finally {
      this.inFlight = false
    }
  }

  onPartial(cb: (r: SttResult) => void): void {
    this.partialCb = cb
  }

  abort(): void {
    this.aborted = true
    this.chunks = []
  }

  async end(): Promise<SttResult> {
    if (this.aborted || this.samples() < 1600) {
      return { text: '', lang: this.opts.lang ?? 'en-IN', confidence: 0, codeSwitched: false }
    }
    return this.transcribe(false)
  }
}

export const groqStt: SttProvider = {
  id: 'groq:whisper-large-v3-turbo',
  tier: 'cloud',
  isAvailable: async () => GROQ_KEY().length > 0,
  stream: (opts) => new GroqSttStream(opts),
}

// ─── LLM: OpenAI-compatible streaming with tool calls ────────────────────────

interface OpenAiDelta {
  choices?: {
    delta?: {
      content?: string
      tool_calls?: {
        index: number
        id?: string
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason?: string
  }[]
}

export const groqLlm: LlmProvider = {
  id: 'groq',
  tier: 'cloud',
  isAvailable: async () => GROQ_KEY().length > 0,

  async *stream(
    messages: Message[],
    tools: ToolDef[],
    opts: LlmOptions = {},
  ): AsyncIterable<LlmDelta> {
    const res = await fetchWithRetry(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: opts.signal ?? null,
      headers: {
        authorization: `Bearer ${GROQ_KEY()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: LLM_MODEL(),
        stream: true,
        temperature: opts.temperature ?? 0.6,
        max_tokens: opts.maxTokens ?? 400,
        messages: messages.map((m) => {
          if (m.role === 'tool') {
            return { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? 'c1' }
          }
          if (m.toolCalls?.length) {
            return {
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: 'function',
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          }
          return { role: m.role, content: m.content }
        }),
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
              tool_choice: 'auto',
            }
          : {}),
      }),
    }, { signal: opts.signal ?? undefined })

    // A non-2xx body is JSON, not SSE. Parsing it as a stream would yield
    // nothing and look exactly like a model that chose to say nothing — the
    // most expensive kind of silent failure in a voice pipeline.
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`groq ${res.status}: ${detail.slice(0, 300)}`)
    }

    if (!res.body) {
      yield { kind: 'done', finishReason: 'stop' }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let finish: 'stop' | 'tool_calls' | 'length' = 'stop'

    // Tool-call arguments arrive as a JSON string split across many deltas,
    // so they are accumulated per index and parsed only once complete.
    const building = new Map<number, { id: string; name: string; args: string }>()
    // Catches models that write tool calls into the text body instead of
    // using the tool_calls channel, so markup never reaches synthesis.
    const inline = new InlineToolExtractor()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue

        const payload = line.slice(5).trim()
        if (payload === '[DONE]') continue

        let chunk: OpenAiDelta
        try {
          chunk = JSON.parse(payload) as OpenAiDelta
        } catch {
          continue
        }

        const choice = chunk.choices?.[0]
        if (choice?.finish_reason === 'tool_calls') finish = 'tool_calls'
        if (choice?.finish_reason === 'length') finish = 'length'

        for (const tc of choice?.delta?.tool_calls ?? []) {
          const existing = building.get(tc.index) ?? { id: '', name: '', args: '' }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.args += tc.function.arguments
          building.set(tc.index, existing)
        }

        const raw = choice?.delta?.content
        if (raw) {
          const out = inline.push(raw)
          if (out.text) yield { kind: 'text', text: out.text }
          for (const call of out.calls) {
            finish = 'tool_calls'
            yield { kind: 'tool_call', call }
          }
        }
      }
    }

    const tail = inline.flush()
    if (tail.text) yield { kind: 'text', text: tail.text }
    for (const call of tail.calls) {
      finish = 'tool_calls'
      yield { kind: 'tool_call', call }
    }

    for (const [, built] of building) {
      if (!built.name) continue
      let args: Record<string, unknown> = {}
      try {
        args = built.args ? (JSON.parse(built.args) as Record<string, unknown>) : {}
      } catch {
        args = {}
      }
      const call: ToolCall = { id: built.id || `c${Date.now()}`, name: built.name, args }
      finish = 'tool_calls'
      yield { kind: 'tool_call', call }
    }

    yield { kind: 'done', finishReason: finish }
  },
}
