import {
  type AgentState,
  type Lang,
  type ServerEvent,
  type WordMark,
  DEFAULT_LANG,
  BUDGETS,
} from '@vaani/shared'
import type {
  LlmProvider,
  Message,
  ResolvedProviders,
  SttStream,
  ToolCall,
  ToolDef,
  TtsStream,
} from '@vaani/providers'
import type { Transport } from './transport'
import { TurnManager, type BargeIn } from './turn-manager'
import { SentenceChunker, deriveWordMarks, estimateDurationMs } from './chunker'
import { truncateToPlayed } from './truncation'

/**
 * Session — one conversation, from "hello" to hang-up.
 *
 * Written against `Transport` and `ResolvedProviders` only, so the identical
 * object serves a browser demo, a Twilio call, and a WhatsApp exchange.
 *
 * The invariant it exists to protect: **conversation history records what the
 * caller heard, not what the model generated.** Everything else here — chunked
 * synthesis, abortable streams, playback tracking — is in service of that.
 */

export interface ToolRunner {
  defs(): ToolDef[]
  run(call: ToolCall): Promise<{ ok: boolean; result: unknown }>
}

export interface SessionOptions {
  sessionId: string
  transport: Transport
  providers: ResolvedProviders
  systemPrompt: string
  voiceId: string
  practiceName?: string
  agentName?: string
  tools?: ToolRunner
  greeting?: string
  lang?: Lang
  /**
   * Domain vocabulary biased into the recogniser: doctor surnames, treatment
   * names, the practice name. General models reliably mangle these, and a
   * mangled name becomes a failed patient lookup two steps later.
   */
  sttHints?: string[]
  now?: () => number
  /** Cached-audio lookup; returns null on a miss. */
  phraseFor?: (key: string, lang: Lang) => string | null
  /**
   * Rebuilds the system message from current state before every model call.
   *
   * The previous design pushed the instructions once in the constructor, so
   * everything learned during a call — the caller's name, their language, what
   * had already been asked — existed in the transcript but never in the
   * instructions. The model was asked to infer it, and reliably did not.
   */
  buildInstructions?: (lang: Lang) => string
  /** Resolves the voice for the language currently being spoken. */
  voiceFor?: (lang: Lang) => string
  onEnd?: (history: Message[]) => void
}

const NO_TOOLS: ToolRunner = { defs: () => [], run: async () => ({ ok: true, result: null }) }

/**
 * How long the microphone stays untrusted after the agent stops.
 *
 * Covers speaker decay and room reverb. Long enough to swallow the tail of an
 * utterance, short enough that a caller answering immediately is still heard —
 * their first syllable arrives well after this on any real turn.
 */
const AGENT_TAIL_MS = 350

export class Session {
  readonly id: string
  private readonly transport: Transport
  private readonly providers: ResolvedProviders
  private readonly tools: ToolRunner
  private readonly voiceId: string
  private readonly now: () => number
  private readonly opts: SessionOptions

  private readonly turns: TurnManager
  private readonly _history: Message[] = []

  private stt: SttStream | null = null
  private activeTts: TtsStream | null = null
  private llmAbort: AbortController | null = null

  /**
   * One abort handle per in-flight utterance.
   *
   * Interrupt state must be scoped to the utterance, never to the session: a
   * `speak()` suspended mid-stream can resume *after* the next caller turn has
   * already begun, and a session-level flag will have been reset by then. It
   * would then record the words it never spoke against the wrong turn.
   */
  private readonly utteranceAborts = new Map<string, AbortController>()

  private lang: Lang
  private utteranceSeq = 0
  private turnSeq = 0
  private currentTurnId = 't0'

  /**
   * Text the caller actually heard during the current agent turn. This — not
   * the model's output — becomes the assistant history message.
   */
  private spokenThisTurn: string[] = []

  // Per-turn latency accounting
  private turnStartedAt = 0
  private sttMs = 0
  private llmTtftMs = 0
  private ttsTtfbMs = 0
  private turnCached = false

  /** Wall-clock time after which the microphone is trusted again. */
  private agentQuietAt = 0

  private closed = false

