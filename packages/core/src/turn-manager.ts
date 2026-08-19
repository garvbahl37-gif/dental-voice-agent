import { BUDGETS, type AgentState, type Lang, type WordMark } from '@vaani/shared'
import { classifyQuestion, silenceThresholdMs, type QuestionKind } from './endpointing'

/**
 * TurnManager — who has the floor, and when it changes hands.
 *
 * This is the human-ness engine. It owns three decisions a receptionist makes
 * without thinking:
 *
 *   1. Has the caller finished, or are they mid-thought?  (adaptive endpointing)
 *   2. They started talking while I was talking — stop, now. (barge-in)
 *   3. They have been going for a while — make a noise so they know I'm here.
 *      (backchannel)
 *
 * It holds no I/O and no timers of its own. The clock is injected and `tick()`
 * is driven externally, which makes every timing behaviour deterministically
 * testable and keeps the class portable across web, telephony, and WhatsApp.
 */

export interface BargeIn {
  utteranceId: string
  /** Playback position where the caller cut in — the truncation point. */
  truncateAtMs: number
  /**
   * Word timings for the interrupted utterance, carried in the event rather
   * than looked up afterwards: by the time the handler runs, the utterance is
   * no longer active, and these marks are the only way to recover what the
   * caller actually heard.
   */
  marks: WordMark[]
}

export interface TurnManagerEvents {
  stateChange(state: AgentState): void
  /** The caller has finished their turn; run the agent. */
  endpoint(): void
  bargeIn(info: BargeIn): void
  /** Emit a short acknowledgement so a long caller turn does not feel unheard. */
  backchannel(): void
  /**
   * Nobody has said anything for a while.
   *
   * `stage` escalates: a light nudge, then an explicit check, then closing the
   * line. Repeating the same "hello?" is what makes an agent feel like a
   * machine waiting on a timer.
   */
  silence(stage: 'nudge' | 'checkIn' | 'hangUp'): void
}

export interface TurnManagerOptions {
  now: () => number
  emit: TurnManagerEvents
}

interface ActiveUtterance {
  id: string
  marks: WordMark[]
  playedMs: number
}

export class TurnManager {
  private readonly now: () => number
  private readonly emit: TurnManagerEvents

  private _state: AgentState = 'idle'

  // Caller-side turn tracking
  private speechActive = false
  private silenceStartedAt: number | null = null
  private speechStartedAt: number | null = null
  private lastBackchannelAt: number | null = null
  private endpointFired = false
  private quietSince: number | null = null
  private silenceStage: 0 | 1 | 2 | 3 = 0
  private partialText = ''
  private partialLang: Lang = 'en-IN'

  // Agent-side turn tracking
  private active: ActiveUtterance | null = null
  private questionKind: QuestionKind = 'none'

  constructor(opts: TurnManagerOptions) {
    this.now = opts.now
    this.emit = opts.emit
    // The line is quiet from the moment it opens.
    this.quietSince = opts.now()
  }

  get state(): AgentState {
    return this._state
  }

  /** The interim transcript the endpointing decision is currently based on. */
  get currentPartial(): string {
    return this.partialText
  }

  setState(next: AgentState): void {
    if (this._state === next) return
    this._state = next
    // The silence clock starts when the conversation actually falls quiet,
    // not on the next tick — otherwise the first measurement is always zero.
    if (next === 'idle') {
      this.quietSince = this.now()
      this.silenceStage = 0
    }
    this.emit.stateChange(next)
  }

  // ─── Caller signals ────────────────────────────────────────────────────────

  /**
   * The caller started speaking. If the agent had the floor, this is a barge-in
   * and it must be handled here, synchronously, before anything else — every
   * millisecond between this call and silence is a millisecond the caller is
   * talking over a machine that has not noticed.
   */
  onVadSpeechStart(): void {
    if (this._state === 'speaking' && this.active) {
      this.emit.bargeIn({
        utteranceId: this.active.id,
        truncateAtMs: this.active.playedMs,
        marks: this.active.marks,
      })
      this.active = null
    }

    this.speechActive = true
    this.silenceStartedAt = null
    this.endpointFired = false
    // Any speech resets the whole silence ladder.
    this.quietSince = null
    this.silenceStage = 0

    if (this.speechStartedAt === null) {
      this.speechStartedAt = this.now()
      this.lastBackchannelAt = this.now()
    }

    this.setState('listening')
  }

