'use client'

import { useEffect, useState } from 'react'

/**
 * One call, opened.
 *
 * The dashboard could list calls and not show a single word of one, which made
 * every number on it unauditable: "eleven booked" is a claim you either take on
 * faith or check, and there was no way to check. This is the checking — what
 * was said, in the language it was said in, and the trace underneath it
 * showing what the agent actually did and how long each step took.
 *
 * Loaded when opened rather than with the list. A transcript is the largest
 * thing a call carries and nobody reads twenty-five of them.
 */

interface Turn {
  speaker: 'caller' | 'priya'
  text: string
  at: number
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
    language: string | null
    outcome: string | null
    triageBand: string | null
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

export function CallView({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="cv-scrim" onClick={onClose} role="presentation">
      <aside
        className="cv"
        role="dialog"
        aria-modal="true"
        aria-label="Call detail"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="cv-head">
          <div>
            <p className="cv-eyebrow">
              {c ? new Date(c.startedAt).toLocaleString('en-IN') : 'Call'}
            </p>
            <h2 className="cv-title">
              {c?.fromNumber ?? 'From the console'}
              {c?.language ? <span className="cv-lang">{LANG[c.language] ?? c.language}</span> : null}
            </h2>
          </div>
          <button className="cv-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {error && (
          <p className="db-empty kb-bad" role="alert">
            {error}
          </p>
        )}
        {!data && !error && <p className="db-empty">Opening…</p>}

        {c && (
          <>
            <div className="cv-facts">
              <Fact k="Outcome" v={c.outcome ?? '—'} tone={c.outcome ?? undefined} />
              <Fact k="Length" v={c.durationSec ? mmss(c.durationSec) : '—'} />
              <Fact k="Via" v={c.channel === 'twilio' ? 'phone' : c.channel} />
              {c.triageBand && <Fact k="Triage" v={c.triageBand} tone="alert" />}
            </div>

            <section className="cv-section">
              <h3 className="cv-h3">What was said</h3>
              {c.transcript.length === 0 ? (
                <p className="db-empty">
                  Nothing was transcribed — the caller rang off before speaking, or this call
                  predates transcript storage.
                </p>
              ) : (
                <ol className="cv-thread">
                  {c.transcript.map((t, i) => (
                    <li
                      key={i}
                      className={`cv-turn${t.speaker === 'caller' ? ' is-caller' : ' is-desk'}`}
                    >
                      <span className="cv-who">{t.speaker === 'caller' ? 'Caller' : 'Front desk'}</span>
                      {/* The language attribute so each turn is set in its own
                          script rather than a Latin stack guessing at it. */}
                      <p lang={c.language ? c.language.split('-')[0] : undefined}>{t.text}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="cv-section">
              <h3 className="cv-h3">
                What it did
                {data.trace.length > 0 && <span className="db-count">{data.trace.length}</span>}
              </h3>
              {data.trace.length === 0 ? (
                <p className="db-empty">No trace recorded for this call.</p>
              ) : (
                <ol className="cv-trace">
                  {data.trace.map((e) => (
                    <li key={e.id} className={e.ok === false ? 'is-bad' : undefined}>
                      <span className="cv-at mono">{(e.atMs / 1000).toFixed(1)}s</span>
                      <span className="cv-kind">{e.kind}</span>
                      <span className="cv-detail">
                        {e.detail ? summarise(e.detail) : ''}
                        {e.durationMs != null && <em> · {e.durationMs} ms</em>}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </aside>
    </div>
  )
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="cv-fact">
      <span className="cv-fact-k">{k}</span>
      <span className={`cv-fact-v${tone ? ` cv-tone-${tone}` : ''}`}>{v}</span>
    </div>
  )
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
