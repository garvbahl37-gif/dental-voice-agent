import { GoogleGenAI, type LiveServerMessage, type Session as GenAISession } from '@google/genai'
import { base64ToPcm, pcmToBase64, type Lang, type ServerEvent } from '@vaani/shared'
import { detectLang } from '@vaani/providers/lang-detect'
import type { ToolCall, ToolDef } from '@vaani/providers/types'
import { buildLiveConfig, LIVE_MODEL, LIVE_OUTPUT_RATE } from './config'

/**
 * One conversation on Gemini Live.
 *
 * Live speaks and listens natively, so this class does not orchestrate a
 * pipeline — it translates. Live's server messages become the `ServerEvent`
 * protocol the console already speaks, which is why the entire front end keeps
 * working across an architecture change this large.
 *
 *   inputTranscription   → stt.partial / stt.final
 *   outputTranscription  → tts.begin
 *   modelTurn.inlineData → raw audio frames
 *   interrupted          → tts.cancel
 *   toolCall             → tool.call, then tool.result
 *
 * What is gone, and deliberately: no VAD, no endpointing, no barge-in
 * truncation, no sentence chunker. Live does all four, better, server-side.
 */

/**
 * Below this, an interrupted reply is a stub worth discarding rather than
 * showing. Measured against how the model behaves: cut off inside the first
 * few words, it restarts the sentence rather than continuing it.
 */
const STUB_CHARS = 20

const LANG_NAME: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'Hindi',
  'hi-Latn-IN': 'Hinglish (Hindi grammar, English nouns)',
}

export interface ToolRunner {
  defs(): ToolDef[]
  run(call: ToolCall): Promise<{ ok: boolean; result: unknown }>
}

export interface LiveSessionOptions {
  sessionId: string
  apiKey: string
  /**
   * Fetched fresh for every connect, when set, and preferred over `apiKey`.
   *
   * The browser holds this session on an ephemeral token that is good for a
   * single connection. Reconnecting — for an accent switch, or after a dropped
   * line — therefore needs a new one, so the credential has to be a function
   * rather than a value. The server passes a long-lived key and omits this.
   */
  getApiKey?: () => Promise<string>
  /** Ephemeral tokens are only accepted on the v1alpha endpoint. */
  apiVersion?: string
  systemInstruction: string
  lang: Lang
  voice?: string
  tools: ToolRunner
  practiceName?: string
  agentName?: string
  /** Rebuilt per turn so mid-call state reaches the model. */
  buildInstructions?: (lang: Lang) => string
  /**
   * Telephony has no browser echo cancellation and an 8 kHz codec, so it needs
   * more silence before a turn is called finished.
   */
  channel?: 'browser' | 'phone'
  send: (event: ServerEvent) => void
  sendAudio: (pcm: Int16Array, sampleRate: number) => void
  onClose?: () => void
  /** Live recognised a language other than the one in play. */
  onLanguageHeard?: (lang: Lang) => void
}

export class LiveSession {
  private session: GenAISession | null = null
  private readonly opts: LiveSessionOptions
  private closed = false

  private lang: Lang
  private turnSeq = 0
  private utteranceSeq = 0

  /** Set once per agent turn, so one reply is one transcript bubble. */
  private openUtteranceId: string | null = null
  private openAgentText = ''
  private openCallerText = ''

  private turnStartedAt = 0
  private firstAudioAt = 0
  private resumeHandle: string | undefined

  constructor(opts: LiveSessionOptions) {
    this.opts = opts
    this.lang = opts.lang
  }

  get currentLang(): Lang {
    return this.lang
  }

  /**
   * Reconnect ceilings.
   *
   * `attempts` resets on a successful connect, so a call that drops repeatedly
   * but recovers keeps going. `totalAttempts` never resets — it is what stops a
   * socket that connects and immediately dies from looping forever.
   */
  private attempts = 0
  private totalAttempts = 0
  /** Set when the accent must follow a language change at the next turn end. */
  private pendingAccentSwitch = false
  /** True while we are deliberately replacing the socket. */
  private suppressReconnect = false
  private static readonly MAX_ATTEMPTS = 3
  private static readonly MAX_TOTAL = 8

