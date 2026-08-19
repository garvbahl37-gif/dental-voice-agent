'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentState, Lang, ServerEvent, TurnMetrics, WordMark } from '@vaani/shared'
import { BUDGETS } from '@vaani/shared'
import { VoiceClient } from '@/lib/voice-client'
import { VoiceBlob } from '@/components/VoiceBlob'
import { Transcript, type Turn, type Utterance } from '@/components/Transcript'
import {
  PracticePanel,
  type BookedAppointment,
  type PatientCard,
  type ToolActivity,
} from '@/components/PracticePanel'
import { CallSummaryView, type CallSummary } from '@/components/CallSummary'

const SERVER_URL = process.env.NEXT_PUBLIC_VOICE_SERVER_URL ?? 'ws://localhost:8787'

/**
 * Why the line is dead, in the words that apply where you are standing.
 *
 * Calls need a long-lived WebSocket holding a Gemini Live session, which is a
 * stateful server, not a serverless function — so a static deployment of this
 * console has no voice server behind it. Telling someone on a deployed page to
 * "start it locally" is wrong advice and makes a working build look broken.
 */
function unreachableMessage(): string {
  const remote = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  const localTarget = SERVER_URL.includes('localhost')
  if (remote && localTarget) {
    return 'This deployment is the console only — voice calls need the WebSocket server, which runs separately. Clone the repo and run ./scripts/dev.sh to take a call.'
  }
  return 'Voice server not reachable at ' + SERVER_URL + '. Start it with ./scripts/dev.sh'
}

const LANG_LABEL: Record<Lang, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
}

