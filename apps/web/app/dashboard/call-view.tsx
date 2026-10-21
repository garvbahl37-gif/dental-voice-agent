'use client'

import { useEffect, useState } from 'react'
import { CallLanes, spokenMs, type LaneTurn } from '@/components/CallLanes'
import { CallSkeleton } from './skeleton'

/**
 * One call, opened.
 *
 * Laid out after Plainthing's Meeto.ai meeting details: the record on the
 * left — what the call was, who was on it, a short reading of it, and what to
 * do next — and on the right the call itself, as the two speaker lanes over a
 * timestamped transcript. Their blue is turmeric.
 *
 * The dashboard could list calls and not show a single word of one, which made
 * every number on it unauditable. This is the checking: what was said, in the
 * language it was said in, and the trace underneath showing what the agent
 * actually did and how long each step took. Everything here is read from the
 * call's own row; where the call stored no summary, the overview says it is
 * assembled from the record rather than pretending to be one.
 *
 * Loaded when opened rather than with the list. A transcript is the largest
 * thing a call carries and nobody reads twenty-five of them.
 */

/**
 * A stored turn. Two writers have stored these over time: the phone path logs
 * an offset from the start of the call as `atMs` and calls the desk "agent";
 * the browser path logged a wall-clock `at` and called her "priya".
 */
interface Turn {
  speaker: 'caller' | 'priya' | 'agent'
  text: string
  lang?: string
  at?: number
  atMs?: number
}

interface TraceRow {
  id: string
  atMs: number
  kind: string
  detail: Record<string, unknown> | null
  durationMs: number | null
  ok: boolean | null
}

interface Detail {
  call: {
    id: string
    startedAt: string
    endedAt: string | null
    durationSec: number | null
    channel: string
    direction: string
    fromNumber: string | null
    toNumber?: string | null
    language: string | null
    outcome: string | null
    triageBand: string | null
    transferred?: boolean
    summary?: string | null
    firstResponseMs?: number | null
    avgResponseMs?: number | null
    bargeInCount?: number
    costPaise?: number | null
    transcript: Turn[]
  }
  trace: TraceRow[]
}

const LANG: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
  'mr-IN': 'मराठी',
  'gu-IN': 'ગુજરાતી',
  'bn-IN': 'বাংলা',
  'ta-IN': 'தமிழ்',
  'te-IN': 'తెలుగు',
  'kn-IN': 'ಕನ್ನಡ',
  'ml-IN': 'മലയാളം',
  'pa-IN': 'ਪੰਜਾਬੀ',
}

/** The call's headline: what happened, not who rang. */
const TITLE: Record<string, string> = {
  booked: 'Appointment booked',
  rescheduled: 'Appointment moved',
  cancelled: 'Appointment cancelled',
  answered: 'Question answered',
  escalated: 'Handed to a person',
  abandoned: 'Caller rang off',
  no_speech: 'Nobody spoke',
  failed: 'Call failed',
}

const ENDED: Record<string, string> = {
  booked: 'It ended with an appointment booked.',
  rescheduled: 'It ended with an appointment moved.',
  cancelled: 'It ended with an appointment cancelled.',
  answered: 'The caller’s question was answered.',
  escalated: 'It was handed to a person at the practice.',
  abandoned: 'The caller rang off before anything was settled.',
  no_speech: 'Nobody spoke on the line.',
  failed: 'The call failed.',
}

/** The trace, in the words a receptionist would use. */
const KIND: Record<string, string> = {
  inbound: 'The call came in',
  routing: 'Sent to the desk',
  'stream.connected': 'Line connected',
  'language.switch': 'Switched language',
  'knowledge.search': 'Checked what the practice says',
  'guard.redacted': 'The guard stopped a reply before it was spoken',
  'call.ended': 'Call ended',
  'tool.lookup_patient': 'Looked up the caller',
  'tool.create_patient': 'Created a patient record',
  'tool.list_services': 'Read the treatment list',
  'tool.check_availability': 'Checked the diary',
  'tool.book_appointment': 'Booked the appointment',
  'tool.list_my_appointments': 'Found their appointments',
  'tool.reschedule_appointment': 'Moved the appointment',
  'tool.cancel_appointment': 'Cancelled the appointment',
  'tool.join_waitlist': 'Added them to the waitlist',
  'tool.search_knowledge': 'Checked what the practice says',
  'tool.triage_symptoms': 'Triaged the symptoms',
  'tool.escalate_to_human': 'Flagged it for a person',
  'tool.record_note': 'Left a note',
}