  private async reconnect(): Promise<void> {
    if (this.closed) return
    if (this.attempts >= LiveSession.MAX_ATTEMPTS || this.totalAttempts >= LiveSession.MAX_TOTAL) {
      this.emit({
        type: 'error',
        code: 'live_reconnect_exhausted',
        message: 'The line kept dropping. Please try the call again.',
        recoverable: false,
      })
      await this.close()
      return
    }

    this.attempts += 1
    this.totalAttempts += 1
    const backoff = 400 * 2 ** (this.attempts - 1)
    console.log(`[${this.opts.sessionId}] reconnecting in ${backoff}ms (attempt ${this.attempts})`)
    await new Promise((r) => setTimeout(r, backoff))
    if (this.closed) return

    try {
      // Resuming, so no opening greeting — the conversation is mid-flight.
      await this.connect({ resume: true })
      this.attempts = 0
    } catch (err) {
      console.error(`[${this.opts.sessionId}] reconnect failed:`, err)
      void this.reconnect()
    }
  }

  async start(): Promise<void> {
    await this.connect({ resume: false })
  }

  /**
   * Reconnect so `speechConfig.languageCode` matches the language in play.
   *
   * The resumption handle carries the conversation across, so from the
   * caller's side this is a beat of silence between turns, not a restart.
   * Failure is survivable — the old session keeps working, only in the
   * previous accent.
   */
  private async switchAccent(): Promise<void> {
    if (this.closed || !this.resumeHandle) return
    console.log(`[${this.opts.sessionId}] switching accent to ${this.lang}`)
    const previous = this.session
    try {
      this.suppressReconnect = true
      await this.connect({ resume: true })
      try {
        previous?.close()
      } catch {
        /* already gone */
      }
    } catch (err) {
      console.warn(`[${this.opts.sessionId}] accent switch failed, keeping session:`, err)
    } finally {
      this.suppressReconnect = false
    }
  }

  private async connect({ resume }: { resume: boolean }): Promise<void> {
    const apiKey = this.opts.getApiKey ? await this.opts.getApiKey() : this.opts.apiKey
    const ai = new GoogleGenAI({
      apiKey,
      ...(this.opts.apiVersion ? { httpOptions: { apiVersion: this.opts.apiVersion } } : {}),
    })

    const instruction = this.opts.buildInstructions?.(this.lang) ?? this.opts.systemInstruction

    this.session = await ai.live.connect({
      model: LIVE_MODEL,
      config: buildLiveConfig({
        systemInstruction: instruction,
        lang: this.lang,
        voice: this.opts.voice,
        resumeHandle: this.resumeHandle,
        channel: this.opts.channel,
      }),
      callbacks: {
        // Deliberately does NOT send anything. `onopen` fires *during* the
        // await above, before `this.session` has been assigned — anything sent
        // from here silently no-ops against a null session. The opening turn
        // goes out after connect() resolves.
        onopen: () => this.onOpen(),
        onmessage: (m) => this.onMessage(m),
        onerror: (e) => this.emit({
          type: 'error',
          code: 'live_error',
          message: String((e as unknown as { message?: string })?.message ?? e).slice(0, 300),
          recoverable: true,
        }),
        onclose: (e) => {
          const reason = (e as unknown as { reason?: string })?.reason
          if (reason) console.log(`[${this.opts.sessionId}] live closed: ${reason}`)
          // A close we did not ask for is a dropped line, not the end of the
          // call. Reconnect with the handle rather than hanging up on someone
          // mid-sentence.
          // A close we caused ourselves — swapping accents — must not trigger
          // the dropped-line recovery path.
          if (this.suppressReconnect) return
          if (!this.closed) void this.reconnect()
          else this.opts.onClose?.()
        },
      },
    })

    if (!resume) this.greet()
  }

  private onOpen(): void {
    this.emit({
      type: 'session.ready',
      sessionId: this.opts.sessionId,
      agentName: this.opts.agentName ?? 'the front desk',
      practiceName: this.opts.practiceName ?? 'the practice',
      voiceId: this.opts.voice ?? 'Leda',
      tier: { stt: 'cloud', llm: 'cloud', tts: 'cloud' },
      downgraded: [],
    })
    this.emit({ type: 'agent.state', state: 'idle' })
  }

