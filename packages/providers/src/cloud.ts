import type { Lang, WordMark } from '@vaani/shared'
import { detectLang } from './lang-detect'
import { forSpeech } from './hinglish'
import { fetchWithRetry } from './retry'
import { deriveWordMarks, resample } from './local'
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
 * The cloud tier — the configuration you sell.
 *
 * Every provider here follows the same rule: `isAvailable()` returns false
 * when its key is missing, and the registry silently falls back to local.
 * Nothing in this file may throw at import or at startup.
 */

const key = (name: string): string => process.env[name] ?? ''

// ─── STT: Deepgram (streaming) ───────────────────────────────────────────────

const DEEPGRAM_KEY = () => key('DEEPGRAM_API_KEY')

class DeepgramStream implements SttStream {
  private ws: WebSocket | null = null
  private partialCb: ((r: SttResult) => void) | null = null
  private finalText = ''
  private ready: Promise<void>
  private aborted = false
  private pending: Int16Array[] = []

  constructor(private readonly opts: SttOptions) {
    const params = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      // Nova-3's multilingual mode handles Hindi/English switching mid-utterance,
      // which is the normal case for Indian callers rather than an exception.
      language: 'multi',
    })
    if (opts.hints?.length) for (const h of opts.hints) params.append('keyterm', h)

    this.ready = new Promise((resolve) => {
      try {
        const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, [
          'token',
          DEEPGRAM_KEY(),
        ])
        ws.binaryType = 'arraybuffer'
        this.ws = ws
        ws.onopen = () => {
          for (const p of this.pending) ws.send(p.buffer as ArrayBuffer)
          this.pending = []
          resolve()
        }
        ws.onerror = () => resolve()
        ws.onmessage = (ev) => this.onMessage(ev)
      } catch {
        resolve()
      }
    })
  }

  private onMessage(ev: MessageEvent): void {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        channel?: { alternatives?: { transcript?: string }[] }
        is_final?: boolean
      }
      const text = msg.channel?.alternatives?.[0]?.transcript ?? ''
      if (!text) return
      if (msg.is_final) this.finalText = `${this.finalText} ${text}`.trim()
      const det = detectLang(msg.is_final ? this.finalText : text, this.opts.lang)
      this.partialCb?.({
        text: msg.is_final ? this.finalText : text,
        lang: det.lang,
        confidence: det.confidence,
        codeSwitched: det.codeSwitched,
      })
    } catch {
      /* a malformed frame must never break a live call */
    }
  }

  push(pcm: Int16Array): void {
    if (this.aborted) return
    const ws = this.ws
    if (ws && ws.readyState === 1) ws.send(pcm.buffer as ArrayBuffer)
    else this.pending.push(pcm)
  }

  onPartial(cb: (r: SttResult) => void): void {
    this.partialCb = cb
  }

  abort(): void {
    this.aborted = true
    this.ws?.close()
  }

  async end(): Promise<SttResult> {
    await this.ready
    this.ws?.send(JSON.stringify({ type: 'CloseStream' }))
    // Deepgram flushes remaining finals after CloseStream; give it a moment.
    await new Promise((r) => setTimeout(r, 180))
    this.ws?.close()
    const det = detectLang(this.finalText, this.opts.lang)
    return {
      text: this.finalText,
      lang: det.lang,
      confidence: det.confidence,
      codeSwitched: det.codeSwitched,
    }
  }
}

export const deepgramStt: SttProvider = {
  id: 'deepgram:nova-3',
  tier: 'cloud',
  isAvailable: async () => DEEPGRAM_KEY().length > 0,
  stream: (opts) => new DeepgramStream(opts),
}

// ─── LLM: Gemini ─────────────────────────────────────────────────────────────

const GEMINI_KEY = () => key('GEMINI_API_KEY')
const GEMINI_MODEL = () => process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

interface GeminiPart {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown> }
}