  onVadSpeechEnd(): void {
    this.speechActive = false
    this.silenceStartedAt = this.now()
  }

  onPartial(text: string, lang: Lang): void {
    this.partialText = text
    this.partialLang = lang
  }

  // ─── Agent signals ─────────────────────────────────────────────────────────

  onAgentSpeakStart(utteranceId: string, marks: WordMark[], text: string): void {
    this.active = { id: utteranceId, marks, playedMs: 0 }
    this.quietSince = null
    this.silenceStage = 0
    // Classify now: the pause that follows this utterance is the one whose
    // length should adapt to what was just asked.
    this.questionKind = classifyQuestion(text)
    this.setState('speaking')
  }

  /**
   * How much of the current utterance has actually reached the caller.
   * Frames for a superseded utterance are dropped — after a barge-in the client
   * may still have progress reports in flight for audio that no longer matters.
   */
  onPlaybackProgress(utteranceId: string, playedMs: number): void {
    if (!this.active || this.active.id !== utteranceId) return
    this.active.playedMs = Math.max(this.active.playedMs, playedMs)
  }

  onPlaybackComplete(utteranceId: string): void {
    if (this.active?.id !== utteranceId) return
    this.active = null
    this.resetCallerTurn()
    this.setState('idle')
  }

  /** Word marks for the utterance currently being spoken, for truncation. */
  activeMarks(): WordMark[] {
    return this.active?.marks ?? []
  }

  /**
   * Replace provisional marks with real ones once the TTS provider reports
   * them. Playback position is preserved — only the timing map improves, so an
   * interruption arriving a moment later truncates more accurately.
   */
  refineMarks(utteranceId: string, marks: WordMark[]): void {
    if (!this.active || this.active.id !== utteranceId || marks.length === 0) return
    this.active.marks = marks
  }

  // ─── Clock ─────────────────────────────────────────────────────────────────

  /**
   * Drive the silence and backchannel timers. Called on every inbound audio
   * frame (every ~20 ms), so the endpoint decision has frame-level resolution.
   */
  tick(): void {
    const t = this.now()

    // ── Silence ladder ──────────────────────────────────────────────────
    // Only while genuinely idle: not mid-turn, not while the agent speaks.
    if (this._state === 'idle' && !this.speechActive) {
      if (this.quietSince === null) this.quietSince = t
      const quiet = t - this.quietSince
      const { nudgeAfterMs, checkInAfterMs, hangUpAfterMs } = BUDGETS.interaction

      if (this.silenceStage < 1 && quiet >= nudgeAfterMs) {
        this.silenceStage = 1
        this.emit.silence('nudge')
      } else if (this.silenceStage < 2 && quiet >= checkInAfterMs) {
        this.silenceStage = 2
        this.emit.silence('checkIn')
      } else if (this.silenceStage < 3 && quiet >= hangUpAfterMs) {
        this.silenceStage = 3
        this.emit.silence('hangUp')
      }
    } else if (this._state !== 'idle') {
      this.quietSince = null
    }

    if (this.speechActive && this._state === 'listening' && this.lastBackchannelAt !== null) {
      if (t - this.lastBackchannelAt >= BUDGETS.interaction.backchannelAfterMs) {
        this.lastBackchannelAt = t
        this.emit.backchannel()
      }
      return
    }

    if (
      !this.speechActive &&
      this.silenceStartedAt !== null &&
      !this.endpointFired &&
      this._state === 'listening'
    ) {
      const threshold = silenceThresholdMs({
        questionKind: this.questionKind,
        partialText: this.partialText,
        lang: this.partialLang,
      })
      if (t - this.silenceStartedAt >= threshold) {
        this.endpointFired = true
        this.silenceStartedAt = null
        this.resetCallerTurn()
        this.emit.endpoint()
      }
    }
  }

  private resetCallerTurn(): void {
    this.speechStartedAt = null
    this.lastBackchannelAt = null
    this.partialText = ''
  }
}
