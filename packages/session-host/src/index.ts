import { LiveSession } from '@vaani/live'
import {
  CallLog,
  DentalTools,
  PracticeStore,
  buildCallRecord,
  describeConversation,
  extractFacts,
  learn,
  newConversation,
  noteAsked,
  observeLanguage,
  speakable,
  systemPrompt,
} from '@vaani/agent'
import type { Transport } from '@vaani/core'
import type { Lang, ServerEvent, VoiceGender } from '@vaani/shared'

/**
 * One call, independent of what is hosting it.
 *
 * This was inlined in the long-running Node server, which was fine while that
 * was the only place a call could happen. It is a module of its own now so the
 * same call can run inside a serverless function, where a free host's cold
 * start does not make the first visitor of the day wait a minute for a demo.
 *
 * Everything host-shaped is a parameter: the transport, and how to hang up.
 */
export interface VoiceSessionOptions {
  sessionId: string
  transport: Transport
  /** Chosen before the call — the accent is fixed when Live connects. */
  lang: Lang
  practice: PracticeStore
  callLog: CallLog
  apiKey: string
  voice: string
  gender: VoiceGender
  /** Hang up on the caller's side. */
  close: () => void
  /**
   * Where the call gets written down, when there is somewhere to write it.
   *
   * A call taken from the console by a signed-in owner is one of their
   * practice's calls and belongs in their dashboard — without this the console
   * was a demo that left no trace, and the dashboard showed nothing until a
   * phone number was wired up. Absent for an anonymous visitor, who has no
   * practice to file anything against.
   */
  record?: CallRecorder
}

export interface CallRecorder {
  /** Called once the line opens. Returns the id the call is filed under. */
  begin(): Promise<string | null>
  /** Called when it ends, with everything worth keeping. */
  end(input: {
    transcript: { speaker: 'caller' | 'priya'; text: string; at: number }[]
    outcome: string
    language: Lang
    durationSec: number
    triageBand?: string
    toolsUsed: string[]
    /** How long the caller waited for the first reply, and on average. */
    firstResponseMs?: number
    avgResponseMs?: number
    /** How often they cut in. A high count means it is talking too long. */
    bargeInCount: number
  }): Promise<void>
}

