import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import type { Lang, WordMark } from '@vaani/shared'
import { detectLang } from './lang-detect'
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
  TtsOptions,
  TtsProvider,
  TtsStream,
} from './types'

/**
 * The local tier — a complete voice agent with zero API keys and zero cost.
 *
 * whisper.cpp + Ollama + Piper on Apple Silicon is genuinely usable, not a
 * toy fallback. It gives an offline development loop that costs nothing to
 * iterate on, a demo that survives a venue with no wifi, and an honest answer
 * to "what happens when the API is down".
 */

const WHISPER_URL = process.env.WHISPER_SERVER_URL ?? 'http://127.0.0.1:8080'
const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3:8b'
const PIPER_BIN = process.env.PIPER_BIN ?? 'piper'
const PIPER_VOICE_EN = process.env.PIPER_VOICE_EN ?? 'models/piper/en_IN-priya-medium.onnx'
const PIPER_VOICE_HI = process.env.PIPER_VOICE_HI ?? 'models/piper/hi_IN-pratham-medium.onnx'

async function reachable(url: string, ms = 800): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), ms)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok || res.status === 404
  } catch {
    return false
  }
}

// ─── STT: whisper.cpp ────────────────────────────────────────────────────────

/** WAV header for a PCM16 mono buffer — whisper.cpp's HTTP server expects a file. */
function wavHeader(samples: number, sampleRate = 16_000): Buffer {
  const b = Buffer.alloc(44)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples * 2, 4)
  b.write('WAVE', 8)
  b.write('fmt ', 12)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(1, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * 2, 28)
  b.writeUInt16LE(2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples * 2, 40)
  return b
}

class WhisperCppStream implements SttStream {
  private chunks: Int16Array[] = []
  private partialCb: ((r: SttResult) => void) | null = null
  private aborted = false
  private inFlight = false
  private lastPartialAt = 0

  constructor(private readonly opts: SttOptions) {}

  push(pcm: Int16Array): void {
    if (this.aborted) return
    this.chunks.push(pcm)
    // Re-transcribe the whole buffer on a cadence. Whisper has no streaming
    // mode; a rolling re-decode is how you get interim text out of it, and on
    // Metal a few seconds of audio decodes in well under the interval.
    const now = Date.now()
    if (!this.inFlight && now - this.lastPartialAt > 700 && this.samples() > 8000) {
      this.lastPartialAt = now
      void this.transcribe(true)
    }
  }

  private samples(): number {
    return this.chunks.reduce((n, c) => n + c.length, 0)
  }

  private flatten(): Int16Array {
    const total = this.samples()
    const out = new Int16Array(total)
    let o = 0
    for (const c of this.chunks) {
      out.set(c, o)
      o += c.length
    }
    return out
  }

  private async transcribe(partial: boolean): Promise<SttResult> {
    const pcm = this.flatten()
    if (!hasSpeechEnergy(pcm)) {
      return { text: '', lang: this.opts.lang ?? 'en-IN', confidence: 0, codeSwitched: false }
    }

    this.inFlight = true
    try {
      const body = new FormData()
      const wav = Buffer.concat([wavHeader(pcm.length), Buffer.from(pcm.buffer, 0, pcm.length * 2)])
      body.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
      body.append('response_format', 'json')
      body.append('temperature', '0')
      if (this.opts.lang) body.append('language', this.opts.lang.startsWith('hi') ? 'hi' : 'en')
      if (this.opts.hints?.length) body.append('prompt', this.opts.hints.join(', '))

      const res = await fetch(`${WHISPER_URL}/inference`, { method: 'POST', body })
      const json = (await res.json()) as { text?: string }
      const text = acceptTranscript((json.text ?? '').trim(), pcm)
      const det = detectLang(text, this.opts.lang)
      const result: SttResult = {
        text,
        lang: det.lang,
        confidence: det.confidence,
        codeSwitched: det.codeSwitched,
      }
      if (partial && !this.aborted) this.partialCb?.(result)
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
    if (this.aborted || this.samples() === 0) {
      return { text: '', lang: this.opts.lang ?? 'en-IN', confidence: 0, codeSwitched: false }
    }
    return this.transcribe(false)
  }
}

export const whisperCppStt: SttProvider = {
  id: 'whisper.cpp',
  tier: 'local',
  isAvailable: () => reachable(`${WHISPER_URL}/`),
  stream: (opts) => new WhisperCppStream(opts),
}

// ─── LLM: Ollama ─────────────────────────────────────────────────────────────

interface OllamaChunk {
  message?: {
    content?: string
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[]
  }
  done?: boolean
}

export const ollamaLlm: LlmProvider = {
  id: `ollama:${OLLAMA_MODEL}`,
  tier: 'local',
  isAvailable: () => reachable(`${OLLAMA_URL}/api/tags`),

  async *stream(
    messages: Message[],
    tools: ToolDef[],
    opts: LlmOptions = {},
  ): AsyncIterable<LlmDelta> {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal ?? null,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: true,
        options: { temperature: opts.temperature ?? 0.6, num_predict: opts.maxTokens ?? 300 },
        messages: messages.map((m) => ({
          role: m.role === 'tool' ? 'tool' : m.role,
          content: m.content,
          ...(m.toolCalls
            ? {
                tool_calls: m.toolCalls.map((c) => ({
                  function: { name: c.name, arguments: c.args },
                })),
              }
            : {}),
        })),
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
            }
          : {}),
      }),
    })

    if (!res.body) {
      yield { kind: 'done', finishReason: 'stop' }
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let sawToolCall = false
    let seq = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })

      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue

        let chunk: OllamaChunk
        try {
          chunk = JSON.parse(line) as OllamaChunk
        } catch {
          continue
        }

        for (const tc of chunk.message?.tool_calls ?? []) {
          sawToolCall = true
          const call: ToolCall = {
            id: `c${++seq}`,
            name: tc.function.name,
            args: tc.function.arguments ?? {},
          }
          yield { kind: 'tool_call', call }
        }

        const text = chunk.message?.content
        if (text) yield { kind: 'text', text }
      }
    }

    yield { kind: 'done', finishReason: sawToolCall ? 'tool_calls' : 'stop' }
  },
}