export default function Console() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended' | 'error'>('idle')
  const [agentState, setAgentState] = useState<AgentState>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [metrics, setMetrics] = useState<TurnMetrics[]>([])
  const [lang, setLang] = useState<Lang>('en-IN')
  const [levels, setLevels] = useState({ mic: 0, agent: 0 })
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const [patient, setPatient] = useState<PatientCard | null>(null)
  const [bookings, setBookings] = useState<BookedAppointment[]>([])
  const [tools, setTools] = useState<ToolActivity[]>([])
  const [triage, setTriage] = useState<{ band: string; reason: string } | null>(null)
  const [tier, setTier] = useState<{ stt: string; llm: string; tts: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const client = useRef<VoiceClient | null>(null)
  /** utteranceId → the turn it belongs to, so clauses group into one bubble. */
  const utteranceTurn = useRef<Map<string, string>>(new Map())

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'session.ready':
        setTier(event.tier)
        break
      case 'agent.state':
        setAgentState(event.state)
        break
      case 'lang.detected':
        setLang(event.lang)
        break

      case 'stt.partial':
        if (!event.text.trim()) break
        setTurns((prev) => {
          const last = prev.at(-1)
          if (last?.speaker === 'caller' && last.interim) {
            return [...prev.slice(0, -1), { ...last, text: event.text, lang: event.lang }]
          }
          return [
            ...prev,
            {
              id: `interim-${Date.now()}`,
              speaker: 'caller',
              text: event.text,
              lang: event.lang,
              at: Date.now(),
              interim: true,
            },
          ]
        })
        break

      case 'stt.final':
        setTurns((prev) => {
          const at = prev.findIndex((t) => t.interim)
          if (!event.text.trim()) return at >= 0 ? prev.filter((t) => !t.interim) : prev

          const settled: Turn = {
            id: event.turnId,
            speaker: 'caller',
            text: event.text,
            lang: event.lang,
            at: at >= 0 ? (prev[at]?.at ?? Date.now()) : Date.now(),
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
        break
      case 'tool.result':
        setTools((prev) =>
          prev.map((t) => (t.id === event.id ? { ...t, ms: event.ms, ok: event.ok } : t)),
        )
        break
      case 'metrics.turn':
        setMetrics((prev) => [...prev, event])
        break

      case 'ui.event': {
        const p = event.payload as Record<string, string & number>
        if (event.event === 'patient.identified') {
          setPatient({
            name: p.name,
            phone: p.phone,
            preferredLanguage: p.preferredLanguage,
            upcoming: Number(p.upcoming ?? 0),
          })
        } else if (event.event === 'patient.updated') {
          setPatient({ name: p.name, phone: p.phone, isNew: true, upcoming: 0 })
        } else if (event.event === 'appointment.booked') {
          setBookings((prev) => [
            ...prev,
            {
              id: String(p.id),
              patientName: p.patientName,
              serviceName: p.serviceName,
              providerName: p.providerName,
              when: p.when,
            },
          ])
        } else if (event.event === 'triage.escalated') {
          setTriage({ band: String(p.band), reason: String(p.reason) })
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
    setError(null)
    setLastCall(null)
    utteranceTurn.current.clear()
    setTurns([])
    setMetrics([])
    setPatient(null)
    setBookings([])
    setTools([])
    setTriage(null)
    setAgentState('idle')
    const vc = new VoiceClient(`${SERVER_URL}/session`, {
      onEvent: handleEvent,
      onLevel: (mic, agent) => setLevels({ mic, agent }),
      onStatus: setStatus,
    })
    client.current = vc
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
    }
  }, [handleEvent, handlePlayback])

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
      tools,
      triage,
      metrics,
      lang,
    })

    utteranceTurn.current.clear()
    setTurns([])
    setMetrics([])
    setPatient(null)
    setBookings([])
    setTools([])
    setTriage(null)
    setAgentState('idle')
    setLevels({ mic: 0, agent: 0 })
    setStartedAt(null)
    setElapsed(0)
    setLang('en-IN')
    setError(null)
    setStatus('idle')
  }, [startedAt, turns, patient, bookings, tools, triage, metrics, lang])

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

  return (
    <main data-shell="console" style={s.shell}>
      {/* ── Left: the call ───────────────────────────────────────────────── */}
      <section style={s.stage}>
        <header style={s.head}>
          <div>
            <div style={s.eyebrow}>
              <span style={{ ...s.dot, background: live ? 'var(--confirm)' : 'var(--ink-faint)' }} />
              {live ? 'Live · Voice' : 'Vaani · Voice'}
            </div>
            <h1 style={s.title}>Front desk</h1>
            <p style={s.sub}>Smile Dental Care · Bandra, Andheri, Powai</p>
          </div>

          <div style={s.pillRow}>
            <span style={s.pill}>{LANG_LABEL[lang]}</span>
            {tier && (
              <span className="mono" style={{ ...s.pill, fontSize: 10 }}>
                {tier.llm}
              </span>
            )}
          </div>
        </header>

        {/* Live telemetry — real measurements, not confidence theatre. */}
        <div style={s.strip}>
          <Stat label="State" value={stateLabel(agentState)} accent={accentFor(agentState)} />
          <Stat
            label="Mouth to ear"
            value={latest ? `${Math.round(latest.e2eMs)} ms` : '—'}
            accent={
              !latest
                ? 'var(--ink-faint)'
                : latest.e2eMs <= BUDGETS[latest.tier].e2eP50Ms
                  ? 'var(--confirm)'
                  : 'var(--agent)'
            }
          />
          <Stat label="Turns" value={String(metrics.length)} />
          <Stat label="Elapsed" value={live ? clock(elapsed) : '—'} />
        </div>

        {error && (
          <div role="alert" style={s.error}>
            {error}
          </div>
        )}

        {lastCall ? (
          <CallSummaryView summary={lastCall} onNew={start} />
        ) : (
        <>
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <div style={s.hero}>
          <div style={{ width: turns.length > 0 ? 190 : 300, transition: 'width 420ms ease' }}>
            <VoiceBlob
              state={agentState}
              micLevel={levels.mic}
              agentLevel={levels.agent}
              spectrum={spectrum}
              live={live}
            />
          </div>

          {turns.length === 0 && (
            <div style={s.pitch}>
              <h2 style={s.pitchLead}>
                Answers in English, Hindi,
                <br />
                or both in one sentence.
              </h2>
              <p style={s.pitchBody}>
                Interrupt mid-sentence and the reply stops where you cut in — nothing is
                remembered that you never heard.
              </p>
            </div>
          )}
        </div>

        {turns.length > 0 && (
          <div style={s.transcriptWrap}>
            <Transcript turns={turns} startedAt={startedAt} />
          </div>
        )}
        </>
        )}

        {/* ── Controls ───────────────────────────────────────────────────── */}
        {!lastCall && (
        <div style={s.controls}>
          {live ? (
            // No interrupt button. Interrupting is what talking over someone
            // *is* — the VAD hears you and she stops. A button would be an
            // admission that it does not work on its own.
            <button onClick={end} style={s.endBtn}>
              <span style={s.endGlyph}>■</span> End call
            </button>
          ) : (
            <button onClick={start} disabled={status === 'connecting'} style={s.startBtn}>
              {status === 'connecting' ? 'Connecting…' : 'Take a call'}
            </button>
          )}
        </div>
        )}
      </section>

      <PracticePanel patient={patient} bookings={bookings} tools={tools} triage={triage} />
    </main>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={s.stat}>
      <span className="label">{label}</span>
      <span style={{ ...s.statValue, color: accent ?? 'var(--ink)' }}>{value}</span>
    </div>
  )
}

