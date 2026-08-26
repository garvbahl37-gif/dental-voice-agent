'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CallView } from './call-view'
import { DashboardSkeleton } from './skeleton'
import '../landing.css'
import './dashboard.css'

/**
 * What the practice sees.
 *
 * Ordered by what someone actually opens this for, which is not the flattering
 * number: **needs a human** comes first, because an unanswered emergency is the
 * only thing on this page that gets worse while you read it. The headline
 * counts sit under it, then the money, then the calls themselves.
 *
 * Every figure is a real aggregate over this tenant's rows. Where there is no
 * data yet the tile says so plainly rather than showing a confident zero — a
 * dashboard that cannot tell "none" from "not measured" teaches people to
 * distrust all of it.
 */

interface Payload {
  org: { name?: string; timezone?: string; plan?: string }
  me: { name: string; role: string }
  days: number
  stats: {
    calls: number
    booked: number
    escalated: number
    missed: number
    emergencies: number
    avgDurationSec: number
    bookingRate: number
    transferRate: number
    answeredInLanguage: Record<string, number>
  }
  quality: {
    firstResponseMsP50: number
    firstResponseMsP95: number
    avgResponseMs: number
    bargeInsPerCall: number
    noSpeechRate: number
  }
  series: Array<{ day: string; calls: number; booked: number }>
  money: {
    callMinutes: number
    modelCostPaise: number
    telephonyCostPaise: number
    bookedRevenuePaise: number
    costPerBookingPaise: number
    roi: number
  }
  outstanding: Array<{
    id: string
    reason: string
    urgency: string
    createdAt: string
    brief: {
      patientName?: string
      patientPhone?: string
      language?: string
      reason: string
      whatHappened: string[]
      agentActions: string[]
      recommendedAction: string
    }
  }>
  recent: Array<{
    id: string
    startedAt: string
    durationSec: number | null
    channel: string
    direction: string
    fromNumber: string | null
    language: string | null
    outcome: string | null
    triageBand: string | null
  }>
}