export const geminiLlm: LlmProvider = {
  id: 'gemini',
  tier: 'cloud',

  /**
   * Probes the model, not just the key.
   *
   * A present key proves nothing: Google retires models for new projects
   * (gemini-2.5-flash now 404s for keys created after its cutoff), and an
   * OAuth-style token can list models while being unable to generate. Checking
   * only for a key means the failover chain hands a live call to a dead
   * provider and discovers the problem mid-sentence. The registry caches this
   * probe, so it costs one request per process.
   */
  isAvailable: async () => {
    if (GEMINI_KEY().length === 0) return false
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}?key=${GEMINI_KEY()}`,
      )
      return res.ok
    } catch {
      return false
    }
  },

  async *stream(
    messages: Message[],
    tools: ToolDef[],
    opts: LlmOptions = {},
  ): AsyncIterable<LlmDelta> {
    const system = messages.find((m) => m.role === 'system')?.content ?? ''
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: m.toolName ?? 'tool',
                  response: { result: m.content },
                },
              },
            ],
          }
        }
        if (m.toolCalls?.length) {
          return {
            role: 'model',
            parts: m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args } })),
          }
        }
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }
      })

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}` +
      `:streamGenerateContent?alt=sse&key=${GEMINI_KEY()}`

    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: opts.signal ?? null,
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  })),
                },
              ],
            }
          : {}),
        generationConfig: {
          temperature: opts.temperature ?? 0.6,
          maxOutputTokens: opts.maxTokens ?? 400,
        },
      }),
    }, { signal: opts.signal ?? undefined })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`gemini ${res.status}: ${detail.slice(0, 300)}`)
    }

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
        if (!line.startsWith('data:')) continue

        try {
          const payload = JSON.parse(line.slice(5).trim()) as {
            candidates?: { content?: { parts?: GeminiPart[] } }[]
          }
          for (const part of payload.candidates?.[0]?.content?.parts ?? []) {
            if (part.functionCall) {
              sawToolCall = true
              const call: ToolCall = {
                id: `c${++seq}`,
                name: part.functionCall.name,
                args: part.functionCall.args ?? {},
              }
              yield { kind: 'tool_call', call }
            } else if (part.text) {
              yield { kind: 'text', text: part.text }
            }
          }
        } catch {
          continue
        }
      }
    }

    yield { kind: 'done', finishReason: sawToolCall ? 'tool_calls' : 'stop' }
  },
}

// ─── TTS: ElevenLabs ─────────────────────────────────────────────────────────

const ELEVEN_KEY = () => key('ELEVENLABS_API_KEY')
/**
 * Turbo, not Flash.
 *
 * Measured by round-tripping a spoken line back through Whisper: turbo scores
 * 94 % word recovery against flash's 88 %, and the gap is enunciation — flash
 * slurs "four" into something Whisper reads as "4". Turbo costs only a few tens
 * of milliseconds more, which is a good trade for a caller writing down a time.
 */
const ELEVEN_MODEL = () => process.env.ELEVENLABS_MODEL_ID ?? 'eleven_turbo_v2_5'

/**
 * Convert ElevenLabs character-level alignment into word marks.
 *
 * The API reports per-character start times; words are the unit barge-in
 * truncation reasons about, so characters are folded on whitespace.
 */
export function marksFromAlignment(
  chars: string[],
  startsSec: number[],
  durationsSec: number[],
): WordMark[] {
  const marks: WordMark[] = []
  let word = ''
  let startMs = 0
  let endMs = 0

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] ?? ''
    const s = Math.round((startsSec[i] ?? 0) * 1000)
    const e = Math.round(((startsSec[i] ?? 0) + (durationsSec[i] ?? 0)) * 1000)

    if (/\s/.test(ch)) {
      if (word) marks.push({ word, startMs, endMs })
      word = ''
      continue
    }
    if (!word) startMs = s
    word += ch
    endMs = e
  }
  if (word) marks.push({ word, startMs, endMs })
  return marks
}

class ElevenLabsStream implements TtsStream {
  private aborted = false
  private ctrl = new AbortController()
  private resolveMarks!: (m: WordMark[]) => void
  readonly marks: Promise<WordMark[]>
  readonly audio: AsyncIterable<Int16Array>

