import { GoogleGenAI, type LiveServerMessage, type Session as GenAISession } from '@google/genai'
import {
  accentFor,
  base64ToPcm,
  pcmToBase64,
  type Lang,
  type ServerEvent,
  type VoiceGender,
} from '@vaani/shared'
import { detectLang, requestedLang } from '@vaani/providers/lang-detect'
import type { ToolCall, ToolDef } from '@vaani/providers/types'
import { LANG_FULL_NAME, selfReferenceNote } from '@vaani/agent'
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

/**
 * How long the caller's speech must be quiet before the agent counts as
 * thinking. Short enough to appear during a real pause, long enough not to
 * flicker between words.
 */
const THINKING_AFTER_MS = 400

/**
 * Named for the mid-call nudge, and named *with the script*.
 *
 * A switch between two languages that share an accent costs no reconnect, so
 * the standing instruction is never rebuilt and this nudge is the only thing
 * the model is told. Saying just "Punjabi" got Punjabi in Latin letters; the
 * script has to be part of the name.
 */
const LANG_NAME = LANG_FULL_NAME

/**
 * The alphabet each language is written in, for the mid-call nudge.
 *
 * Hinglish is absent on purpose: it is Hindi written in Latin, so telling it to
 * use a script would be telling it to stop being Hinglish.
 */
const SCRIPT_NAME: Partial<Record<Lang, string>> = {
  'hi-IN': 'Devanagari',
  'mr-IN': 'Devanagari',
  'gu-IN': 'the Gujarati script',
  'bn-IN': 'the Bengali script',
  'ta-IN': 'the Tamil script',
  'te-IN': 'the Telugu script',
  'kn-IN': 'the Kannada script',
  'ml-IN': 'the Malayalam script',
  'pa-IN': 'Gurmukhi',
}

