import type { WebSocket } from 'ws'
import { LiveSession } from '@vaani/live'
import { DentalTools, newConversation, speakable, systemPrompt } from '@vaani/agent'
import { decideRouting, TwilioTransport } from '@vaani/telephony'
import type { Lang, ServerEvent } from '@vaani/shared'
import type { CallTurn } from '@vaani/db'
import { loadStreamContext } from './telephony'

/**
 * One phone call, from the media socket to the model and back.
 *
 * Structurally the same as the browser path — the transport differs, and
 * nothing else does. What is genuinely phone-specific lives here:
 *
 *   **The tenant is established before a single frame is processed.** Twilio
 *   echoes the parameters the (signature-verified) voice webhook set, and the
 *   call row is re-read under that org to confirm we issued them. Audio is
 *   ignored until that resolves, because a stream we cannot attribute is a
 *   stream that must not reach anyone's data.
 *
 *   **The clock the practice keeps decides what may be offered.** After hours
 *   the agent still answers — most calls are ordinary questions — but it cannot
 *   promise a slot today, and that constraint is written into the prompt rather
 *   than left to the model's judgement.
 *
 *   **Everything is written down as it happens.** A phone call has no console
 *   watching it, so the trace and transcript are the only record that exists.
 */

export async function handleTwilioStream(socket: WebSocket): Promise<void> {
  const startedAt = Date.now()
  const transcript: CallTurn[] = []
  let session: LiveSession | null = null
  let ready = false
  const pending: Int16Array[] = []

  let lang: Lang = 'en-IN'
  let firstResponseMs: number | null = null
  const responseTimes: number[] = []
  let lastCallerTurnAt = 0
  let bargeIns = 0
  let outcome: 'booked' | 'escalated' | 'answered' | 'no_speech' = 'no_speech'
  let triageBand: string | undefined

  const transport = new TwilioTransport({
    socket: socket as never,
    onStart: (info) => {
      void begin(info.custom)
    },
  })

  // Audio arriving before the tenant resolves is held, not dropped: Twilio
  // starts streaming immediately and the first syllable is often the caller
  // already talking. Bounded, so a stream that never resolves cannot grow
  // without limit.
  transport.onAudioFrame((pcm) => {
    if (ready && session) session.pushAudio(pcm)
    else if (pending.length < 250) pending.push(pcm)
  })

  async function begin(custom: Record<string, string>): Promise<void> {
    const ctx = await loadStreamContext(custom)
    if (!ctx) {
      console.warn('[twilio] stream could not be attributed to a call — dropping')
      transport.close()
      return
    }
    const { repo, adapter, callId } = ctx

    const org = await repo.org()
    const branches = await repo.branches()
    const branch = branches.find((b) => b.id === ctx.branchId) ?? branches[0]
    const routing = decideRouting({
      hours: branch?.hours ?? [],
      timezone: org?.timezone ?? 'Asia/Kolkata',
      emergencyPhone: branch?.emergencyPhone,
      receptionPhone: branch?.phone,
    })

    const call = await repo.call(callId)
    const convo = newConversation(lang)
    let patientId: string | null = call?.patientId ?? null

    const trace = (kind: string, detail?: Record<string, unknown>, extra?: { ok?: boolean; durationMs?: number }) =>
      void repo.trace(callId, kind, Date.now() - startedAt, detail, extra)

    /**
     * The clinical guard, on the only path that reaches a caller's ear.
     *
     * A phone call has no console to filter afterwards, so this is the last
     * point at which a diagnosis or a dosage can be stopped.
     */
    const send = (event: ServerEvent): void => {
      if (event.type === 'tts.begin') {
        const spoken = speakable(event.text)
        if (!spoken) return
        if (spoken !== event.text) trace('guard.redacted', { original: event.text })
        event = { ...event, text: spoken }

        if (firstResponseMs === null) firstResponseMs = Date.now() - startedAt
        if (lastCallerTurnAt) responseTimes.push(Date.now() - lastCallerTurnAt)
        upsertTurn('agent', spoken)
      }
      if (event.type === 'stt.final') {
        lastCallerTurnAt = Date.now()
        if (event.text.trim()) {
          transcript.push({ speaker: 'caller', text: event.text, lang: event.lang, atMs: Date.now() - startedAt })
          outcome = outcome === 'no_speech' ? 'answered' : outcome
        }
      }
      if (event.type === 'tts.cancel') bargeIns += 1
      if (event.type === 'tool.call') trace(`tool.${event.name}`, { args: event.args })
      if (event.type === 'tool.result') {
        trace(`tool.${event.name}.done`, { ok: event.ok }, { ok: event.ok, durationMs: event.ms })
        if (event.name === 'book_appointment' && event.ok) outcome = 'booked'
        if (event.name === 'triage_symptoms') {
          const band = (event.result as { band?: string } | null)?.band
          if (band) triageBand = band
          if (band === 'RED') outcome = 'escalated'
        }
        if (event.name === 'escalate_to_human') outcome = 'escalated'
      }
      transport.send(event)
    }

    /** Live re-sends a growing prefix; one turn is one row, not a dozen. */
    function upsertTurn(speaker: 'caller' | 'agent', text: string): void {
      const last = transcript[transcript.length - 1]
      if (last && last.speaker === speaker && text.startsWith(last.text)) last.text = text
      else transcript.push({ speaker, text, lang, atMs: Date.now() - startedAt })
    }

    const tools = new DentalTools({
      practice: adapter as never,
      lang: () => lang,
      emit: send,
      patientId: () => patientId,
      setPatient: (pid) => {
        patientId = pid
        void repo.finishCall(callId, { patientId: pid } as never)
      },
    })

    const instructions = (current: Lang): string =>
      [
        systemPrompt({ practice: adapter as never, lang: current }),
        '',
        '# Right now',
        routing.note,
        call?.fromNumber ? `The caller is ringing from ${call.fromNumber}.` : '',
        org?.agentPersona ?? '',
      ]
        .filter(Boolean)
        .join('\n')

    session = new LiveSession({
      sessionId: callId,
      apiKey: process.env.GEMINI_API_KEY ?? '',
      systemInstruction: instructions(lang),
      buildInstructions: instructions,
      lang,
      voice: org?.voice,
      tools,
      practiceName: adapter.name,
      agentName: 'the front desk',
      // A phone line is 8 kHz with codec gaps on top of human pauses, so
      // endpointing is given more room than a browser mic needs.
      channel: 'phone',
      send,
      sendAudio: (pcm) => transport.sendAudio(pcm),
      onClose: () => transport.close(),
      onLanguageHeard: (heard) => {
        if (heard === lang) return
        lang = heard
        session?.setLang(heard)
        trace('language.switch', { to: heard })
      },
    })

    transport.onClose(() => {
      void finish()
    })

    async function finish(): Promise<void> {
      if (!ready) return
      ready = false
      const durationSec = Math.round((Date.now() - startedAt) / 1000)
      await repo.finishCall(callId, {
        durationSec,
        language: lang,
        outcome,
        triageBand,
        transcript,
        bargeInCount: bargeIns,
        firstResponseMs: firstResponseMs ?? undefined,
        avgResponseMs: responseTimes.length
          ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
          : undefined,
      })
      trace('call.ended', { outcome, durationSec })
      void session?.close()
    }

    trace('stream.connected', { mode: routing.mode })
    await session.start()
    ready = true

    // Anything the caller said while we were resolving the tenant.
    for (const frame of pending.splice(0)) session.pushAudio(frame)
  }
}