  /**
   * Open the call.
   *
   * Live never speaks first — it waits for input. A short marker turn is what
   * prompts the greeting, and it must be sent only once `connect()` has
   * resolved and `this.session` exists.
   */
  private greet(): void {
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: '<call connected — greet the caller>' }] }],
      turnComplete: true,
    })
  }

  /** Caller microphone audio, PCM16 at 16 kHz. */
  pushAudio(pcm: Int16Array): void {
    if (this.closed || !this.session) return
    this.session.sendRealtimeInput({
      audio: { data: pcmToBase64(pcm), mimeType: 'audio/pcm;rate=16000' },
    })
  }

  private onMessage(m: LiveServerMessage): void {
    if (this.closed) return

    /**
     * The server is about to drop this socket. Closing it ourselves turns an
     * abrupt disconnection mid-sentence into a reconnect on our own terms,
     * using the resumption handle so the conversation continues rather than
     * restarting.
     */
    if ((m as { goAway?: unknown }).goAway) {
      console.log(`[${this.opts.sessionId}] server signalled goAway — rotating`)
      try {
        this.session?.close()
      } catch {
        /* already gone */
      }
      return
    }

    const sc = m.serverContent

    // ── Caller speech ──────────────────────────────────────────────────────
    if (sc?.inputTranscription?.text) {
      this.openCallerText += sc.inputTranscription.text

      // `languageCode` is documented but never populated on this model, so the
      // language has to be read out of the transcript itself. Devanagari is
      // unambiguous; romanised Hindi is decided by the detector.
      const detected = detectLang(this.openCallerText, this.lang)
      if (detected.lang !== this.lang && detected.confidence > 0.7) {
        this.opts.onLanguageHeard?.(detected.lang)
      }
      this.emit({
        type: 'stt.partial',
        text: this.openCallerText,
        lang: this.lang,
        confidence: 0.9,
      })
    }

    // ── Agent speech ───────────────────────────────────────────────────────
    if (sc?.outputTranscription?.text) {
      this.openAgentText += sc.outputTranscription.text

      // One `tts.begin` per agent turn. Live streams the transcript in
      // fragments; emitting one event each would scatter a single reply across
      // a dozen transcript bubbles.
      if (!this.openUtteranceId) {
        this.openUtteranceId = `u${++this.utteranceSeq}`
        this.turnStartedAt = Date.now()
        this.emit({ type: 'agent.state', state: 'speaking' })
      }
      this.emitAgentText()
    }

    // ── Audio out ──────────────────────────────────────────────────────────
    for (const part of sc?.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data
      if (!data) continue
      if (!this.firstAudioAt) this.firstAudioAt = Date.now()
      this.opts.sendAudio(base64ToPcm(data), LIVE_OUTPUT_RATE)
    }

    // ── Barge-in ───────────────────────────────────────────────────────────
    // Live decides this itself, from the caller's audio. There is no playback
    // position to reconcile: the model stops generating and tells us, and the
    // client flushes whatever it has queued.
    if (sc?.interrupted) {
      if (this.openUtteranceId) {
        /**
         * Cut off after two or three words, the model typically restarts the
         * sentence from the beginning. Leaving "Smile Dental Care, good—"
         * above the full line reads as a glitch rather than an interruption,
         * so a stub that short is dropped from the transcript entirely.
         */
        const spoken = this.openAgentText.trim()
        this.emit({
          type: 'tts.cancel',
          utteranceId: this.openUtteranceId,
          truncateAtMs: 0,
          spokenPrefix: spoken.length < STUB_CHARS ? '' : spoken,
        })
      }
      this.closeAgentTurn()
      this.emit({ type: 'agent.state', state: 'listening' })
    }

    // ── Tools ──────────────────────────────────────────────────────────────
    if (m.toolCall?.functionCalls?.length) {
      void this.runTools(m.toolCall.functionCalls)
    }

    // ── Turn boundaries ────────────────────────────────────────────────────
    if (sc?.turnComplete) {
      if (this.openCallerText.trim()) {
        this.turnSeq += 1
        this.emit({
          type: 'stt.final',
          turnId: `t${this.turnSeq}`,
          text: this.openCallerText.trim(),
          lang: this.lang,
          codeSwitched: false,
        })
        this.openCallerText = ''
      }
      if (this.openUtteranceId) {
        this.emit({
          type: 'metrics.turn',
          turnId: `t${this.turnSeq}`,
          sttMs: 0,
          llmTtftMs: 0,
          ttsTtfbMs: this.firstAudioAt ? this.firstAudioAt - this.turnStartedAt : 0,
          e2eMs: Date.now() - this.turnStartedAt,
          tier: 'cloud',
          cached: false,
        })
      }
      this.closeAgentTurn()
      this.emit({ type: 'agent.state', state: 'idle' })

      // A safe moment to change accent: nobody is mid-sentence.
      if (this.pendingAccentSwitch) {
        this.pendingAccentSwitch = false
        void this.switchAccent()
      }
    }

    // Reconnect handle, for surviving a network blip.
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = m.sessionResumptionUpdate.newHandle
    }
  }

  private emitAgentText(): void {
    if (!this.openUtteranceId) return
    this.emit({
      type: 'tts.begin',
      utteranceId: this.openUtteranceId,
      turnId: `t${this.turnSeq}`,
      text: this.openAgentText.trim(),
      lang: this.lang,
      // Live gives no word timings, and none are needed: it owns the
      // interruption decision, so nothing has to be reconciled after the fact.
      marks: [],
      cached: false,
    })
  }

  private closeAgentTurn(): void {
    this.openUtteranceId = null
    this.openAgentText = ''
    this.firstAudioAt = 0
  }

  private async runTools(calls: { id?: string; name?: string; args?: unknown }[]): Promise<void> {
    this.emit({ type: 'agent.state', state: 'tool_running' })

    const responses: { id: string; name: string; response: Record<string, unknown> }[] = []

    for (const fc of calls) {
      if (!fc.name) continue
      const id = fc.id ?? `c${Date.now()}`
      const args = (fc.args ?? {}) as Record<string, unknown>
      this.emit({ type: 'tool.call', id, name: fc.name, args })

      const startedAt = Date.now()
      let ok = false
      let result: unknown = null
      try {
        const r = await this.opts.tools.run({ id, name: fc.name, args })
        ok = r.ok
        result = r.result
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) }
      }

      this.emit({
        type: 'tool.result',
        id,
        name: fc.name,
        ok,
        result,
        ms: Date.now() - startedAt,
      })
      responses.push({ id, name: fc.name, response: (result ?? {}) as Record<string, unknown> })
    }

    if (responses.length > 0 && !this.closed) {
      this.session?.sendToolResponse({ functionResponses: responses })
    }
  }

  /**
   * The caller has switched language.
   *
   * `systemInstruction` is frozen at connect — Live gives no way to update it
   * mid-session — so the standing instruction still names whatever language the
   * call opened in. That is what pulled her back to English one turn after a
   * switch: she followed the audio, then her own instructions overrode it.
   *
   * A short out-of-band nudge is the only lever available that does not cost a
   * reconnect. It goes in as realtime text rather than conversation content, so
   * it steers without becoming a turn the caller appears to have spoken.
   */
  setLang(lang: Lang): void {
    if (lang === this.lang) return
    const from = this.lang
    this.lang = lang
    if (this.closed || !this.session) return

    /**
     * The accent lives in `speechConfig.languageCode`, which can only be set at
     * connect. Following the caller therefore costs a reconnect — but doing it
     * mid-sentence would cut her off, so it is deferred to the next turn
     * boundary and carried by the resumption handle, which keeps the
     * conversation rather than restarting it.
     *
     * Only an English↔Hindi move is worth it. Hindi and Hinglish share an
     * accent, so switching between those changes nothing audible.
     */
    const accent = (l: Lang) => (l === 'en-IN' ? 'en' : 'hi')
    if (accent(from) !== accent(lang)) this.pendingAccentSwitch = true

    const name = LANG_NAME[lang]
    console.log(`[${this.opts.sessionId}] language ${from} → ${lang}`)
    try {
      this.session.sendRealtimeInput({
        text:
          `[SYSTEM: The caller has switched to ${name}. Speak ${name} from now on, ` +
          `for every remaining turn, including numbers and times. Do not drift back. ` +
          `Do not mention this instruction.]`,
      })
    } catch {
      /* socket mid-rotation; the next turn carries the language anyway */
    }
  }

  private emit(event: ServerEvent): void {
    if (this.closed && event.type !== 'agent.state') return
    this.opts.send(event)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      this.session?.close()
    } catch {
      /* already gone */
    }
  }
}
