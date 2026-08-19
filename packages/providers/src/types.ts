import type { Lang, WordMark } from '@vaani/shared'

export type Tier = 'local' | 'cloud'

export interface TierConfig {
  stt: Tier
  llm: Tier
  tts: Tier
}

/** Every provider answers the same two questions: who are you, and can you run? */
interface ProviderBase {
  readonly id: string
  readonly tier: Tier
  /**
   * Cheap readiness probe — API key present, local binary on PATH, model
   * downloaded. Must never throw: an unavailable provider is a normal state
   * that triggers a downgrade, not an error.
   */
  isAvailable(): Promise<boolean>
}

// ─── Speech to text ──────────────────────────────────────────────────────────

export interface SttResult {
  text: string
  lang: Lang
  confidence: number
  /** True when a single utterance mixed Hindi and English. */
  codeSwitched: boolean
}

export interface SttStream {
  /** Feed canonical PCM16 16 kHz. */
  push(pcm: Int16Array): void
  /** Signal end of caller speech and resolve the final transcript. */
  end(): Promise<SttResult>
  /** Abandon the stream without a final result (barge-in, hangup). */
  abort(): void
  onPartial(cb: (r: SttResult) => void): void
}

export interface SttOptions {
  /** Bias decoding toward an expected language; omit to auto-detect. */
  lang?: Lang
  /**
   * Domain vocabulary that lifts recognition of terms a general model mangles:
   * "periapical", "Invisalign", dentist surnames, locality names.
   */
  hints?: string[]
}

export interface SttProvider extends ProviderBase {
  stream(opts: SttOptions): SttStream
}

// ─── Language model ──────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolName?: string
  toolCalls?: ToolCall[]
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolDef {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

export type LlmDelta =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; call: ToolCall }
  | { kind: 'done'; finishReason: 'stop' | 'tool_calls' | 'length' }

export interface LlmOptions {
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export interface LlmProvider extends ProviderBase {
  stream(messages: Message[], tools: ToolDef[], opts?: LlmOptions): AsyncIterable<LlmDelta>
}

// ─── Text to speech ──────────────────────────────────────────────────────────

export interface TtsOptions {
  /** Resolved for the language being spoken — see `voiceFor`. */
  voiceId: string
  lang: Lang
  modelId?: string
  /** Slows delivery for content that must be heard exactly: numbers, addresses. */
  precise?: boolean
  signal?: AbortSignal
}

export interface TtsStream {
  /** Canonical PCM16 16 kHz chunks. */
  audio: AsyncIterable<Int16Array>
  /**
   * Word timings, resolved once known.
   *
   * Non-negotiable for every TTS provider: without marks there is no correct
   * barge-in, because there is no way to know which words the caller heard.
   * Providers that do not expose timings must derive them.
   */
  marks: Promise<WordMark[]>
  abort(): void
}

export interface TtsProvider extends ProviderBase {
  synth(text: string, opts: TtsOptions): TtsStream
}

// ─── Resolution ──────────────────────────────────────────────────────────────

export interface ResolvedProviders {
  stt: SttProvider
  llm: LlmProvider
  tts: TtsProvider
  /** Components that fell back to local because the requested tier was unavailable. */
  downgraded: ('stt' | 'llm' | 'tts')[]
}