  constructor(rawText: string, opts: TtsOptions) {
    // Route each word to the script whose phonetics it needs. Without this,
    // romanised Hindi is read with English phonetics and comes out mangled.
    const text = forSpeech(rawText, opts.lang)

    this.marks = new Promise((r) => {
      this.resolveMarks = r
    })
    const self = this

    this.audio = {
      async *[Symbol.asyncIterator]() {
        // The `with-timestamps` endpoint returns audio *and* character
        // alignment. Alignment is non-negotiable: without it there is no
        // correct barge-in, only a guess at what the caller heard.
        const url =
          `https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}` +
          `/stream/with-timestamps?output_format=pcm_16000`

        const res = await fetch(url, {
          method: 'POST',
          signal: self.ctrl.signal,
          headers: {
            'xi-api-key': ELEVEN_KEY(),
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            text,
            model_id: ELEVEN_MODEL(),
            voice_settings: {
              /**
               * Tuned for a person, not a narrator.
               *
               * High stability produces even, controlled delivery — which is
               * exactly what makes a voice read as synthetic. Real speech
               * varies in pitch and pace from clause to clause. Lowering
               * stability restores that variation and a little style restores
               * warmth.
               *
               * `precise` tightens both back up for the moments where being
               * understood beats sounding natural: reading back a phone
               * number, a date, an address.
               */
              stability: opts.precise ? 0.75 : 0.42,
              similarity_boost: opts.precise ? 0.85 : 0.75,
              style: opts.precise ? 0.05 : 0.32,
              use_speaker_boost: true,
            },
          }),
        })

        if (!res.body) {
          self.resolveMarks(deriveWordMarks(text, text.length * 55))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        const chars: string[] = []
        const starts: number[] = []
        const durations: number[] = []

        while (true) {
          if (self.aborted) return
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          let nl: number
          while ((nl = buf.indexOf('\n')) !== -1) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line) continue

            try {
              const msg = JSON.parse(line) as {
                audio_base64?: string
                alignment?: {
                  characters?: string[]
                  character_start_times_seconds?: number[]
                  character_durations_seconds?: number[]
                }
              }

              if (msg.alignment?.characters) {
                chars.push(...msg.alignment.characters)
                starts.push(...(msg.alignment.character_start_times_seconds ?? []))
                durations.push(...(msg.alignment.character_durations_seconds ?? []))
                self.resolveMarks(marksFromAlignment(chars, starts, durations))
              }

              if (msg.audio_base64) {
                const raw = Buffer.from(msg.audio_base64, 'base64')
                yield new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2))
              }
            } catch {
              continue
            }
          }
        }

        self.resolveMarks(
          chars.length > 0
            ? marksFromAlignment(chars, starts, durations)
            : deriveWordMarks(text, text.length * 55),
        )
      },
    }
  }

  abort(): void {
    this.aborted = true
    this.ctrl.abort()
    this.resolveMarks([])
  }
}

/**
 * Bella, by default.
 *
 * Chosen by measurement, not by ear: each premade voice was made to speak
 * Hindi, transcribed back with Whisper, and scored on how much of the original
 * survived. Bella returns "नमस्ते, मैं प्रिया बोल रही हूँ।" verbatim — a 100 %
 * round trip. Sarah, by contrast, scores 33 % and is genuinely unintelligible
 * in Hindi.
 *
 * The remaining limitation is accent, not intelligibility: every premade voice
 * is American or British, and ElevenLabs blocks its library voices (which
 * include Indian ones) on the free tier. Set ELEVENLABS_VOICE_ID to an Indian
 * library voice once the account is on a paid plan.
 */
export const DEFAULT_VOICE_ID = 'hpp4J3VqNfWAUOO0d1Us' // Bella

/**
 * One voice per language — PRD §5.2.
 *
 * Bella is confirmed for English. Hindi and Hinglish resolve separately so an
 * Indian voice can be dropped in by configuration alone once one is chosen;
 * until then they fall back to a voice measured at 100 % Hindi round-trip.
 *
 * The constraint that outlives whichever voice is picked: it must not change
 * *within* a language. A caller who hears two different voices in one call is
 * worse off than one who hears a consistent foreign accent.
 */
export function voiceFor(lang: 'en-IN' | 'hi-IN' | 'hi-Latn-IN'): string {
  const env = process.env
  if (lang === 'en-IN') return env.VOICE_EN || env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID
  return env.VOICE_HI || env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID
}

export const elevenLabsTts: TtsProvider = {
  id: 'elevenlabs:flash-v2.5',
  tier: 'cloud',
  isAvailable: async () => ELEVEN_KEY().length > 0,
  synth: (text, opts) => new ElevenLabsStream(text, opts),
}

export { resample }