export async function runVoiceSession(opts: VoiceSessionOptions): Promise<void> {
  const { sessionId, transport, practice, callLog, apiKey, voice, gender } = opts

  let lang: Lang = opts.lang
  let patientId: string | null = null
  const convo = newConversation(lang)

  let finished = false
  const startedAt = Date.now()
  const toolsUsed: string[] = []
  const transcript: { speaker: 'caller' | 'priya'; text: string; at: number }[] = []
  let triage: { band: string; reason: string } | undefined
  /**
   * What the dashboard's quality tiles are made of.
   *
   * Gathered here because the session is the only place that sees them: the
   * timings arrive as `metrics.turn` and the interruptions as `tts.cancel`, and
   * without collecting them a console call showed a median first reply of zero,
   * which reads as broken rather than as unmeasured.
   */
  const replyMs: number[] = []
  let bargeIns = 0

  if (!apiKey) {
    transport.send({
      type: 'error',
      code: 'no_key',
      message: 'GEMINI_API_KEY is not set. Gemini Live is the engine — nothing works without it.',
      recoverable: false,
    })
    opts.close()
    return
  }

  /**
   * Everything the agent says passes the clinical guard and the narration
   * filter before it reaches the console. Live is fluent, not grounded: it will
   * happily invent a doctor, so this layer matters more now, not less.
   */
  const send = (event: ServerEvent): void => {
    if (event.type === 'tts.begin') {
      const spoken = speakable(event.text)
      if (!spoken) return
      event = { ...event, text: spoken }
    }
    record(event)
    transport.send(event)
  }

  const record = (event: ServerEvent): void => {
    if (event.type === 'stt.final') {
      convo.turn += 1
      observeLanguage(convo, event.lang, 0.9)
      lang = convo.language
      session?.setLang(lang)

      const found = extractFacts(event.text)
      if (found.name) learn(convo, 'name', found.name)
      if (found.phone) learn(convo, 'phone', found.phone)
      if (found.preferredTime) learn(convo, 'preferredTime', found.preferredTime)
    }
    if (event.type === 'tts.begin') {
      // Live re-sends a growing transcript for one reply; keep the latest.
      const last = transcript.at(-1)
      if (last?.speaker === 'priya' && event.text.startsWith(last.text.slice(0, 12))) {
        last.text = event.text
      } else {
        transcript.push({ speaker: 'priya', text: event.text, at: Date.now() })
      }
      const t = event.text.toLowerCase()
      if (/\bname\b/.test(t) && t.includes('?')) noteAsked(convo, 'name')
      if (/(mobile|number|phone)/.test(t) && t.includes('?')) noteAsked(convo, 'mobile number')
    }
    if (event.type === 'stt.final' && event.text.trim()) {
      transcript.push({ speaker: 'caller', text: event.text.trim(), at: Date.now() })
    }
    if (event.type === 'tool.call') toolsUsed.push(event.name)
    if (event.type === 'metrics.turn' && event.e2eMs > 0) replyMs.push(event.e2eMs)
    if (event.type === 'tts.cancel') bargeIns += 1
    if (event.type === 'ui.event') {
      const p = event.payload as Record<string, string>
      if (event.event === 'triage.escalated') triage = { band: p.band!, reason: p.reason! }
      if (event.event === 'patient.identified') {
        convo.caller.isReturning = true
        if (p.name) learn(convo, 'name', p.name, 'lookup')
        if (p.phone) learn(convo, 'phone', p.phone, 'lookup')
      }
      if (event.event === 'appointment.booked' && p.id) convo.bookedAppointments.push(p.id)
    }
  }

  const tools = new DentalTools({
    practice,
    lang: () => lang,
    emit: send,
    patientId: () => patientId,
    setPatient: (id) => {
      patientId = id
    },
  })

  const session = new LiveSession({
    sessionId,
    apiKey,
    systemInstruction: systemPrompt({ practice, lang, gender, known: describeConversation(convo) }),
    buildInstructions: (current) =>
      systemPrompt({ practice, lang: current, gender, known: describeConversation(convo) }),
    lang,
    voice,
    gender,
    tools,
    practiceName: practice.name,
    agentName: 'the front desk',
    send,
    sendAudio: (pcm) => transport.sendAudio(pcm),
    onClose: () => opts.close(),
    // Live heard a different language. Record it and steer the session, so the
    // switch survives past a single turn.
    onLanguageHeard: (heard) => {
      observeLanguage(convo, heard, 0.95)
      if (convo.language !== lang) {
        lang = convo.language
        session.setLang(lang)
        send({ type: 'lang.detected', lang, confidence: 0.95, codeSwitched: false })
      }
    },
  })

  transport.onAudioFrame((pcm) => session.pushAudio(pcm))
  transport.onEvent((e) => {
    /**
     * A language the caller *chose*, which is not the same as one we detected.
     *
     * It sets the conversation's language outright rather than going through
     * `observeLanguage`, whose two-turns-in-a-row debounce exists to resist
     * noisy detection — there is nothing to resist here. Updating the session's
     * accent alone was not enough: the prompt is built from the conversation
     * state, so leaving that at the default had the agent being told to speak
     * English in a Tamil accent, and the prompt won.
     */
    const chooseLang = (next: Lang): void => {
      lang = next
      convo.language = next
      convo.languageHistory = [next]
      session.setLang(next)
    }

    // A fallback for clients that do not put the language in the URL; the
    // console does, so by here the session is usually already in it.
    if (e.type === 'session.start' && e.lang) chooseLang(e.lang)
    if (e.type === 'control.set_lang') chooseLang(e.lang)
    if (e.type === 'session.end') {
      finishCall()
      void session.close()
    }
  })

  const finishCall = (): void => {
    if (finished) return
    finished = true
    void writeDown()
    const rec = buildCallRecord({
      sessionId,
      startedAt,
      state: convo,
      practice,
      bookedIds: convo.bookedAppointments,
      toolsUsed,
      triage,
      transcript,
    })
    callLog.add(rec)
    console.log(
      `[${sessionId}] ${rec.outcome} · ${rec.turns} caller turns · ` +
        `${rec.durationSec}s · ${rec.followUps.length} follow-up(s)`,
    )
  }

  /**
   * Filing the call, after it is over.
   *
   * Deliberately not awaited by anything the caller is waiting on: a slow or
   * broken database must never hold a line open or delay a hang-up, and a call
   * that happened is more important than the record of it.
   */
  const writeDown = async (): Promise<void> => {
    if (!opts.record || !callId) return
    try {
      await opts.record.end({
        transcript,
        outcome: convo.bookedAppointments.length ? 'booked' : triage ? 'escalated' : 'answered',
        language: lang,
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        triageBand: triage?.band,
        toolsUsed,
        firstResponseMs: replyMs[0],
        avgResponseMs: replyMs.length
          ? Math.round(replyMs.reduce((a, b) => a + b, 0) / replyMs.length)
          : undefined,
        bargeInCount: bargeIns,
      })
    } catch (err) {
      console.error(`[${sessionId}] could not file the call:`, err)
    }
  }

  transport.onClose(() => {
    finishCall()
    void session.close()
  })

  let callId: string | null = null
  if (opts.record) {
    try {
      callId = await opts.record.begin()
    } catch (err) {
      // A call that cannot be filed is still a call worth taking.
      console.error(`[${sessionId}] could not open a call record:`, err)
    }
  }

  console.log(`[${sessionId}] connected — gemini-live, voice ${voice}`)
  try {
    await session.start()
  } catch (err) {
    console.error(`[${sessionId}] live connect failed:`, err)
    transport.send({
      type: 'error',
      code: 'live_connect_failed',
      message: err instanceof Error ? err.message : String(err),
      recoverable: false,
    })
  }
}

export { handleVoice, handleStatus, handleTransferResult, loadStreamContext, transferTwiml } from './twilio-webhooks'
export type { TelephonyDeps } from './twilio-webhooks'
export { handleTwilioStream } from './twilio-stream'
export { startOutboundWorker, outboundPass, twilioPlaceCall } from './outbound'
export { runNodeWebhook } from './node-webhook'
export { streamUrl, streamUrlFromEnv } from './stream-url'
export { recorderForToken, readCookie, SESSION_COOKIE } from './recorder'
export { WsUpgradeTransport } from './ws-upgrade-transport'
export type { UpgradedSocket } from './ws-upgrade-transport'
