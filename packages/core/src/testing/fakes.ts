import type { ClientEvent, Lang, ServerEvent, WordMark } from '@vaani/shared'
import type {
  LlmDelta,
  LlmProvider,
  Message,
  ResolvedProviders,
  SttProvider,
  SttResult,
  SttStream,
  ToolCall,
  ToolDef,
  TtsProvider,
  TtsStream,
} from '@vaani/providers'
import type { Transport } from '../transport'
import { deriveWordMarks, estimateDurationMs } from '../chunker'
import type { ToolRunner } from '../session'

/** Yield to the microtask + macrotask queue so pending async work advances. */
const nextTick = () => new Promise<void>((r) => setImmediate(r))

/**
 * A scripted conversation. The fake STT reads caller turns from here, and the
 * fake LLM reads agent replies from here, so a test reads as a dialogue rather
 * than as provider plumbing.
 */
export class Script {
  callerTurns: string[] = []
  agentReplies: string[] = []
  toolCallsToEmit: ToolCall[][] = []
}

// ─── Clock ───────────────────────────────────────────────────────────────────

export class FakeClock {
  t = 0
  now = () => this.t
  advance(ms: number) {
    this.t += ms
  }
}

// ─── Transport ───────────────────────────────────────────────────────────────

export class FakeTransport implements Transport {
  readonly channel = 'web' as const
  readonly supportsBargeIn = true

  private audioHandler: ((pcm: Int16Array) => void) | null = null
  private eventHandler: ((e: ClientEvent) => void) | null = null
  private closeHandler: (() => void) | null = null

  readonly sent: ServerEvent[] = []
  private audioSamples = 0
  private activeUtteranceId: string | null = null

  constructor(
    private readonly script: Script,
    private readonly clock: FakeClock,
  ) {}

  onAudioFrame(h: (pcm: Int16Array) => void) {
    this.audioHandler = h
  }
  onEvent(h: (e: ClientEvent) => void) {
    this.eventHandler = h
  }
  onClose(h: () => void) {
    this.closeHandler = h
  }

  send(event: ServerEvent) {
    this.sent.push(event)
    if (event.type === 'tts.begin') this.activeUtteranceId = event.utteranceId
  }

  sendAudio(pcm: Int16Array) {
    this.audioSamples += pcm.length
  }

  flushAudio() {
    /* the client-side buffer is not modelled; barge-in is asserted via bytes sent */
  }

  close() {
    this.closeHandler?.()
  }

  // ─── Test driving API ──────────────────────────────────────────────────────

  /**
   * Feed frames without any VAD signal — models a speaker echoing the agent's
   * own voice back into the microphone while she is talking.
   */
  echoWhileAgentSpeaks(frames = 40): void {
    for (let i = 0; i < frames; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320).fill(6000))
    }
  }

  /** Simulate the caller speaking a full turn, through to the endpoint. */
  async speak(text: string): Promise<void> {
    this.script.callerTurns.push(text)
    this.eventHandler?.({ type: 'vad.speech_start', t: this.clock.t })

    // Feed 20 ms frames as real audio would arrive; each drives a tick.
    for (let i = 0; i < 10; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }

    this.eventHandler?.({ type: 'vad.speech_end', t: this.clock.t })

    // Silence, until the endpointing threshold is crossed.
    for (let i = 0; i < 80; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }

    await this.settle()
  }

  /**
   * A long caller turn — long enough to earn a backchannel — followed by the
   * silence that should still endpoint normally.
   */
  async speakLong(text: string, durationMs: number): Promise<void> {
    this.script.callerTurns.push(text)
    this.eventHandler?.({ type: 'vad.speech_start', t: this.clock.t })

    const frames = Math.floor(durationMs / 20)
    for (let i = 0; i < frames; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }

    this.eventHandler?.({ type: 'vad.speech_end', t: this.clock.t })
    for (let i = 0; i < 80; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }
    await this.settle()
  }

  /** Report that the caller has heard `ms` of the current agent utterance. */
  async playUntil(ms: number): Promise<void> {
    if (!this.activeUtteranceId) return
    this.eventHandler?.({
      type: 'playback.progress',
      utteranceId: this.activeUtteranceId,
      playedMs: ms,
    })
    await nextTick()
  }

  /** The caller cuts in without saying anything intelligible yet. */
  async interrupt(): Promise<void> {
    this.eventHandler?.({ type: 'vad.speech_start', t: this.clock.t })
    await this.settle()
  }

  /** The caller cuts in and says something. */
  async interruptWith(text: string): Promise<void> {
    this.script.callerTurns.push(text)
    this.eventHandler?.({ type: 'vad.speech_start', t: this.clock.t })
    for (let i = 0; i < 10; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }
    this.eventHandler?.({ type: 'vad.speech_end', t: this.clock.t })
    for (let i = 0; i < 80; i++) {
      this.clock.advance(20)
      this.audioHandler?.(new Int16Array(320))
    }
    await this.settle()
  }

  async settle(turns = 12): Promise<void> {
    for (let i = 0; i < turns; i++) await nextTick()
  }

  // ─── Assertions ────────────────────────────────────────────────────────────

  /** Every utterance the agent began speaking. */
  spokenByAgent(): string[] {
    return this.sent.filter((e) => e.type === 'tts.begin').map((e) => e.text)
  }

  audioSamplesSent(): number {
    return this.audioSamples
  }

  eventsOfType<T extends ServerEvent['type']>(type: T): Extract<ServerEvent, { type: T }>[] {
    return this.sent.filter((e): e is Extract<ServerEvent, { type: T }> => e.type === type)
  }
}