export function CallView({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'summary' | 'trace' | 'numbers'>('summary')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    fetch(`/api/dashboard/call?id=${encodeURIComponent(id)}`)
      .then(async (r) => {
        const body = (await r.json()) as Detail & { error?: string }
        if (!live) return
        if (!r.ok) setError(body.error ?? 'Could not open that call.')
        else setData(body)
      })
      .catch(() => live && setError('Could not reach the server.'))
    return () => {
      live = false
    }
  }, [id])

  // Escape closes it, because a panel that traps you is worse than no panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const c = data?.call

  const copy = async () => {
    if (!c) return
    const text = c.transcript
      .map((t) => `${t.speaker === 'caller' ? 'Caller' : 'Front desk'}: ${t.text}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* the button simply does not confirm */
    }
  }

  return (
    <div className="cv-scrim" onClick={onClose} role="presentation">
      <section
        className="cd"
        role="dialog"
        aria-modal="true"
        aria-label="Call details"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cd-bar">
          <button className="cd-back" onClick={onClose} aria-label="Back to the dashboard">
            <Glyph name="back" />
          </button>
          <h2 className="cd-bar-title">Call details</h2>
          {c && (
            <button className="cd-bar-btn" onClick={() => void copy()}>
              <Glyph name="copy" />
              {copied ? 'Copied' : 'Copy transcript'}
            </button>
          )}
        </header>

        {error && (
          <p className="db-empty kb-bad cd-pad" role="alert">
            {error}
          </p>
        )}
        {!data && !error && (
          <div className="cd-pad">
            <CallSkeleton />
          </div>
        )}

        {c && data && (
          <div className="cd-grid">
            <article className="cd-main">
              <h3 className="cd-title">{TITLE[c.outcome ?? ''] ?? 'Call'}</h3>

              <p className="cd-meta">
                <span>
                  <Glyph name="phone" />
                  {c.fromNumber ?? 'From the console'}
                </span>
                <span>
                  <Glyph name="calendar" />
                  {new Date(c.startedAt).toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                  {' · '}
                  {span(c.startedAt, c.endedAt, c.durationSec)}
                </span>
              </p>

              <dl className="cd-rows">
                <div>
                  <dt>On the call</dt>
                  <dd>
                    <span className="cd-chip is-caller">
                      <i aria-hidden /> Caller
                    </span>
                    <span className="cd-chip is-desk">
                      <i aria-hidden /> Front desk
                    </span>
                    {c.language && <span className="cd-chip">{LANG[c.language] ?? c.language}</span>}
                  </dd>
                </div>
                <div>
                  <dt>Tags</dt>
                  <dd>
                    {c.outcome && (
                      <span className={`cd-chip is-${c.outcome === 'booked' ? 'good' : c.outcome === 'escalated' || c.outcome === 'failed' ? 'bad' : 'plain'}`}>
                        {c.outcome.replace('_', ' ')}
                      </span>
                    )}
                    <span className="cd-chip">{c.channel === 'twilio' ? 'phone' : c.channel}</span>
                    <span className="cd-chip">{c.direction}</span>
                    {c.triageBand && <span className="cd-chip is-bad">triage {c.triageBand.toLowerCase()}</span>}
                    {c.transferred && <span className="cd-chip">transferred</span>}
                    {(c.bargeInCount ?? 0) > 0 && (
                      <span className="cd-chip">
                        {c.bargeInCount} {c.bargeInCount === 1 ? 'interruption' : 'interruptions'}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="cd-tabs" role="tablist" aria-label="About this call">
                {(
                  [
                    ['summary', 'Summary'],
                    ['trace', `What it did${data.trace.length ? ` · ${data.trace.length}` : ''}`],
                    ['numbers', 'Numbers'],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={tab === k}
                    className={`cd-tab${tab === k ? ' is-on' : ''}`}
                    onClick={() => setTab(k)}
                  >
                    <Glyph name={k === 'summary' ? 'spark' : k === 'trace' ? 'list' : 'gauge'} />
                    {label}
                  </button>
                ))}
              </div>

              <div className="cd-panel" role="tabpanel">
                {tab === 'summary' && <Summary c={c} trace={data.trace} />}

                {tab === 'trace' &&
                  (data.trace.length === 0 ? (
                    <p className="db-empty">No trace recorded for this call.</p>
                  ) : (
                    <ol className="cd-trace">
                      {data.trace.map((e) => (
                        <li key={e.id} className={e.ok === false ? 'is-bad' : undefined}>
                          <span className="cd-trace-at mono">{(e.atMs / 1000).toFixed(1)}s</span>
                          <span className="cd-trace-what">
                            {KIND[e.kind] ?? KIND[e.kind.replace(/\.done$/, '')] ?? e.kind}
                            {e.kind.endsWith('.done') && ' — done'}
                            {e.durationMs != null && <em className="mono"> · {e.durationMs} ms</em>}
                            {e.detail && <small>{summarise(e.detail)}</small>}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ))}

                {tab === 'numbers' && (
                  <div className="cd-numbers">
                    <Fact k="Length" v={c.durationSec != null ? mmss(c.durationSec) : '—'} />
                    <Fact k="First reply" v={c.firstResponseMs != null ? `${c.firstResponseMs} ms` : '—'} />
                    <Fact k="Average reply" v={c.avgResponseMs != null ? `${c.avgResponseMs} ms` : '—'} />
                    <Fact k="Interruptions" v={String(c.bargeInCount ?? 0)} />
                    <Fact k="Turns" v={String(c.transcript.length)} />
                    <Fact k="Cost to run" v={c.costPaise != null ? `₹${(c.costPaise / 100).toFixed(2)}` : '—'} />
                  </div>
                )}
              </div>

              <footer className="cd-next">
                <p>What would you like to do next?</p>
                <div>
                  {c.fromNumber && (
                    <a className="cd-act is-main" href={`tel:${c.fromNumber}`}>
                      <Glyph name="phone" />
                      Call back
                    </a>
                  )}
                  <button className="cd-act" onClick={() => void copy()}>
                    <Glyph name="copy" />
                    {copied ? 'Copied' : 'Copy transcript'}
                  </button>
                  <button className="cd-act" onClick={onClose}>
                    <Glyph name="check" />
                    Done
                  </button>
                </div>
              </footer>
            </article>

            <aside className="cd-side" aria-label="What was said">
              {c.transcript.length === 0 ? (
                <p className="db-empty">
                  Nothing was transcribed — the caller rang off before speaking, or this call
                  predates transcript storage.
                </p>
              ) : (
                <CallLanes {...lanesOf(c)} estimated />
              )}
            </aside>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * The reading of the call.
 *
 * The stored summary when there is one. Otherwise the overview is assembled
 * from the row — length, channel, language, outcome, triage, interruptions —
 * and says so, because a paragraph that looks written but was not is the
 * kind of thing that stops a practice trusting the rest.
 */
function Summary({ c, trace }: { c: Detail['call']; trace: TraceRow[] }) {
  const lang = c.language ? (LANG[c.language] ?? c.language) : null
  const assembled = [
    `A ${c.durationSec != null ? mmss(c.durationSec) : ''} ${c.channel === 'twilio' ? 'phone' : c.channel} call, ${c.direction}${c.fromNumber ? ` from ${c.fromNumber}` : ''}${lang ? `, in ${lang}` : ''}.`,
    c.outcome ? ENDED[c.outcome] : null,
    c.triageBand ? `Triage put it in the ${c.triageBand.toLowerCase()} band.` : null,
    (c.bargeInCount ?? 0) > 0
      ? `The caller cut in ${c.bargeInCount} ${c.bargeInCount === 1 ? 'time' : 'times'}, and the desk stopped each time.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')

  // The things it did, once each, in order: the trace reduced to what a
  // receptionist would mention.
  const points = [
    ...new Set(
      trace
        .filter((e) => e.kind.startsWith('tool.') && !e.kind.endsWith('.done'))
        .map((e) => KIND[e.kind] ?? e.kind.replace('tool.', '').replace(/_/g, ' ')),
    ),
  ]
  if (trace.some((e) => e.kind === 'guard.redacted')) points.push('The guard stopped a reply before it was spoken')

  const needsHuman = c.outcome === 'escalated' || (c.triageBand && c.triageBand.toUpperCase() !== 'GREEN')

  return (
    <>
      <Block icon="doc" title="Overview">
        <p>{c.summary || assembled}</p>
        {!c.summary && <small className="cd-note">Assembled from the call record.</small>}
      </Block>
      <Block icon="check" title="What it did">
        {points.length === 0 ? (
          <p>No tools were used — the desk answered from what it already knew.</p>
        ) : (
          <ul className="cd-points">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </Block>
      {needsHuman && (
        <Block icon="flag" title="Needs a human" tone="alert">
          <p>
            {c.triageBand && c.triageBand.toUpperCase() === 'RED'
              ? 'An emergency: the clinic was alerted during the call. Check it is on the dashboard’s callback list.'
              : 'This call was handed over. Its brief is on the dashboard’s callback list until someone marks it handled.'}
          </p>
        </Block>
      )}
    </>
  )
}

function Block({
  icon,
  title,
  tone,
  children,
}: {
  icon: GlyphName
  title: string
  tone?: 'alert'
  children: React.ReactNode
}) {
  return (
    <section className={`cd-block${tone ? ` is-${tone}` : ''}`}>
      <h4>
        <Glyph name={icon} />
        {title}
      </h4>
      {children}
    </section>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="cd-fact">
      <span>{k}</span>
      <strong className="mono">{v}</strong>
    </div>
  )
}

/**
 * A stored transcript, placed on the call's clock.
 *
 * Only when each turn began was ever written down, so a turn runs for as long
 * as its words take to say and never past the next one — the lanes show who
 * spoke when, and claim no interruption the record cannot show.
 */
function lanesOf(c: Detail['call']): { turns: LaneTurn[]; duration: number } {
  const t0 = new Date(c.startedAt).getTime()
  const starts = c.transcript.map((t, i) =>
    t.atMs != null ? t.atMs : t.at != null ? Math.max(0, t.at - t0) : i * 4000,
  )
  const duration = Math.max(
    (c.durationSec ?? 0) * 1000,
    ...c.transcript.map((t, i) => starts[i]! + spokenMs(t.text)),
  )
  const lang = c.language ? c.language.split('-')[0] : undefined
  const turns = c.transcript.map((t, i): LaneTurn => {
    const start = starts[i]!
    const next = starts[i + 1] ?? duration
    return {
      id: String(i),
      who: t.speaker === 'caller' ? 'caller' : 'desk',
      start,
      end: Math.max(start + 400, Math.min(start + spokenMs(t.text), next - 150)),
      text: t.text,
      // Each turn set in its own script rather than a Latin stack guessing at it.
      lang: t.lang ? t.lang.split('-')[0] : lang,
    }
  })
  return { turns, duration }
}

/** One line, not a JSON dump — a trace nobody can read is not a trace. */
function summarise(d: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === '') continue
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v)
    parts.push(`${k} ${text.slice(0, 60)}`)
    if (parts.length === 3) break
  }
  return parts.join(' · ')
}

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "5:26 – 5:27 pm", or the start alone if the end was never written. */
function span(start: string, end: string | null, sec: number | null): string {
  const fmt = (d: Date) => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const a = new Date(start)
  const b = end ? new Date(end) : sec != null ? new Date(a.getTime() + sec * 1000) : null
  return b ? `${fmt(a)} – ${fmt(b)}` : fmt(a)
}

