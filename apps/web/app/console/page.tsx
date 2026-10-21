'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentState, Lang, ServerEvent, TurnMetrics, WordMark } from '@vaani/shared'
import { BUDGETS } from '@vaani/shared'
import { VoiceClient } from '@/lib/voice-client'
import { Transcript, type InlineCard, type Turn, type Utterance } from '@/components/Transcript'
import {
  PracticePanel,
  type BookedAppointment,
  type PatientCard,
  type ToolActivity,
} from '@/components/PracticePanel'
import { CallSummaryView, type CallSummary } from '@/components/CallSummary'
import { AppBar } from '../app-bar'
import { Stage, clock } from './stage'
import '../dashboard/careflow.css'
import './console.css'

/**
 * Where a call is hosted.
 *
 * Empty means this deployment: the call runs in a route beside the console, so
 * there is no second box to wake. That is the whole point — a free host that
 * sleeps made the first visitor of the day wait the better part of a minute
 * before hearing anything, which is a bad way to meet a demo.
 *
 * An explicit URL points at the standalone server instead. `./scripts/dev.sh`
 * sets it, because `next dev` cannot serve a WebSocket route.
 */
const SERVER_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL ?? ''

function sessionUrl(): string {
  if (SERVER_URL) return `${SERVER_URL}/session`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/session`
}

/**
 * Why the line is dead, in the words that apply where you are standing.
 *
 * Calls need a long-lived WebSocket holding a Gemini Live session, which is a
 * stateful server, not a serverless function — so a static deployment of this
 * console has no voice server behind it. Telling someone on a deployed page to
 * "start it locally" is wrong advice and makes a working build look broken.
 */
/**
 * Poll /health until the instance answers, or give up.
 *
 * Returns false only when the server is genuinely unreachable, so a real
 * misconfiguration still surfaces as an error rather than an endless wait.
 */
async function wakeServer(onSlow: () => void): Promise<boolean> {
  // Only a separate box can be asleep; a same-origin route is already awake.
  if (!SERVER_URL) return true
  const http = SERVER_URL.replace(/^ws/, 'http')
  const deadline = Date.now() + 90_000
  let announced = false
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${http}/health`, { signal: AbortSignal.timeout(10_000) })
      if (res.ok) return true
    } catch {
      /* asleep, starting, or absent — the retry decides which */
    }
    if (!announced) {
      announced = true
      onSlow()
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

function unreachableMessage(): string {
  if (!SERVER_URL) return 'Could not open the line. Check your connection and try again.'
  const remote = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  if (remote && SERVER_URL.includes('localhost')) {
    return 'This console is pointed at a voice server on localhost, which a deployed page cannot reach. Unset NEXT_PUBLIC_VOICE_SERVER_URL to use this deployment, or point it at a reachable server.'
  }
  return 'Voice server not reachable at ' + SERVER_URL + '. Start it with ./scripts/dev.sh'
}


export default function Console() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle')
  /** The server is asleep and being woken; the call has not failed. */
  const [waking, setWaking] = useState(false)
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [metrics, setMetrics] = useState<TurnMetrics[]>([])
  const [lang, setLang] = useState<Lang>('en-IN')
  const [levels, setLevels] = useState({ mic: 0, agent: 0 })
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const [patient, setPatient] = useState<PatientCard | null>(null)
  const [bookings, setBookings] = useState<BookedAppointment[]>([])
  /**
   * Bookings that were tried and did not go into the diary, with why.
   *
   * Without these, a call where the desk tried to book and failed ended on
   * "No appointment booked" with nothing to say a booking had ever been
   * attempted — which read as the console losing a booking, not as a booking
   * that needs a person to finish it.
   */
  const [missed, setMissed] = useState<string[]>([])
  const [tools, setTools] = useState<ToolActivity[]>([])
  const [cards, setCards] = useState<InlineCard[]>([])
  const [triage, setTriage] = useState<{ band: string; reason: string } | null>(null)
  const [tier, setTier] = useState<{ stt: string; llm: string; tts: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const client = useRef<VoiceClient | null>(null)
  /** A call is being opened; a second click must not open another. */
  const starting = useRef(false)
  /** utteranceId → the turn it belongs to, so clauses group into one bubble. */
  const utteranceTurn = useRef<Map<string, string>>(new Map())
  /** The desk turn being spoken, and whether she was speaking a moment ago. */
  const deskTurn = useRef<string | null>(null)
  const wasSpeaking = useRef(false)

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'session.ready':
        setTier(event.tier)
        break
      case 'agent.state': {
        setAgentState(event.state)
        // She has stopped generating. What the caller hears runs on until the
        // queued audio does, so that — not this event — is where her lane ends.
        // A reply that was cut off already ended where it was cut.
        const id = deskTurn.current
        if (wasSpeaking.current && event.state !== 'speaking' && id) {
          const endAt = client.current?.playbackEndsAt() ?? Date.now()
          setTurns((prev) =>
            prev.map((t) => (t.id === id && !t.cut ? { ...t, endAt: Math.max(t.endAt ?? 0, endAt) } : t)),
          )
        }
        wasSpeaking.current = event.state === 'speaking'
        break
      }
      case 'lang.detected':
        setLang(event.lang)
        break

      case 'stt.partial':
        if (!event.text.trim()) break
        setTurns((prev) => {
          /**
           * Matched by id, not by position.
           *
           * Matching "the last bubble, if it is an unsettled caller one" merged
           * everything the caller said before the agent got a word in into a
           * single run-on bubble. Each utterance carries the id it will settle
           * under, so a new one starts a new bubble.
           */
          const at = prev.findIndex((t) => t.id === event.turnId)
          // Each partial is the caller still talking, so the last one is
          // when they stopped.
          if (at >= 0) {
            const next = [...prev]
            next[at] = { ...prev[at]!, text: event.text, lang: event.lang, endAt: Date.now() }
            return next
          }
          return [
            ...prev,
            {
              id: event.turnId,
              speaker: 'caller',
              text: event.text,
              lang: event.lang,
              at: Date.now(),
              endAt: Date.now(),
              interim: true,
            },
          ]
        })
        break

      case 'stt.final':
        setTurns((prev) => {
          // The same id the partials carried, so it settles the bubble the
          // caller has been watching fill in rather than any other.
          const at = prev.findIndex((t) => t.id === event.turnId)
          if (!event.text.trim()) return at >= 0 ? prev.filter((_, i) => i !== at) : prev

          // `stt.final` lands after the reply, so its arrival says nothing
          // about when the caller stopped; the last partial already did.
          const settled: Turn = {
            id: event.turnId,
            speaker: 'caller',
            text: event.text,
            lang: event.lang,
            at: at >= 0 ? (prev[at]?.at ?? Date.now()) : Date.now(),
            endAt: at >= 0 ? prev[at]?.endAt : undefined,
          }

          // Replace the interim bubble WHERE IT SITS. `stt.final` only arrives
          // once the agent's whole reply is done, so removing the interim turn
          // and appending the settled one pushed the caller's words below a
          // reply that answered them — the transcript read back to front.
          if (at >= 0) {
            const next = [...prev]
            next[at] = settled
            return next
          }
          return [...prev, settled]
        })
        break

      case 'tts.begin': {
        // Clauses of one reply belong in one bubble — the caller hears a single
        // answer, not four.
        const turnId = `agent-${event.turnId}`
        utteranceTurn.current.set(event.utteranceId, turnId)
        deskTurn.current = turnId
        const utterance: Utterance = {
          id: event.utteranceId,
          text: event.text,
          marks: event.marks as WordMark[],
          playedMs: 0,
        }
        setTurns((prev) => {
          const existing = prev.findIndex((t) => t.id === turnId)
          if (existing >= 0) {
            const t = prev[existing]!
            const next = [...prev]
            const utterances = t.utterances ?? []
            // Live streams a reply's transcript in fragments, re-sending the
            // same utterance id as the text grows. Appending each fragment
            // produced duplicate React keys and a stuttering transcript; the
            // right move is to replace the utterance in place.
            const at = utterances.findIndex((u) => u.id === utterance.id)
            next[existing] = {
              ...t,
              utterances:
                at >= 0
                  ? utterances.map((u, i) => (i === at ? { ...u, ...utterance } : u))
                  : [...utterances, utterance],
            }
            return next
          }
          return [
            ...prev,
            {
              id: turnId,
              speaker: 'priya',
              lang: event.lang,
              at: Date.now(),
              utterances: [utterance],
            },
          ]
        })
        break
      }

      case 'tts.cancel': {
        const turnId = utteranceTurn.current.get(event.utteranceId)
        if (!turnId) break
        const spoken = event.spokenPrefix.replace(/—$/, '').trim()
        setTurns((prev) =>
          prev.map((t) =>
            t.id !== turnId
              ? t
              : {
                  ...t,
                  // Talked over: her lane stops here, under the caller's.
                  cut: true,
                  endAt: Date.now(),
                  utterances: (t.utterances ?? []).map((u) =>
                    u.id !== event.utteranceId
                      ? u
                      : {
                          ...u,
                          unspoken: spoken ? u.text.slice(spoken.length).trim() : u.text,
                          text: spoken,
                          marks: u.marks.filter((m) => m.endMs <= event.truncateAtMs),
                          playedMs: Number.POSITIVE_INFINITY,
                        },
                  ),
                },
          ),
        )
        break
      }

      case 'tool.call':
        setTools((prev) => [...prev, { id: event.id, name: event.name, args: event.args }])
        setCards((prev) => [
          ...prev,
          { kind: 'tool', id: event.id, at: Date.now(), name: event.name, args: event.args },
        ])
        break
      case 'tool.result': {
        setTools((prev) =>
          prev.map((t) => (t.id === event.id ? { ...t, ms: event.ms, ok: event.ok } : t)),
        )
        /**
         * The tool's own answer is the record of whether it booked.
         *
         * The UI event usually arrives first and has already added the
         * booking; this adds it only if it has not, so a booking the diary
         * took can never be missing from the summary. A refusal is kept too.
         */
        if (event.name === 'book_appointment' || event.name === 'reschedule_appointment') {
          const r = (event.result ?? {}) as {
            booked?: boolean
            appointmentId?: string
            when?: string
            conflict?: boolean
            error?: string
            say?: string
            confirmed?: { patient?: string; treatment?: string; doctor?: string; when?: string }
          }
          if (event.ok && r.appointmentId) {
            const id = String(r.appointmentId)
            setBookings((prev) =>
              prev.some((b) => b.id === id)
                ? prev
                : [
                    ...prev,
                    {
                      id,
                      patientName: r.confirmed?.patient,
                      serviceName: r.confirmed?.treatment,
                      providerName: r.confirmed?.doctor,
                      when: r.confirmed?.when ?? r.when,
                      moved: event.name === 'reschedule_appointment',
                    },
                  ],
            )
          } else if (!event.ok) {
            setMissed((prev) => [...prev, missReason(event.name, r)])
          }
        }
        setCards((prev) =>
          prev.map((c) =>
            c.kind === 'tool' && c.id === event.id
              ? { ...c, ms: event.ms, ok: event.ok, result: event.result }
              : c,
          ),
        )
        break
      }
      case 'metrics.turn':
        setMetrics((prev) => [...prev, event])
        break

      case 'ui.event': {
        const p = event.payload as Record<string, string & number>
        const at = Date.now()
        if (event.event === 'patient.identified') {
          setPatient({
            name: p.name,
            phone: p.phone,
            preferredLanguage: p.preferredLanguage,
            upcoming: Number(p.upcoming ?? 0),
          })
          setCards((prev) => [
            ...prev,
            { kind: 'patient', id: `p${at}`, at, name: p.name, phone: p.phone, upcoming: Number(p.upcoming ?? 0) },
          ])
        } else if (event.event === 'patient.updated') {
          setPatient({ name: p.name, phone: p.phone, isNew: true, upcoming: 0 })
          setCards((prev) => [
            ...prev,
            { kind: 'patient', id: `p${at}`, at, name: p.name, phone: p.phone, isNew: true },
          ])
        } else if (event.event === 'appointment.booked' || event.event === 'appointment.rescheduled') {
          const booking: BookedAppointment = {
            id: String(p.id),
            patientName: p.patientName,
            serviceName: p.serviceName,
            providerName: p.providerName,
            when: p.when,
            moved: event.event === 'appointment.rescheduled',
          }
          // A move keeps its id, so it replaces the booking it moved.
          setBookings((prev) => [...prev.filter((b) => b.id !== booking.id), booking])
          setCards((prev) => [
            ...prev,
            {
              kind: 'booked',
              id: String(p.id),
              at,
              patient: p.patientName,
              service: p.serviceName,
              doctor: p.providerName,
              start: p.start,
              when: p.when,
            },
          ])
        } else if (event.event === 'triage.escalated') {
          setTriage({ band: String(p.band), reason: String(p.reason) })
          setCards((prev) => [
            ...prev,
            { kind: 'triage', id: `t${at}`, at, band: String(p.band), reason: String(p.reason) },
          ])
        }
        break
      }

      case 'error':
        setError(event.message)
        break
      default:
        break
    }
  }, [])

  /** Reveal words against what has actually been heard. */
  const handlePlayback = useCallback((utteranceId: string, playedMs: number) => {
    const turnId = utteranceTurn.current.get(utteranceId)
    if (!turnId) return
    setTurns((prev) =>
      prev.map((t) =>
        t.id !== turnId
          ? t
          : {
              ...t,
              utterances: (t.utterances ?? []).map((u) =>
                u.id === utteranceId && u.playedMs !== Number.POSITIVE_INFINITY
                  ? { ...u, playedMs }
                  : u,
              ),
            },
      ),
    )
  }, [])

  const start = useCallback(async () => {
    /**
     * One call at a time, enforced here rather than only on the button.
     *
     * Waking a sleeping host takes the better part of a minute, and for all of
     * it the page looks idle — so clicking again is a reasonable thing to do.
     * Each click used to open its own session, and the one left behind kept its
     * socket and its audio context: two greetings playing over each other,
     * which is heard as the agent echoing herself.
     */
    if (starting.current) return
    starting.current = true

    // Whatever came before is over. Tearing it down releases its microphone and
    // its audio contexts, which the browser caps.
    await client.current?.disconnect().catch(() => {})
    client.current = null

    setError(null)
    setWaking(false)
    setLastCall(null)
    utteranceTurn.current.clear()
    deskTurn.current = null
    wasSpeaking.current = false
    setTurns([])
    setMetrics([])
    setPatient(null)
    setBookings([])
    setMissed([])
    setTools([])
    setCards([])
    setTriage(null)
    setAgentState('idle')
    /**
     * Wake the server before opening the socket.
     *
     * The voice server sleeps when idle on a free host, and a cold start takes
     * the better part of a minute. A WebSocket handshake will not wait that
     * long — it just fails — so the first call after a quiet spell died on the
     * doorstep. An HTTP request wakes the instance and *will* wait, so one goes
     * first and the caller is told what is happening.
     */
    if (!(await wakeServer(() => setWaking(true)))) {
      setError(unreachableMessage())
      setStatus('error')
      setWaking(false)
      starting.current = false
      return
    }
    setWaking(false)

    const vc = new VoiceClient(sessionUrl(), {
      onEvent: handleEvent,
      onLevel: (mic, agent) => setLevels({ mic, agent }),
      onStatus: setStatus,
    })
    client.current = vc
    // Whatever is selected in the header opens the session, so the greeting is
    // already in that language. `lang` is a dependency for exactly this reason:
    // without it the callback closes over the language the page loaded with, and
    // picking Tamil still opened the call in English.
    vc.useLang(lang)
    try {
      await vc.connect()
      setStartedAt(Date.now())
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('unreachable')
          ? unreachableMessage()
          : 'Microphone access is needed to take a call.',
      )
      setStatus('error')
    } finally {
      starting.current = false
    }
  }, [handleEvent, handlePlayback, lang])

  const [lastCall, setLastCall] = useState<CallSummary | null>(null)

  const end = useCallback(async () => {
    await client.current?.disconnect()
    client.current = null

    // Keep the record, clear the console. Everything below is per-call state;
    // carrying any of it into the next call is what made the agent appear to
    // remember a conversation that had already ended.
    setLastCall({
      endedAt: Date.now(),
      durationSec: startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
      turns,
      patient,
      bookings,
      missed,
      tools,
      triage,
      metrics,
      lang,
    })

    utteranceTurn.current.clear()
    deskTurn.current = null
    wasSpeaking.current = false
    setTurns([])
    setMetrics([])
    setPatient(null)
    setBookings([])
    setMissed([])
    setTools([])
    setCards([])
    setTriage(null)
    setAgentState('idle')
    setLevels({ mic: 0, agent: 0 })
    setStartedAt(null)
    setElapsed(0)
    setError(null)
    setStatus('idle')
  }, [startedAt, turns, patient, bookings, missed, tools, triage, metrics, lang])

  useEffect(() => {
    if (status !== 'live' || !startedAt) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    return () => clearInterval(id)
  }, [status, startedAt])

  const spectrum = useCallback(
    (t: 'mic' | 'agent') => client.current?.spectrum(t) ?? new Uint8Array(0),
    [],
  )

  const live = status === 'live'
  const latest = metrics.at(-1)
  const busy = waking ? 'waking' : status === 'connecting' ? 'connecting' : null
  const inCall = turns.length > 0 && !lastCall

  return (
    <main data-shell="console" className="cc" data-phase={inCall ? 'call' : 'idle'}>
      <AppBar guest />

      <div className="cc-grid">
        <div className="cc-main">
          <Stage
            agentState={agentState}
            live={live}
            busy={busy}
            levels={levels}
            spectrum={spectrum}
            elapsed={elapsed}
            lang={lang}
            onLang={(next) => {
              setLang(next)
              client.current?.setLang(next)
            }}
            onStart={start}
            onEnd={end}
            e2e={latest ? { ms: latest.e2eMs, good: latest.e2eMs <= BUDGETS[latest.tier].e2eP50Ms } : null}
            turns={metrics.length}
            model={tier?.llm}
            compact={inCall || Boolean(lastCall)}
          />

          {/* Where CareFlow lists appointments: what is being said. The pitch
              before a call, the conversation during one, the record after. */}
          <section className="cc-convo" aria-label="Conversation">
            {error && (
              <p className="cc-error" role="alert">
                {error}
              </p>
            )}
            {lastCall ? (
              <div className="cc-convo-body">
                <CallSummaryView summary={lastCall} onNew={start} />
              </div>
            ) : turns.length > 0 ? (
              <>
                <header className="cc-convo-head">
                  <h2>Conversation</h2>
                  <span className="cc-convo-meta mono">
                    {metrics.length} {metrics.length === 1 ? 'turn' : 'turns'} · {clock(elapsed)}
                  </span>
                </header>
                <div className="cc-convo-body is-thread">
                  <Transcript
                    turns={turns}
                    cards={cards}
                    startedAt={startedAt}
                    thinking={agentState === 'thinking'}
                  />
                </div>
              </>
            ) : (
              <div className="cc-convo-body cc-idle">
                <h2>
                  Answers in eleven Indian languages,
                  <br />
                  or two in one sentence.
                </h2>
                <p>
                  Interrupt mid-sentence and the reply stops where you cut in — nothing is
                  remembered that you never heard.
                </p>
                {/* Things worth trying, so a first call has somewhere to start. */}
                <ul className="cc-tries" aria-label="Things to try">
                  <li>Switch to Hindi halfway through a sentence</li>
                  <li>Talk over her while she is answering</li>
                  <li>Book a cleaning at Bandra for tomorrow evening</li>
                  <li>Ask what to take for the pain</li>
                </ul>
              </div>
            )}
          </section>
        </div>

        <PracticePanel patient={patient} bookings={bookings} tools={tools} triage={triage} />
      </div>
    </main>
  )
}

/** Why a booking did not go in, in a few words a receptionist can act on. */
function missReason(tool: string, r: { conflict?: boolean; error?: string; say?: string }): string {
  if (tool === 'reschedule_appointment') return 'A move was tried but the appointment stayed where it was'
  if (r.conflict) return 'The time was taken while they decided'
  if (r.error) return 'The diary did not take it'
  if (r.say && /mobile number|name/.test(r.say)) return 'There was no name and number to book under'
  if (r.say && /treatment/.test(r.say)) return 'The treatment was not one the practice offers'
  return 'The diary did not take it'
}