// ─── Providers ───────────────────────────────────────────────────────────────

class FakeSttStream implements SttStream {
  private partialCb: ((r: SttResult) => void) | null = null
  constructor(
    private readonly script: Script,
    private readonly lang: Lang,
  ) {}
  push() {
    /* audio content is irrelevant to a scripted transcript */
  }
  onPartial(cb: (r: SttResult) => void) {
    this.partialCb = cb
  }
  abort() {}
  async end(): Promise<SttResult> {
    const text = this.script.callerTurns.shift() ?? ''
    const result: SttResult = { text, lang: this.lang, confidence: 0.95, codeSwitched: false }
    this.partialCb?.(result)
    return result
  }
}

export function fakeStt(script: Script, lang: Lang = 'en-IN'): SttProvider {
  return {
    id: 'fake-stt',
    tier: 'local',
    isAvailable: async () => true,
    stream: () => new FakeSttStream(script, lang),
  }
}

export function fakeLlm(script: Script): LlmProvider {
  return {
    id: 'fake-llm',
    tier: 'local',
    isAvailable: async () => true,
    async *stream(_messages: Message[], _tools: ToolDef[]): AsyncIterable<LlmDelta> {
      const calls = script.toolCallsToEmit.shift()
      if (calls && calls.length > 0) {
        for (const call of calls) yield { kind: 'tool_call', call }
        yield { kind: 'done', finishReason: 'tool_calls' }
        return
      }

      const reply = script.agentReplies.shift() ?? ''
      // Stream in small pieces, as a real model would.
      for (const word of reply.split(' ')) {
        yield { kind: 'text', text: `${word} ` }
        await nextTick()
      }
      yield { kind: 'done', finishReason: 'stop' }
    },
  }
}

class FakeTtsStream implements TtsStream {
  private aborted = false
  readonly marks: Promise<WordMark[]>
  readonly audio: AsyncIterable<Int16Array>

  constructor(text: string, lang: Lang) {
    const duration = estimateDurationMs(text, lang)
    const derived = deriveWordMarks(text, duration)
    this.marks = Promise.resolve(derived)

    const self = this
    this.audio = {
      async *[Symbol.asyncIterator]() {
        // 40 chunks with a yield point between each, so a test can interrupt
        // partway through exactly as a caller would.
        for (let i = 0; i < 40; i++) {
          if (self.aborted) return
          yield new Int16Array(160)
          await nextTick()
        }
      },
    }
  }

  abort() {
    this.aborted = true
  }
}

export function fakeTts(): TtsProvider {
  return {
    id: 'fake-tts',
    tier: 'local',
    isAvailable: async () => true,
    synth: (text, opts) => new FakeTtsStream(text, opts.lang),
  }
}

export function fakeProviders(script: Script, lang: Lang = 'en-IN'): ResolvedProviders {
  return {
    stt: fakeStt(script, lang),
    llm: fakeLlm(script),
    tts: fakeTts(),
    downgraded: [],
  }
}

/** A tool runner that records calls and returns scripted results. */
export class FakeTools implements ToolRunner {
  readonly calls: ToolCall[] = []
  results = new Map<string, unknown>()

  defs(): ToolDef[] {
    return [
      {
        name: 'check_availability',
        description: 'Find open appointment slots',
        parameters: { type: 'object', properties: { service: { type: 'string' } } },
      },
    ]
  }

  async run(call: ToolCall): Promise<{ ok: boolean; result: unknown }> {
    this.calls.push(call)
    return { ok: true, result: this.results.get(call.name) ?? { slots: [] } }
  }
}