type GlyphName =
  | 'back'
  | 'copy'
  | 'phone'
  | 'calendar'
  | 'spark'
  | 'list'
  | 'gauge'
  | 'check'
  | 'doc'
  | 'flag'

function Glyph({ name }: { name: GlyphName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const d: Record<GlyphName, React.ReactNode> = {
    back: <path d="M15 5l-7 7 7 7" {...p} />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2.5" {...p} />
        <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" {...p} />
      </>
    ),
    phone: (
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        {...p}
      />
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="3" {...p} />
        <path d="M3.5 10h17M8 3v4M16 3v4" {...p} />
      </>
    ),
    spark: <path d="M12 3c.6 4.8 2.6 7.4 8 9-5.4 1.6-7.4 4.2-8 9-.6-4.8-2.6-7.4-8-9 5.4-1.6 7.4-4.2 8-9z" {...p} />,
    list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...p} />,
    gauge: (
      <>
        <path d="M4 16a8 8 0 1 1 16 0" {...p} />
        <path d="M12 16l4-5" {...p} />
      </>
    ),
    check: <path d="M5 12.5l4.2 4L19 7" {...p} />,
    doc: (
      <>
        <rect x="5" y="3.5" width="14" height="17" rx="2.5" {...p} />
        <path d="M9 9h6M9 13h6M9 17h3" {...p} />
      </>
    ),
    flag: <path d="M5 21V4h11l-2 4 2 4H5" {...p} />,
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      {d[name]}
    </svg>
  )
}