function stateLabel(state: AgentState): string {
  return {
    idle: 'Ready',
    listening: 'Listening',
    thinking: 'Thinking',
    speaking: 'Speaking',
    tool_running: 'Checking diary',
  }[state]
}

function accentFor(state: AgentState): string {
  if (state === 'speaking') return 'var(--agent)'
  if (state === 'listening') return 'var(--caller)'
  return 'var(--ink)'
}

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100vh', background: 'var(--bg)' },
  stage: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '30px 40px 24px',
    minWidth: 0,
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 },
  eyebrow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'var(--agent)',
    marginBottom: 7,
  },
  dot: { width: 6, height: 6, borderRadius: 999, transition: 'background 300ms' },
  title: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 38,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    lineHeight: 1,
  },
  sub: { margin: '7px 0 0', fontSize: 13, color: 'var(--ink-muted)' },
  pillRow: { display: 'flex', gap: 8, flexShrink: 0 },
  pill: {
    fontSize: 12,
    fontWeight: 500,
    padding: '7px 15px',
    borderRadius: 'var(--r-pill)',
    background: 'var(--surface)',
    border: '1px solid var(--hairline)',
    boxShadow: 'var(--shadow-sm)',
    color: 'var(--ink-muted)',
    whiteSpace: 'nowrap',
  },
  strip: {
    display: 'flex',
    gap: 34,
    marginTop: 20,
    padding: '15px 22px',
    background: 'var(--surface)',
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--r-lg)',
    boxShadow: 'var(--shadow-sm)',
  },
  stat: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 92 },
  statValue: {
    fontSize: 16,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    transition: 'color 240ms',
  },
  error: {
    marginTop: 14,
    padding: '11px 16px',
    background: 'var(--alert-soft)',
    border: '1px solid var(--alert)',
    borderRadius: 'var(--r-md)',
    color: 'var(--alert)',
    fontSize: 13,
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flex: 1,
    minHeight: 0,
  },
  pitch: { textAlign: 'center', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 12 },
  pitchLead: {
    margin: 0,
    fontFamily: 'var(--font-display)',
    fontSize: 32,
    fontWeight: 500,
    lineHeight: 1.22,
    letterSpacing: '-0.015em',
  },
  pitchBody: {
    margin: 0,
    fontSize: 14,
    color: 'var(--ink-muted)',
    lineHeight: 1.65,
    maxWidth: 430,
    alignSelf: 'center',
  },
  transcriptWrap: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, marginTop: 6 },
  controls: {
    display: 'flex',
    gap: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 20,
  },
  startBtn: {
    fontSize: 14.5,
    fontWeight: 600,
    padding: '14px 34px',
    borderRadius: 'var(--r-pill)',
    background: 'var(--agent)',
    color: '#fff',
    boxShadow: '0 6px 18px rgba(184,115,10,0.28)',
    transition: 'transform 140ms, box-shadow 140ms',
  },
  ghostBtn: {
    fontSize: 13.5,
    fontWeight: 500,
    padding: '12px 22px',
    borderRadius: 'var(--r-pill)',
    background: 'var(--surface)',
    border: '1px solid var(--hairline-strong)',
    color: 'var(--ink-muted)',
    boxShadow: 'var(--shadow-sm)',
  },
  endBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13.5,
    fontWeight: 600,
    padding: '12px 26px',
    borderRadius: 'var(--r-pill)',
    background: 'var(--alert)',
    color: '#fff',
    boxShadow: '0 6px 16px rgba(179,53,42,0.24)',
  },
  endGlyph: { fontSize: 9 },
}