// ─── TTS: Piper ──────────────────────────────────────────────────────────────

/**
 * Distribute a duration across words by character weight.
 *
 * Piper reports no timings. Barge-in truncation needs word boundaries, so we
 * derive them from the synthesised sample count. Approximate, but boundary
 * resolution is all truncation requires — and an approximate mark is vastly
 * better than shipping the local tier without working interruption.
 */
export function deriveWordMarks(text: string, totalMs: number): WordMark[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const totalChars = words.reduce((n, w) => n + w.length, 0)
  const marks: WordMark[] = []
  let cursor = 0
  words.forEach((word, i) => {
    const endMs =
      i === words.length - 1 ? totalMs : Math.round(cursor + (word.length / totalChars) * totalMs)
    marks.push({ word, startMs: Math.round(cursor), endMs })
    cursor = endMs
  })
  return marks
}

class PiperStream implements TtsStream {
  private aborted = false
  private resolveMarks!: (m: WordMark[]) => void
  readonly marks: Promise<WordMark[]>
  readonly audio: AsyncIterable<Int16Array>

  constructor(text: string, lang: Lang) {
    this.marks = new Promise((r) => {
      this.resolveMarks = r
    })

    const model = lang === 'en-IN' ? PIPER_VOICE_EN : PIPER_VOICE_HI
    const self = this

    this.audio = {
      async *[Symbol.asyncIterator]() {
        const proc = spawn(PIPER_BIN, ['--model', model, '--output_raw'], {
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        proc.stdin.write(text)
        proc.stdin.end()

        let samples = 0
        const queue: Int16Array[] = []
        let notify: (() => void) | null = null
        let ended = false

        proc.stdout.on('data', (buf: Buffer) => {
          // Piper emits raw PCM16 at 22.05 kHz; downsample to the canonical rate.
          const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
          const out = resample(pcm, 22_050, 16_000)
          samples += out.length
          queue.push(out)
          notify?.()
        })
        proc.stdout.on('end', () => {
          ended = true
          self.resolveMarks(deriveWordMarks(text, (samples / 16_000) * 1000))
          notify?.()
        })

        while (!ended || queue.length > 0) {
          if (self.aborted) {
            proc.kill('SIGKILL')
            return
          }
          const next = queue.shift()
          if (next) {
            yield next
            continue
          }
          await new Promise<void>((r) => {
            notify = r
          })
          notify = null
        }
      },
    }
  }

  abort(): void {
    this.aborted = true
    this.resolveMarks([])
  }
}

/** Linear-interpolation resample. Adequate for speech; no dependency needed. */
export function resample(input: Int16Array, from: number, to: number): Int16Array {
  if (from === to) return input
  const ratio = from / to
  const outLen = Math.floor(input.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio
    const i0 = Math.floor(src)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = src - i0
    out[i] = Math.round((input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac)
  }
  return out
}

export const piperTts: TtsProvider = {
  id: 'piper',
  tier: 'local',
  async isAvailable() {
    try {
      await access(PIPER_VOICE_EN)
      return true
    } catch {
      return false
    }
  },
  synth: (text: string, opts: TtsOptions) => new PiperStream(text, opts.lang),
}