const paise = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: p < 10_000 ? 2 : 0 })}`
const pct = (n: number) => `${Math.round(n * 100)}%`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export default function Dashboard() {
  const [openCall, setOpenCall] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState(7)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Mark one handled, then reload.
   *
   * Reloaded rather than removed locally, because resolving one changes the
   * headline counts too — a queue that empties while the number above it stays
   * put reads as broken.
   */
  const resolve = useCallback(
    async (id: string) => {
      setResolving(id)
      try {
        const res = await fetch('/api/dashboard/escalation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          setError(body.error ?? 'Could not mark that handled.')
          return
        }
        await load(days)
      } catch {
        setError('Could not reach the server.')
      } finally {
        setResolving(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days],
  )

  const load = useCallback(async (window: number) => {
    const res = await fetch(`/api/dashboard?days=${window}`)
    if (res.status === 401) {
      router.push('/login')
      return
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setError(body.error ?? 'Could not load the dashboard.')
      return
    }
    setError(null)
    setData((await res.json()) as Payload)
  }, [router])

  useEffect(() => {
    void load(days)
  }, [days, load])

  if (error) {
    return (
      <div className="lp db-shell">
        <p className="db-empty" role="alert">{error}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="lp db-shell">
        <DashboardSkeleton />
      </div>
    )
  }

  const { stats, quality, money } = data
  const noCalls = stats.calls === 0

  /**
   * Urgent first, then newest.
   *
   * A busy week produces a dozen open items, and showing all of them pushed
   * every metric below the fold — so the queue is ranked and capped, with the
   * rest one click away. An emergency must never be the ninth card down.
   */
  const RANK: Record<string, number> = { emergency: 0, high: 1, normal: 2, low: 3 }
  const queue = [...data.outstanding].sort(
    (a, b) =>
      (RANK[a.urgency] ?? 9) - (RANK[b.urgency] ?? 9) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const visible = showAll ? queue : queue.slice(0, 3)

  return (
    <div className="lp db-shell">
      <header className="db-head">
        <div>
          {/* The practice is the title. "Front desk" was the heading and the
              practice a label above it, which is backwards: an owner knows
              what this screen is and wants to see whose it is. */}
          <h1 className="db-title">{data.org.name ?? 'Practice'}</h1>
          <p className="db-sub">The front desk, and what it did while you were with a patient.</p>
        </div>
        <div className="db-head-right">
          <div className="db-range" role="group" aria-label="Time range">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`db-range-btn${days === d ? ' is-on' : ''}`}
                aria-pressed={days === d}
              >
                {d === 1 ? 'Today' : `${d} days`}
              </button>
            ))}
          </div>
          <a className="db-signout" href="/knowledge">
            Knowledge
          </a>
          <a className="db-signout" href="/settings">
            Settings
          </a>
          <span className="db-who">
            {data.me.name} · {data.me.role}
          </span>
          <button
            className="db-signout"
            onClick={async () => {
              await fetch('/api/auth', { method: 'DELETE' })
              router.push('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* First, because it is the only thing here that gets worse while you read. */}
      <section className="db-section">
        <h2 className="db-h2">
          Needs a human
          {data.outstanding.length > 0 && <span className="db-count">{data.outstanding.length}</span>}
        </h2>
        {data.outstanding.length === 0 ? (
          <p className="db-empty db-good">Nothing outstanding. Every call was handled.</p>
        ) : (
          <ul className="db-queue">
            {visible.map((e) => (
              <li key={e.id} className={`db-brief db-urgency-${e.urgency}`}>
                <div className="db-brief-head">
                  <strong>{e.brief.patientName ?? e.brief.patientPhone ?? 'Unidentified caller'}</strong>
                  <span className="db-chip">{e.urgency}</span>
                  <span className="db-time">{new Date(e.createdAt).toLocaleString('en-IN')}</span>
                </div>
                <p className="db-brief-reason">{e.reason}</p>
                {e.brief.whatHappened.length > 0 && (
                  <ul className="db-brief-list">
                    {e.brief.whatHappened.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
                {/* The line a receptionist reads before they pick up the phone. */}
                <p className="db-brief-action">{e.brief.recommendedAction}</p>
                {/* The queue was read-only, so it only ever grew. Closing one
                    off is the difference between a list and a worklist. */}
                <button
                  className="db-resolve"
                  disabled={resolving === e.id}
                  onClick={() => void resolve(e.id)}
                >
                  {resolving === e.id ? 'Marking…' : 'Mark handled'}
                </button>
              </li>
            ))}
            {queue.length > visible.length && (
              <li>
                <button className="db-more" onClick={() => setShowAll(true)}>
                  Show {queue.length - visible.length} more
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {/* The lead.
          Eight tiles of equal weight made "calls answered" and "transferred"
          look equally important, so nothing looked important. Three figures
          carry the week; everything else is detail and is set as detail. */}
      <section className="db-lead">
        {noCalls ? (
          <p className="db-empty">
            No calls in this period yet. Point a phone number at the practice, or take one from the
            console, and the numbers start here.
          </p>
        ) : (
          <>
            <div className="db-big">
              <Big n={stats.calls} k="answered" />
              <Big n={stats.booked} k="booked" tone="good" />
              <Big
                n={stats.emergencies}
                k={stats.emergencies === 1 ? 'emergency' : 'emergencies'}
                tone={stats.emergencies > 0 ? 'alert' : undefined}
              />
            </div>
            <p className="db-lead-line">
              {pct(stats.bookingRate)} of calls became an appointment · {mmss(stats.avgDurationSec)}{' '}
              on the phone on average · {stats.escalated} handed to a human ·{' '}
              {pct(stats.transferRate)} transferred
            </p>
          </>
        )}
      </section>

      <section className="db-section">
        <h2 className="db-h2">Recent calls</h2>
        {data.recent.length === 0 ? (
          <p className="db-empty">No calls yet.</p>
        ) : (
          <div className="db-table-wrap">
            <table className="db-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>From</th>
                  <th>Via</th>
                  <th>Language</th>
                  <th>Length</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((c) => (
                  /* The whole row opens it. A call you can see listed but not
                     read makes every number above unauditable. */
                  <tr
                    key={c.id}
                    className="db-row-open"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open the call from ${c.fromNumber ?? 'the console'}`}
                    onClick={() => setOpenCall(c.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenCall(c.id)
                      }
                    }}
                  >
                    <td>{new Date(c.startedAt).toLocaleString('en-IN')}</td>
                    <td className="mono">{c.fromNumber ?? '—'}</td>
                    <td>{c.channel === 'twilio' ? 'phone' : c.channel}</td>
                    <td>{LANG[c.language ?? ''] ?? '—'}</td>
                    <td className="mono">{c.durationSec ? mmss(c.durationSec) : '—'}</td>
                    <td>
                      <span className={`db-outcome db-outcome-${c.outcome ?? 'none'}`}>
                        {OUTCOME[c.outcome ?? ''] ?? '—'}
                      </span>
                      {c.triageBand === 'RED' && <span className="db-chip db-chip-alert">emergency</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!noCalls && (
        <section className="db-section">
          <h2 className="db-h2">The detail</h2>
          {/* Set as a list, not as tiles. These are numbers you check when you
              have a question, not ones you scan every morning — and giving
              them the same cards as the headline made the page a wall. */}
          <dl className="db-detail">
            <Row k="First reply, median" v={`${quality.firstResponseMsP50} ms`} />
            {/* p95, not the mean: one nine-second reply matters to the caller
                who got it, and a mean hides it completely. */}
            <Row
              k="First reply, slowest 5%"
              v={`${quality.firstResponseMsP95} ms`}
              tone={quality.firstResponseMsP95 > 2500 ? 'warn' : undefined}
            />
            <Row k="Average reply" v={`${quality.avgResponseMs} ms`} />
            <Row k="Interruptions per call" v={String(quality.bargeInsPerCall)} />
            <Row k="Nobody spoke" v={pct(quality.noSpeechRate)} />
            <Row
              k="Languages heard"
              v={
                Object.entries(stats.answeredInLanguage)
                  .map(([l, n]) => `${LANG[l] ?? l} ${n}`)
                  .join(' · ') || '—'
              }
            />
            <Row k="Booked, at list price" v={paise(money.bookedRevenuePaise)} tone="good" />
            <Row k="Cost to run" v={paise(money.modelCostPaise + money.telephonyCostPaise)} />
            <Row k="Cost per booking" v={paise(money.costPerBookingPaise)} />
            <Row
              k="Return"
              v={money.roi > 0 ? `${money.roi.toFixed(1)}×` : '—'}
              tone={money.roi > 1 ? 'good' : undefined}
            />
            <Row k="Minutes on the phone" v={`${money.callMinutes} min`} />
          </dl>
          <p className="db-note">
            Revenue counts only appointments this agent booked and that were not cancelled, valued
            at the low end of each treatment&rsquo;s price range. Telephony is estimated per minute.
          </p>
        </section>
      )}


      {openCall && <CallView id={openCall} onClose={() => setOpenCall(null)} />}
    </div>
  )
}

/** One of the three figures that carry the week. */
function Big({ n, k, tone }: { n: number | string; k: string; tone?: string }) {
  return (
    <div className="db-big-cell">
      <span className={`db-big-n${tone ? ` db-tone-${tone}` : ''}`}>{n}</span>
      <span className="db-big-k">{k}</span>
    </div>
  )
}

/** A line of the detail list: a label, a rule, a figure. */
function Row({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="db-detail-row">
      <dt>{k}</dt>
      <dd className={tone ? `db-tone-${tone}` : undefined}>{v}</dd>
    </div>
  )
}


const LANG: Record<string, string> = {
  'en-IN': 'English',
  'hi-IN': 'हिन्दी',
  'hi-Latn-IN': 'Hinglish',
}

const OUTCOME: Record<string, string> = {
  booked: 'booked',
  rescheduled: 'rescheduled',
  cancelled: 'cancelled',
  answered: 'answered',
  escalated: 'escalated',
  abandoned: 'abandoned',
  no_speech: 'no speech',
  failed: 'failed',
}