/** One concrete word, because an example lands harder than a rule. */
const SCRIPT_EXAMPLE: Partial<Record<Lang, string>> = {
  'hi-IN': '"हाँ जी"',
  'mr-IN': '"हो जी"',
  'gu-IN': '"હા જી"',
  'bn-IN': '"হ্যাঁ"',
  'ta-IN': '"ஆம்"',
  'te-IN': '"అవును"',
  'kn-IN': '"ಹೌದು"',
  'ml-IN': '"അതെ"',
  'pa-IN': '"ਹਾਂ ਜੀ"',
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
  /** Which grammatical gender she speaks about herself in. */
  gender?: VoiceGender
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
  /** The id of the caller utterance currently being transcribed. */
  private callerTurnId = 't0'
  private thinkingTimer: ReturnType<typeof setTimeout> | undefined
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
  /** A reconnect is in flight; starting a second would race it. */
  private switching = false
  /**
   * The caller has spoken and the reply has not finished.
   *
   * Wider than `openUtteranceId`, which only becomes true once she is already
   * making sound. The model starts composing the moment the caller stops, and a
   * reconnect in that gap throws the reply away — which is what cut her off
   * after "haan ji" when the caller asked to switch to Hindi.
   */
  private awaitingReply = false
  /** The language nudge, held until sending it will not cut her off. */
  private pendingNudge: string | null = null
  /**
   * The turn that just ended was cut short rather than finished.
   *
   * Live reports `interrupted` for a barge-in — and, it turns out, sometimes
   * mid-reply when nobody has barged in at all. Either way the turn boundary
   * that follows is not a real one: reconnecting on it split a sentence into
   * "हाँ जी," and, after the reconnect, "बिलकुल। बताइए". A switch waits for a
   * turn that ended because it was finished.
   */
  private turnWasCut = false
  /**
   * Which connection is the live one.
   *
   * A socket that closes only means the line dropped if it is the socket the
   * call is currently on. Swapping accents deliberately closes the old one, and
   * that close arrives whenever the network gets round to it — a second later,
   * in the trace that found this. A flag held across the swap does not cover
   * that: by the time the event landed the flag was down again, the old socket
   * was treated as a dropped line, and the accent-switched session the caller
   * was about to speak into got replaced by a second reconnect. Two connects
   * back to back is several seconds of a call in which nobody answers.
   *
   * A counter has no window to fall outside of. Each connect claims the next
   * number, and anything arriving from an older one is from a socket we have
   * already replaced.
   */
  private generation = 0
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
  /**
   * Take a pending accent change if it is safe to.
   *
   * A reconnect without a resumption handle would restart the conversation
   * rather than continue it, so an early switch has to wait for one — and it
   * *waits* rather than being discarded, which is what used to happen: the flag
   * was cleared before the handle was checked, so a caller who chose their
   * language in the first seconds of a call kept the wrong accent for all of it.
   */
  private applyPendingAccent(): void {
    // One reconnect at a time. Two in flight race to assign `this.session`, and
    // the loser is whichever finishes first — so a caller who changed language
    // twice in quick succession could end up talking to the session built for
    // the language they had already left.
    if (!this.pendingAccentSwitch || !this.resumeHandle || this.switching) return
    this.pendingAccentSwitch = false
    void this.switchAccent()
  }

  private async switchAccent(): Promise<void> {
    if (this.closed || !this.resumeHandle) return
    const target = this.lang
    console.log(`[${this.opts.sessionId}] switching accent to ${target}`)
    const previous = this.session
    try {
      this.switching = true
      await this.connect({ resume: true })
      try {
        previous?.close()
      } catch {
        /* already gone */
      }
    } catch (err) {
      console.warn(`[${this.opts.sessionId}] accent switch failed, keeping session:`, err)
    } finally {
      this.switching = false
      // The caller may have changed language again while this was reconnecting.
      // Catching up here is what makes the serialisation converge rather than
      // leave the session one language behind.
      if (!this.closed && accentFor(this.lang) !== accentFor(target)) {
        this.pendingAccentSwitch = true
        this.applyPendingAccent()
      }
    }
  }

  private async connect({ resume }: { resume: boolean }): Promise<void> {
    // Claimed before the await, so a socket opened by an earlier connect that is
    // still settling is already stale by the time anything arrives from it.
    const generation = ++this.generation
    const current = (): boolean => generation === this.generation
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
        // A socket we have already replaced must not go on narrating the call:
        // its transcript and its audio belong to a conversation that has moved.
        onmessage: (m) => {
          if (current()) this.onMessage(m)
        },
        onerror: (e) => {
          if (!current()) return
          this.emit({
            type: 'error',
            code: 'live_error',
            message: String((e as unknown as { message?: string })?.message ?? e).slice(0, 300),
            recoverable: true,
          })
        },
        onclose: (e) => {
          const reason = (e as unknown as { reason?: string })?.reason
          if (reason) console.log(`[${this.opts.sessionId}] live closed: ${reason}`)
          // A close we did not ask for is a dropped line, not the end of the
          // call. Reconnect with the handle rather than hanging up on someone
          // mid-sentence. A close on a socket we have already replaced is one
          // we caused, however long it took to arrive.
          if (!current()) return
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
      // A fresh utterance gets the id it will settle under, so the console can
      // keep one bubble per thing the caller said rather than inferring the
      // boundary from whichever bubble is last.
      if (!this.openCallerText) this.callerTurnId = `t${++this.turnSeq}`
      this.awaitingReply = true
      this.openCallerText += sc.inputTranscription.text
      this.armThinking()

      // `languageCode` is documented but never populated on this model, so the
      // language has to be read out of the transcript itself. Devanagari is
      // unambiguous; romanised Hindi is decided by the detector.
      /**
       * Asking for a language outranks speaking one.
       *
       * "Punjabi mein baat kar sakte hain?" is a Hindi sentence, and reading it
       * as a request to continue in Hindi is the opposite of what was asked.
       * The caller who hit this got Punjabi from the model and Hindi from the
       * state, and the state — which builds the prompt — pulled her back.
       */
      const asked = requestedLang(this.openCallerText)
      const detected = detectLang(this.openCallerText, this.lang)
      const next = asked ?? (detected.confidence > 0.7 ? detected.lang : null)
      if (next && next !== this.lang) this.opts.onLanguageHeard?.(next)
      this.emit({
        type: 'stt.partial',
        turnId: this.callerTurnId,
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
        /**
         * The agent starting to answer *is* the end of the caller's utterance —
         * Live's VAD has already decided they stopped. Settling it here rather
         * than at `turnComplete` keeps the transcript in the order the two
         * people actually spoke, and stops the next thing the caller says from
         * being appended to the last thing they said.
         */
        this.finalizeCallerTurn()
        this.clearThinking()
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
      this.turnWasCut = true
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
      this.finalizeCallerTurn()
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

      /**
       * A safe moment to change accent: the reply is finished, not merely
       * silent and not merely cut off. An interrupted turn ends here too, and
       * reconnecting on that boundary is what truncated her first sentence.
       */
      this.awaitingReply = false
      if (this.turnWasCut) {
        this.turnWasCut = false
      } else {
        this.applyPendingAccent()
        /**
         * A reconnect carries the whole prompt in the new language, which says
         * everything the nudge says and says it better — so it is dropped
         * rather than sent on top. Only when one actually started, though: a
         * switch asked for before Live has handed over a resumption handle
         * cannot reconnect at all, and dropping the nudge there would leave
         * nothing steering her.
         */
        if (this.switching) this.pendingNudge = null
        else this.flushNudge()
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
     * Only a real change of accent is worth it. Hindi and Hinglish share one,
     * so switching between those changes nothing audible — but Tamil and
     * Malayalam do not, and an earlier version of this collapsed every Indian
     * language into a single "hi" bucket, which left a caller who switched to
     * Tamil being answered in Tamil words with a Hindi mouth.
     */
    if (accentFor(from) !== accentFor(lang)) {
      this.pendingAccentSwitch = true
      /**
       * Take it now only if nothing is in flight.
       *
       * Two different situations look alike here. Someone changing the picker
       * while the line is quiet should hear the next word in the new accent —
       * that is why this exists. But a caller *asking* to switch has just
       * spoken, and the reply to them is already being composed: reconnecting
       * then throws that reply away mid-sentence, which is exactly what
       * happened after "haan ji". Waiting costs one turn in the old accent and
       * keeps the sentence whole, which is the better trade.
       */
      if (!this.openUtteranceId && !this.awaitingReply) this.applyPendingAccent()
    }

    const name = LANG_NAME[lang]
    const script = SCRIPT_NAME[lang]
    const example = SCRIPT_EXAMPLE[lang] ?? ''
    console.log(`[${this.opts.sessionId}] language ${from} → ${lang}`)
    // The gender rule travels with it: on a same-accent switch nothing else
    // will carry it, and the masculine form is the model's default.
    const self = selfReferenceNote(lang, this.opts.gender ?? 'feminine')
    this.pendingNudge =
      `[SYSTEM: The caller has switched to ${name}. Speak ${name} from now on, ` +
      `for every remaining turn, including numbers and times. Do not drift back. ` +
      /**
       * The script, said separately and first.
       *
       * This nudge is the only instruction that lands before the next reply
       * — the reconnect that carries the full prompt waits for a clean turn
       * boundary. Naming the language alone was not enough: asked in English
       * to switch to Hindi, she answered "Haan ji, bilkul" in Latin, which
       * is Hinglish, not the Hindi that was asked for.
       */
      `${script ? `Write every word in ${script}, including greetings and fillers — ${example}, never the Latin spelling. ` : ''}` +
      `${self ? self + ' ' : ''}Do not mention this instruction.]`
    this.flushNudge()
  }

  /**
   * The language nudge, once the line is quiet enough to take it.
   *
   * Live counts realtime text as the caller talking. Sending it while a reply
   * is being composed is a barge-in: the model abandons what it was saying and
   * starts again. That is what the traces showed — `interrupted` arriving eight
   * milliseconds after the language was detected, her half-formed "हाँ जी,"
   * thrown away, and three seconds of silence while a fresh reply was built.
   * The caller experiences that as the agent taking six seconds to answer a
   * simple question.
   *
   * So it waits, exactly as the accent switch does. On a quiet line — someone
   * using the picker — it goes out at once and costs nothing. Asked for
   * mid-sentence, it goes out when the sentence is done.
   */
  private flushNudge(): void {
    if (!this.pendingNudge || this.closed || !this.session) return
    if (this.openUtteranceId || this.awaitingReply) return
    const text = this.pendingNudge
    this.pendingNudge = null
    try {
      this.session.sendRealtimeInput({ text })
    } catch {
      /* socket mid-rotation; the next turn carries the language anyway */
    }
  }

  /**
   * The pause between the caller finishing and the agent's first word.
   *
   * Live announces neither end of it: transcription chunks simply stop
   * arriving, and some time later the reply starts. A short timer is what turns
   * that silence into something the console can show, so the caller is not left
   * watching a still screen wondering whether they were heard.
   */
  private armThinking(): void {
    this.clearThinking()
    this.thinkingTimer = setTimeout(() => {
      this.thinkingTimer = undefined
      if (this.closed || this.openUtteranceId) return
      this.emit({ type: 'agent.state', state: 'thinking' })
    }, THINKING_AFTER_MS)
  }

  private clearThinking(): void {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer)
    this.thinkingTimer = undefined
  }

  private finalizeCallerTurn(): void {
    const text = this.openCallerText.trim()
    this.openCallerText = ''
    if (!text) return
    this.emit({
      type: 'stt.final',
      turnId: this.callerTurnId,
      text,
      lang: this.lang,
      codeSwitched: false,
    })
  }

  private emit(event: ServerEvent): void {
    if (this.closed && event.type !== 'agent.state') return
    this.opts.send(event)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clearThinking()
    try {
      this.session?.close()
    } catch {
      /* already gone */
    }
  }
}