  constructor(opts: SessionOptions) {
    this.opts = opts
    this.id = opts.sessionId
    this.transport = opts.transport
    this.providers = opts.providers
    this.tools = opts.tools ?? NO_TOOLS
    this.voiceId = opts.voiceId
    this.now = opts.now ?? (() => Date.now())
    this.lang = opts.lang ?? DEFAULT_LANG

    this.turns = new TurnManager({
      now: this.now,
      emit: {
        stateChange: (s) => this.onStateChange(s),
        endpoint: () => void this.runCallerTurn(),
        bargeIn: (info) => this.onBargeIn(info),
        backchannel: () => void this.onBackchannel(),
        silence: (stage) => void this.onSilence(stage),
      },
    })

    this._history.push({ role: 'system', content: opts.systemPrompt })
  }

  get history(): Message[] {
    return this._history
  }

  get state(): AgentState {
    return this.turns.state
  }

  get currentLang(): Lang {
    return this.lang
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  private newSttStream(): SttStream {
    return this.providers.stt.stream({ lang: this.lang, hints: this.opts.sttHints })
  }

  async start(): Promise<void> {
    this.stt = this.newSttStream()
    this.stt.onPartial((r) => {
      this.turns.onPartial(r.text, r.lang)
      this.emit({
        type: 'stt.partial',
        // The id this utterance will settle under, so the console keeps one
        // bubble per thing the caller said.
        turnId: `t${this.turnSeq + 1}`,
        text: r.text,
        lang: r.lang,
        confidence: r.confidence,
      })
    })

    this.transport.onAudioFrame((pcm) => {
      // Never transcribe our own voice.
      //
      // Most callers are on speakers, so the microphone returns the agent's
      // own output. Feeding that to the recogniser fills the buffer with
      // the agent talking to itself, and the caller's actual words arrive mixed
      // into a transcript that is mostly echo — which presents as an agent
      // that simply cannot understand anyone.
      //
      // Barge-in is unaffected: the client's VAD still runs on every frame,
      // and the moment it reports speech the floor changes hands and audio
      // flows again.
      //
      // The hangover matters as much as the gate. A room has reverb, and the
      // client reports playback complete when the *buffer* drains, not when
      // the sound stops arriving at the microphone. Without it, the tail of
      // the greeting is captured as the caller's first words — which is how
      // an agent transcribes speech nobody said, seconds into a call.
      const speaking = this.turns.state === 'speaking'
      if (speaking) this.agentQuietAt = this.now() + AGENT_TAIL_MS
      if (!speaking && this.now() >= this.agentQuietAt) this.stt?.push(pcm)

      // Ticking on the audio clock gives endpointing frame-level resolution
      // without a timer of its own.
      this.turns.tick()
    })

    this.transport.onEvent((e) => this.onClientEvent(e))
    this.transport.onClose(() => void this.close())

    this.emit({
      type: 'session.ready',
      sessionId: this.id,
      agentName: this.opts.agentName ?? 'the front desk',
      practiceName: this.opts.practiceName ?? 'the practice',
      voiceId: this.voiceId,
      tier: {
        stt: this.providers.stt.tier,
        llm: this.providers.llm.tier,
        tts: this.providers.tts.tier,
      },
      downgraded: this.providers.downgraded,
    })

    if (this.opts.greeting) {
      this.spokenThisTurn = []
      await this.speak(this.opts.greeting, this.lang)
      this.commitAgentTurn()
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.activeTts?.abort()
    this.llmAbort?.abort()
    this.stt?.abort()
    this.opts.onEnd?.(this._history)
  }

  // ─── Client events ─────────────────────────────────────────────────────────

  private onClientEvent(e: import('@vaani/shared').ClientEvent): void {
    switch (e.type) {
      case 'vad.speech_start':
        this.turns.onVadSpeechStart()
        break
      case 'vad.speech_end':
        this.turns.onVadSpeechEnd()
        break
      case 'playback.progress':
        this.turns.onPlaybackProgress(e.utteranceId, e.playedMs)
        break
      case 'playback.complete':
        this.turns.onPlaybackComplete(e.utteranceId)
        break
      case 'control.interrupt':
        this.turns.onVadSpeechStart()
        break
      case 'control.set_lang':
        this.lang = e.lang
        break
      case 'session.end':
        void this.close()
        break
      default:
        break
    }
  }

  private onStateChange(state: AgentState): void {
    this.emit({ type: 'agent.state', state })
  }

  // ─── Barge-in ──────────────────────────────────────────────────────────────

  /**
   * The caller cut in. Three things must happen, in this order and fast:
   * stop making noise, stop generating, and correct the record.
   */
  private onBargeIn(info: BargeIn): void {
    this.utteranceAborts.get(info.utteranceId)?.abort()

    this.activeTts?.abort()
    this.activeTts = null
    this.llmAbort?.abort()
    this.transport.flushAudio()

    const { spoken } = truncateToPlayed(info.marks, info.truncateAtMs)
    if (spoken.length > 0) this.spokenThisTurn.push(spoken)

    this.emit({
      type: 'tts.cancel',
      utteranceId: info.utteranceId,
      truncateAtMs: info.truncateAtMs,
      spokenPrefix: spoken,
    })

    this.commitAgentTurn()
  }

  /**
   * The caller has gone quiet. Escalate gently, then close the line.
   *
   * Each rung is spoken once — the ladder does not repeat itself, because
   * "hello? hello? hello?" is the most machine-like thing an agent can do.
   */
  private async onSilence(stage: 'nudge' | 'checkIn' | 'hangUp'): Promise<void> {
    const key =
      stage === 'nudge' ? 'silenceNudge' : stage === 'checkIn' ? 'silenceCheckIn' : 'silenceHangUp'
    const line = this.opts.phraseFor?.(key, this.lang)
    if (line) await this.speak(line, this.lang, { backchannel: true })
    if (stage === 'hangUp') await this.close()
  }

  private async onBackchannel(): Promise<void> {
    const cached = this.opts.phraseFor?.('backchannel', this.lang)
    if (!cached) return
    await this.speak(cached, this.lang, { backchannel: true })
  }

  // ─── The turn ──────────────────────────────────────────────────────────────

  private async runCallerTurn(): Promise<void> {
    if (this.closed || !this.stt) return

    this.turnStartedAt = this.now()
    this.turnSeq += 1
    this.currentTurnId = `t${this.turnSeq}`

    const finished = this.stt
    this.stt = this.newSttStream()
    this.stt.onPartial((r) => {
      this.turns.onPartial(r.text, r.lang)
      this.emit({
        type: 'stt.partial',
        turnId: `t${this.turnSeq + 1}`,
        text: r.text,
        lang: r.lang,
        confidence: r.confidence,
      })
    })

    const result = await finished.end()
    this.sttMs = this.now() - this.turnStartedAt

    if (result.text.trim().length === 0) {
      this.turns.setState('idle')
      return
    }

    // Mirror the caller's language — the core of the multilingual policy.
    this.lang = result.lang
    this.emit({
      type: 'lang.detected',
      lang: result.lang,
      confidence: result.confidence,
      codeSwitched: result.codeSwitched,
    })
    this.emit({
      type: 'stt.final',
      turnId: this.currentTurnId,
      text: result.text,
      lang: result.lang,
      codeSwitched: result.codeSwitched,
    })

    this._history.push({ role: 'user', content: result.text })
    await this.runAgent()
  }

  /**
   * Stream the model, speaking each clause as it completes and running tools
   * inline. Loops when the model calls tools, so a booking can search, hold,
   * and confirm inside a single caller turn.
   */
  private async runAgent(depth = 0): Promise<void> {
    if (this.closed || depth > 6) return

    if (depth === 0) this.spokenThisTurn = []

    // Refresh the instructions from current state. Replaces in place rather
    // than appending: a second system message would leave the stale one to
    // compete with it.
    if (this.opts.buildInstructions && this._history[0]?.role === 'system') {
      this._history[0] = { role: 'system', content: this.opts.buildInstructions(this.lang) }
    }

    this.turns.setState('thinking')
    this.llmAbort = new AbortController()
    const signal = this.llmAbort.signal

    const chunker = new SentenceChunker(this.lang)
    const pendingCalls: ToolCall[] = []
    let generated = ''
    let firstToken = true

    try {
      for await (const delta of this.providers.llm.stream(this._history, this.tools.defs(), {
        signal,
      })) {
        if (signal.aborted) break

        if (delta.kind === 'text') {
          if (firstToken) {
            this.llmTtftMs = this.now() - this.turnStartedAt
            firstToken = false
          }
          generated += delta.text
          this.emit({ type: 'agent.token', turnId: this.currentTurnId, text: delta.text })
          for (const chunk of chunker.push(delta.text)) {
            if (signal.aborted) break
            await this.speak(chunk, this.lang)
          }
        } else if (delta.kind === 'tool_call') {
          pendingCalls.push(delta.call)
        }
      }

      if (!signal.aborted) {
        const tail = chunker.flush()
        if (tail) await this.speak(tail, this.lang)
      }
    } catch (err) {
      // An aborted stream is the normal barge-in path. Anything else is a real
      // failure and must be surfaced — a swallowed provider error presents as
      // an agent that simply chose not to speak, which is near-impossible to
      // diagnose from the outside.
      if (!signal.aborted) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[session ${this.id}] llm stream failed:`, message)
        this.emit({ type: 'error', code: 'llm_stream_failed', message, recoverable: true })

        // Say something. A caller who hears nothing assumes the line dropped
        // and hangs up; a caller who hears "sorry, say that once more" repeats
        // themselves and the call survives.
        if (this.spokenThisTurn.length === 0) {
          const recovery = this.opts.phraseFor?.('notUnderstood', this.lang)
          if (recovery) await this.speak(recovery, this.lang)
        }
      }
    }

    // On a barge-in, history was already committed by `onBargeIn` with the
    // truncated prefix. Committing again here would duplicate the turn.
    if (signal.aborted) return

    if (pendingCalls.length > 0) {
      // Content is deliberately empty. Anything spoken alongside a tool call is
      // recorded once, by `commitAgentTurn`, from what the caller actually
      // heard. Storing `generated` here too would put the same sentence in
      // history twice — and a model that sees itself say something twice says
      // it a third time, which is exactly how an agent starts repeating itself.
      this._history.push({ role: 'assistant', content: '', toolCalls: pendingCalls })
      await this.runTools(pendingCalls)
      await this.runAgent(depth + 1)
      return
    }

    this.commitAgentTurn()
    this.emitMetrics()
  }

  private async runTools(calls: ToolCall[]): Promise<void> {
    this.turns.setState('tool_running')

    for (const call of calls) {
      this.emit({ type: 'tool.call', id: call.id, name: call.name, args: call.args })
      const startedAt = this.now()

      // Dead air during a database query is the most common tell that you are
      // talking to a machine. A cached hold phrase costs nothing and removes it.
      const holdTimer = setTimeout(() => {
        const hold = this.opts.phraseFor?.('hold', this.lang)
        if (hold) void this.speak(hold, this.lang, { backchannel: true })
      }, BUDGETS.interaction.holdPhraseAfterMs)

      let ok = false
      let result: unknown = null
      try {
        const r = await this.tools.run(call)
        ok = r.ok
        result = r.result
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) }
      } finally {
        clearTimeout(holdTimer)
      }

      this.emit({
        type: 'tool.result',
        id: call.id,
        name: call.name,
        ok,
        result,
        ms: this.now() - startedAt,
      })

      this._history.push({
        role: 'tool',
        content: JSON.stringify(result),
        toolCallId: call.id,
        toolName: call.name,
      })
    }
  }

  /**
   * Write the agent's turn into history using what was *spoken*.
   *
   * This is the line that keeps an interrupted conversation coherent. The model
   * may have generated a full sentence; if the caller heard three words of it,
   * three words is what the agent said.
   */
  private commitAgentTurn(): void {
    const spoken = this.spokenThisTurn.join(' ').trim()
    if (spoken.length === 0) return
    this._history.push({ role: 'assistant', content: spoken })
    this.spokenThisTurn = []
  }

  // ─── Speaking ──────────────────────────────────────────────────────────────

  /**
   * Serialises speech.
   *
   * `speak()` is reached from three places that do not know about each other:
   * the agent loop, the backchannel timer, and the tool hold phrase. Two of
   * those fire on timers, so without a queue a "one moment" can begin streaming
   * while a sentence is still going out — two audio streams interleaved on one
   * connection, heard as the agent talking over herself.
   */
  private speechChain: Promise<void> = Promise.resolve()

  private speak(text: string, lang: Lang, opts: { backchannel?: boolean } = {}): Promise<void> {
    const next = this.speechChain.then(() => this.speakNow(text, lang, opts))
    // Keep the chain alive even if one utterance fails, or every later
    // utterance in the call is silently dropped.
    this.speechChain = next.catch(() => undefined)
    return next
  }

  private async speakNow(
    text: string,
    lang: Lang,
    opts: { backchannel?: boolean } = {},
  ): Promise<void> {
    if (this.closed || text.trim().length === 0) return

    const utteranceId = `u${++this.utteranceSeq}`
    const cached = this.opts.phraseFor?.(text, lang) !== null && opts.backchannel === true
    const startedAt = this.now()

    // Scoped to this utterance alone — see `utteranceAborts`.
    const ac = new AbortController()
    this.utteranceAborts.set(utteranceId, ac)

    // Provisional marks are available immediately; real ones replace them when
    // the provider reports. Interruption therefore works from the first sample.
    const provisional: WordMark[] = deriveWordMarks(text, estimateDurationMs(text, lang))

    // Numbers, dates and addresses are the content a caller writes down.
    // Deliver those with tighter, clearer settings even though it costs a
    // little of the natural variation used everywhere else.
    const precise = /\d/.test(text)
    // The voice follows the language, not the session — a mid-call switch to
    // Hindi must change the accent, not only the words.
    const voiceId = this.opts.voiceFor?.(lang) ?? this.voiceId
    const stream = this.providers.tts.synth(text, { voiceId, lang, precise })
    this.activeTts = stream

    this.emit({
      type: 'tts.begin',
      utteranceId,
      turnId: this.currentTurnId,
      text,
      lang,
      marks: provisional,
      cached,
    })

    // A backchannel must NOT take the floor. "Mm-hmm" is an acknowledgement
    // said *while the caller is still talking* — registering it as an agent
    // turn moves the state machine to `speaking`, which stops endpointing and
    // leaves the caller unable to finish their sentence at all.
    if (!opts.backchannel) {
      this.turns.onAgentSpeakStart(utteranceId, provisional, text)
      this.turnCached = cached
    }

    void stream.marks
      .then((real) => this.turns.refineMarks(utteranceId, real))
      .catch(() => undefined)

    let first = true
    try {
      for await (const pcm of stream.audio) {
        if (ac.signal.aborted || this.closed) break
        if (first) {
          this.ttsTtfbMs = this.now() - startedAt
          first = false
        }
        this.transport.sendAudio(pcm)
      }
    } catch {
      // An aborted synthesis is the normal barge-in path, not an error.
    }

    this.utteranceAborts.delete(utteranceId)
    if (this.activeTts === stream) this.activeTts = null

    // Reached the end without being cut off: the caller heard all of it.
    // Backchannels ("mm-hmm") are deliberately excluded — they are presence
    // signals, not statements, and putting them in history teaches the model
    // to treat them as content.
    if (!ac.signal.aborted && !opts.backchannel) {
      this.spokenThisTurn.push(text)
    }
  }

  // ─── Emission ──────────────────────────────────────────────────────────────

  private emit(event: ServerEvent): void {
    if (this.closed && event.type !== 'agent.state') return
    this.transport.send(event)
  }

  private emitMetrics(): void {
    this.emit({
      type: 'metrics.turn',
      turnId: this.currentTurnId,
      sttMs: this.sttMs,
      llmTtftMs: this.llmTtftMs,
      ttsTtfbMs: this.ttsTtfbMs,
      e2eMs: this.now() - this.turnStartedAt,
      tier: this.providers.llm.tier,
      cached: this.turnCached,
    })
  }
}

/** Re-exported so consumers can build a session without importing provider types. */
export type { LlmProvider, Message }
