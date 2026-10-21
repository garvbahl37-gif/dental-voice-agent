'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppBar } from '../app-bar'
import { CallView } from './call-view'
import { DashboardSkeleton } from './skeleton'
import { LoadingScreen } from '../loading-screen'
import { VoiceBlob } from '@/components/VoiceBlob'
import '../landing.css'
import './dashboard.css'
import './careflow.css'

/**
 * What the practice sees.
 *
 * Laid out after Ronas IT's CareFlow patient portal: one large card for the
 * thing happening now, a column of small readings beside it, a month at a
 * glance, and the list underneath. Where CareFlow has a video call, Vaani has
 * the desk itself — the orb, the line, and what it did last. Where CareFlow has
 * vital signs, Vaani has the desk's: calls, first-reply time, bookings. No
 * photographs of anyone; people are named, never pictured.
 *
 * Ordered by what someone actually opens this for, which is not the flattering
 * number: the next callback sits in the column a glance lands on, because an
 * unanswered emergency is the only thing on this page that gets worse while
 * you read it.
 *
 * Every figure is a real aggregate over this tenant's rows. Where there is no
 * data yet a card says so plainly rather than showing a confident zero — a
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
  series: Day[]
  money: {
    callMinutes: number
    modelCostPaise: number
    telephonyCostPaise: number
    bookedRevenuePaise: number
    costPerBookingPaise: number
    roi: number
  }
  outstanding: Escalation[]
  recent: Call[]
}

interface Escalation {
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
}

interface Call {
  id: string
  startedAt: string
  durationSec: number | null
  channel: string
  direction: string
  fromNumber: string | null
  language: string | null
  outcome: string | null
  triageBand: string | null
}

type Day = { day: string; calls: number; booked: number }

const paise = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: p < 10_000 ? 2 : 0 })}`
const pct = (n: number) => `${Math.round(n * 100)}%`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A line still open this long after it started is a row nobody closed, not a call. */
const LIVE_WINDOW_MS = 30 * 60_000

/**
 * A figure that counts to its value instead of appearing at it.
 *
 * From zero on first show, and from the old value when it changes — so a
 * refresh that moves "booked" from 23 to 24 is seen to move. Instant for
 * anyone who asked for less motion.
 */
function Count({ to, format = (n) => String(Math.round(n)) }: { to: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(to)
      from.current = to
      return
    }
    const start = performance.now()
    const a = from.current
    let frame = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900)
      const v = a + (to - a) * (1 - Math.pow(1 - k, 3))
      setShown(v)
      if (k < 1) frame = requestAnimationFrame(step)
      else from.current = to
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [to])

  return <>{format(shown)}</>
}

export default function Dashboard() {
  const [openCall, setOpenCall] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [days, setDays] = useState(7)
  const [showAll, setShowAll] = useState(false)
  const [allCalls, setAllCalls] = useState(false)
  /** Ninety days of per-day counts: the calendar and the week chart read from it. */
  const [history, setHistory] = useState<Day[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (window: number) => {
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
      // The calendar spans months whatever range is picked above it, so it
      // asks for the longest window the endpoint gives.
      const h = await fetch('/api/dashboard?days=90').catch(() => null)
      if (h?.ok) setHistory(((await h.json()) as Payload).series)
    },
    [router],
  )

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
    [days, load],
  )

  useEffect(() => {
    void load(days)
  }, [days, load])

  /**
   * Kept current while it is being looked at.
   *
   * "The front desk" card that only knew about the moment the page loaded
   * would be a photograph labelled live. A hidden tab is not polled — nobody is
   * reading it, and the next look triggers a refresh anyway.
   */
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void load(days)
    }
    const id = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [days, load])

  if (error && !data) {
    return (
      <div className="lp db-shell cf">
        <p className="db-empty" role="alert">{error}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="lp db-shell cf">
        <LoadingScreen label="Opening the front desk" />
        <DashboardSkeleton />
      </div>
    )
  }

  const { stats, quality, money } = data
  const noCalls = stats.calls === 0

  /**
   * Urgent first, then newest.
   *
   * The top of the queue gets the card of its own; the rest are a list below,
   * capped so the calls are not pushed out of reach. An emergency must never
   * be the ninth item down.
   */
  const RANK: Record<string, number> = { emergency: 0, high: 1, normal: 2, low: 3 }
  const queue = [...data.outstanding].sort(
    (a, b) =>
      (RANK[a.urgency] ?? 9) - (RANK[b.urgency] ?? 9) ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  const [next, ...rest] = queue
  const visible = showAll ? rest : rest.slice(0, 4)
  // Six is a morning's worth; twenty-five is a long scroll on a phone.
  const calls = allCalls ? data.recent : data.recent.slice(0, 6)
  const period = days === 1 ? 'today' : `in ${days} days`

  return (
    <div className="lp db-shell cf">
      {/* The same element as in the loading branch, so it lifts rather than
          vanishing when the data arrives. */}
      <LoadingScreen label="Opening the front desk" done />
      <AppBar who={data.me.name} role={data.me.role} />

      <header className="cf-head">
        <div>
          {/* The practice is the title: an owner knows what this screen is and
              wants to see whose it is. */}
          <h1 className="cf-title">{data.org.name ?? 'Practice'}</h1>
          <p className="cf-sub">The front desk, and what it did while you were with a patient.</p>
        </div>
        <div className="cf-range" role="group" aria-label="Time range">
          {[1, 7, 30].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`cf-range-btn${days === d ? ' is-on' : ''}`}
              aria-pressed={days === d}
            >
              {d === 1 ? 'Today' : `${d} days`}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="db-empty kb-bad" role="alert" style={{ marginBottom: 14 }}>
          {error}
        </p>
      )}

      <div className="cf-grid">
        <div className="cf-main">
          <Desk
            recent={data.recent}
            history={history}
            stats={stats}
            waiting={queue.length}
            onOpen={setOpenCall}
          />

          <section className="cf-card cf-calls" id="calls">
            <header className="cf-card-head">
              <h2>Recent calls</h2>
              {data.recent.length > calls.length && (
                <button className="cf-more" onClick={() => setAllCalls(true)}>
                  View more <Glyph name="chev" />
                </button>
              )}
            </header>
            {data.recent.length === 0 ? (
              <p className="cf-empty">No calls yet. Take one from the console and it lands here.</p>
            ) : (
              <div className="cf-table" role="table" aria-label="Recent calls">
                <div className="cf-tr cf-th" role="row">
                  <span role="columnheader">Caller</span>
                  <span role="columnheader">Date</span>
                  <span role="columnheader">Time</span>
                  <span role="columnheader">Language</span>
                  <span role="columnheader">Length</span>
                  <span role="columnheader">Outcome</span>
                </div>
                {calls.map((c, i) => {
                  const d = new Date(c.startedAt)
                  return (
                    /* The whole row opens it. A call you can see listed but
                       not read makes every number above unauditable. */
                    <button
                      key={c.id}
                      className="cf-tr"
                      style={{ '--d': i } as React.CSSProperties}
                      role="row"
                      onClick={() => setOpenCall(c.id)}
                      aria-label={`Open the call from ${c.fromNumber ?? 'the console'}`}
                    >
                      <span className="cf-td-from mono" role="cell">
                        {c.fromNumber ?? 'Console'}
                      </span>
                      <span role="cell">
                        {d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span role="cell">{d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>
                      <span role="cell">
                        {LANG[c.language ?? ''] ?? '—'} · {c.channel === 'twilio' ? 'phone' : 'web'}
                      </span>
                      <span className="mono" role="cell">
                        {c.durationSec ? mmss(c.durationSec) : '—'}
                      </span>
                      <span className="cf-td-out" role="cell">
                        <span className={`cf-pill is-${tone(c)}`}>
                          {c.triageBand === 'RED' ? 'emergency' : (OUTCOME[c.outcome ?? ''] ?? '—')}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="cf-side">
          <WeekChart history={history} />

          <div className="cf-pair">
            <Stat
              icon="pulse"
              label="First reply"
              value={noCalls ? null : quality.firstResponseMsP50 / 1000}
              format={(n) => n.toFixed(1)}
              unit={noCalls ? '' : 's'}
              note={noCalls ? 'no calls yet' : `slowest 5% ${(quality.firstResponseMsP95 / 1000).toFixed(1)} s`}
              warn={quality.firstResponseMsP95 > 2500}
            />
            <Stat
              icon="check"
              label="Booked"
              value={stats.booked}
              unit={`of ${stats.calls}`}
              note={noCalls ? period : `${pct(stats.bookingRate)} ${period}`}
            />
          </div>

          <Calendar history={history} />

          <NextCallback
            item={next}
            waiting={queue.length}
            resolving={resolving}
            onResolve={(id) => void resolve(id)}
          />
        </aside>
      </div>

      {/* Below the fold: everything else, so the whole desk is on one page. */}
      <div className="cf-lower">
        <section className="cf-card cf-queue" id="callbacks">
          <header className="cf-card-head">
            <h2>
              Needs a human
              {queue.length > 0 && <span className="cf-count">{queue.length}</span>}
            </h2>
          </header>
          {queue.length === 0 ? (
            <p className="cf-empty is-good">Nothing outstanding. Every call was handled.</p>
          ) : rest.length === 0 ? (
            <p className="cf-empty">Only the callback above is waiting.</p>
          ) : (
            <>
              <ul className="cf-list">
                {visible.map((e) => (
                  <QueueRow
                    key={e.id}
                    e={e}
                    resolving={resolving === e.id}
                    onResolve={() => void resolve(e.id)}
                  />
                ))}
              </ul>
              {rest.length > visible.length && (
                <button className="cf-more is-block" onClick={() => setShowAll(true)}>
                  Show {rest.length - visible.length} more <Glyph name="chev" />
                </button>
              )}
            </>
          )}
        </section>

        <Earned money={money} noCalls={noCalls} period={period} />

        <Languages heard={stats.answeredInLanguage} />
      </div>

      {!noCalls && (
        <section className="cf-card cf-detail">
          <header className="cf-card-head">
            <h2>The detail</h2>
          </header>
          {/* Set as a list, not as cards. These are numbers you check when you
              have a question, not ones you scan every morning. */}
          <dl className="db-detail">
            <Row k="Calls became an appointment" v={pct(stats.bookingRate)} />
            <Row k="Average call" v={mmss(stats.avgDurationSec)} />
            <Row k="Handed to a human" v={String(stats.escalated)} />
            <Row k="Emergencies" v={String(stats.emergencies)} tone={stats.emergencies > 0 ? 'alert' : undefined} />
            <Row k="Transferred" v={pct(stats.transferRate)} />
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
            <Row k="Cost per booking" v={paise(money.costPerBookingPaise)} />
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

/**
 * The desk, where CareFlow has its video call.
 *
 * A dark sage scene with the orb in it. Live, it counts the call up; between
 * calls it says when the last one was and how it ended. The inset where
 * CareFlow shows the second camera is today, in two numbers. The round
 * controls are the three things someone at the desk does from here.
 */
function Desk({
  recent,
  history,
  stats,
  waiting,
  onOpen,
}: {
  recent: Call[]
  history: Day[]
  stats: Payload['stats']
  waiting: number
  onOpen: (id: string) => void
}) {
  // A call is written with its length and outcome when it ends, so one with
  // neither, started in the last half hour, is a line that is still open.
  const open = recent.find(
    (c) =>
      c.durationSec == null && !c.outcome && Date.now() - new Date(c.startedAt).getTime() < LIVE_WINDOW_MS,
  )
  const last = recent.find((c) => c.durationSec != null || c.outcome)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  const today = history.find((d) => d.day === dayKey(new Date()))
  const langs = Object.keys(stats.answeredInLanguage).length

  return (
    <section className={`cf-desk${open ? ' is-live' : ''}`} aria-label="The front desk">
      <div className="cf-desk-scene" aria-hidden />

      <header className="cf-desk-head">
        <h2>The front desk</h2>
        <p className={open ? 'mono' : undefined}>
          {open
            ? clock((now - new Date(open.startedAt).getTime()) / 1000)
            : last
              ? `Last call ${ago(last.startedAt)} · ${OUTCOME[last.outcome ?? ''] ?? 'ended'}`
              : 'Waiting for the first call'}
        </p>
        <span className="cf-desk-state">
          <i aria-hidden />
          {open ? `On a call · ${open.fromNumber ?? 'web caller'}` : 'Listening'}
        </span>
      </header>

      <div className="cf-desk-orb">
        <VoiceBlob
          state={open ? 'speaking' : 'idle'}
          micLevel={0}
          agentLevel={open ? 0.35 : 0}
          spectrum={() => new Uint8Array(0)}
          live={false}
        />
      </div>

      <div className="cf-desk-pip">
        <span className="cf-pip-k">Today</span>
        <span className="cf-pip-n">
          <Count to={today?.calls ?? 0} />
          <small>calls</small>
        </span>
        <span className="cf-pip-n">
          <Count to={today?.booked ?? 0} />
          <small>booked</small>
        </span>
        <span className="cf-pip-foot">
          {langs > 0 ? `${langs} ${langs === 1 ? 'language' : 'languages'} this period` : 'Eleven languages ready'}
        </span>
      </div>

      <nav className="cf-desk-controls" aria-label="Desk actions">
        <a className="cf-round is-coral" href="/console" title="Take a call" aria-label="Take a call">
          <Glyph name="phone" />
        </a>
        <button
          className="cf-round"
          title="Open the last call"
          aria-label="Open the last call"
          disabled={!last}
          onClick={() => last && onOpen(last.id)}
        >
          <Glyph name="play" />
        </button>
        <a className="cf-round" href="#calls" title="Recent calls" aria-label="Recent calls">
          <Glyph name="list" />
        </a>
        <a className="cf-round" href="#callbacks" title="Needs a human" aria-label={`Needs a human: ${waiting}`}>
          <Glyph name="bell" />
          {waiting > 0 && <span className="cf-round-badge">{waiting}</span>}
        </a>
      </nav>
    </section>
  )
}

/**
 * Calls this week, where CareFlow plots weight: a soft area, the busiest day
 * marked with a black pill, the week's total in the corner.
 */
function WeekChart({ history }: { history: Day[] }) {
  const byDay = new Map(history.map((d) => [d.day, d]))
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    const row = byDay.get(dayKey(d))
    return { date: d, calls: row?.calls ?? 0, booked: row?.booked ?? 0 }
  })
  const total = week.reduce((n, d) => n + d.calls, 0)
  const max = Math.max(1, ...week.map((d) => d.calls))
  const peak = week.reduce((best, d, i) => (d.calls > week[best]!.calls ? i : best), 0)

  const W = 320
  const H = 96
  const pts = week.map((d, i) => [(i / 6) * W, H - 10 - (d.calls / max) * (H - 30)] as const)
  // A smooth line through the points: each segment a cubic with flat handles.
  const line = pts
    .map(([x, y], i) => {
      if (i === 0) return `M ${x} ${y}`
      const [px, py] = pts[i - 1]!
      const mx = (px + x) / 2
      return `C ${mx} ${py}, ${mx} ${y}, ${x} ${y}`
    })
    .join(' ')
  const [peakX, peakY] = pts[peak]!

  return (
    <section className="cf-card cf-chart">
      <header className="cf-chart-head">
        <span className="cf-tile">
          <Glyph name="wave" />
        </span>
        <span className="cf-chart-k">Calls this week</span>
        <span className="cf-chart-n">
          <Count to={total} />
          <small>calls</small>
        </span>
      </header>
      <div className="cf-chart-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
          <path d={`${line} L ${W} ${H} L 0 ${H} Z`} className="cf-area" />
          <path d={line} className="cf-line" />
        </svg>
        {total > 0 && (
          <>
            <span
              className="cf-peak"
              style={{ left: `${(peakX / W) * 100}%`, top: `${(peakY / H) * 100}%` }}
              aria-hidden
            />
            <span
              className={`cf-peak-tag${peakY < H * 0.45 ? ' is-below' : ''}`}
              // Kept off the card's edges, where a Monday or Sunday peak
              // would otherwise cut the tag in half.
              style={{
                left: `${Math.min(86, Math.max(14, (peakX / W) * 100))}%`,
                top: `${(peakY / H) * 100}%`,
              }}
            >
              {week[peak]!.calls} calls
            </span>
          </>
        )}
      </div>
      <ol className="cf-chart-days" aria-label="Calls per day">
        {week.map((d) => (
          <li key={dayKey(d.date)}>
            <span aria-hidden>{d.date.toLocaleDateString('en-IN', { weekday: 'narrow' })}</span>
            <span className="sr-only">
              {d.date.toLocaleDateString('en-IN', { weekday: 'long' })}: {d.calls} calls, {d.booked} booked
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Stat({
  icon,
  label,
  value,
  format,
  unit,
  note,
  warn,
}: {
  icon: GlyphName
  label: string
  /** Null when there is nothing measured yet: shown as a dash, not a zero. */
  value: number | null
  format?: (n: number) => string
  unit: string
  note: string
  warn?: boolean
}) {
  return (
    <section className="cf-card cf-stat">
      <header>
        <span className="cf-tile">
          <Glyph name={icon} />
        </span>
        {label}
      </header>
      <p className="cf-stat-n">
        {value == null ? '—' : <Count to={value} format={format} />}
        <small>{unit}</small>
      </p>
      <p className={`cf-stat-note${warn ? ' is-warn' : ''}`}>{note}</p>
    </section>
  )
}

/**
 * The month, CareFlow's calendar: a day with calls is sage, deeper where the
 * desk booked, today in black. Two months back are a click away — as far as
 * the endpoint remembers.
 */
function Calendar({ history }: { history: Day[] }) {
  const [offset, setOffset] = useState(0)
  const byDay = useMemo(() => new Map(history.map((d) => [d.day, d])), [history])
  const now = new Date()
  const month = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  const first = (month.getDay() + 6) % 7 // Monday first
  const inMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((first + inMonth) / 7) * 7 }, (_, i) => {
    const d = new Date(month.getFullYear(), month.getMonth(), i - first + 1)
    return { d, outside: d.getMonth() !== month.getMonth() }
  })
  const todayKey = dayKey(now)

  return (
    <section className="cf-card cf-cal">
      <header className="cf-cal-head">
        <button
          className="cf-cal-nav"
          onClick={() => setOffset((o) => Math.min(2, o + 1))}
          disabled={offset >= 2}
          aria-label="Previous month"
        >
          <Glyph name="back" />
        </button>
        <h2>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
        <button
          className="cf-cal-nav"
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          aria-label="Next month"
        >
          <Glyph name="chev" />
        </button>
      </header>
      <div className="cf-cal-grid" role="grid" aria-label="Calls by day">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => (
          <span key={w} className="cf-cal-w" role="columnheader">
            {w}
          </span>
        ))}
        {cells.map(({ d, outside }, i) => {
          const k = dayKey(d)
          const row = byDay.get(k)
          const level = !row || row.calls === 0 ? 0 : row.booked >= 4 ? 3 : row.booked > 0 ? 2 : 1
          return (
            <span
              key={k}
              role="gridcell"
              className={`cf-day l${level}${outside ? ' is-out' : ''}${k === todayKey ? ' is-today' : ''}`}
              title={row ? `${row.calls} calls, ${row.booked} booked` : 'No calls'}
              style={{ '--d': i } as React.CSSProperties}
            >
              {d.getDate()}
            </span>
          )
        })}
      </div>
      <p className="cf-cal-key" aria-hidden>
        <i className="l1" /> calls <i className="l2" /> booked <i className="l3" /> busy
      </p>
    </section>
  )
}

/**
 * The one person to ring next, where CareFlow sells its subscription: the
 * soft green card at the foot of the column, with one white button that does
 * the job.
 */
function NextCallback({
  item,
  waiting,
  resolving,
  onResolve,
}: {
  item: Escalation | undefined
  waiting: number
  resolving: string | null
  onResolve: (id: string) => void
}) {
  if (!item) {
    return (
      <section className="cf-next is-clear">
        <h2>Next callback</h2>
        <p>Nobody is waiting on a call back. Every call this period was handled by the desk.</p>
        <a className="cf-next-btn" href="/console">
          Take a call yourself
        </a>
      </section>
    )
  }

  const who = item.brief.patientName ?? item.brief.patientPhone ?? 'Unidentified caller'
  const urgent = item.urgency === 'emergency' || item.urgency === 'high'

  return (
    <section className={`cf-next${urgent ? ' is-urgent' : ''}`}>
      <header>
        <h2>Next callback</h2>
        <span className={`cf-pill is-${urgent ? 'coral' : 'sage'}`}>{item.urgency}</span>
      </header>
      <p className="cf-next-who">{who}</p>
      <p>{item.reason}</p>
      {/* The line a receptionist reads before they pick up the phone. */}
      <p className="cf-next-do">{item.brief.recommendedAction}</p>
      {item.brief.patientPhone ? (
        <a className="cf-next-btn" href={`tel:${item.brief.patientPhone}`}>
          <Glyph name="phone" /> Call {item.brief.patientPhone}
        </a>
      ) : null}
      <button className="cf-next-link" disabled={resolving === item.id} onClick={() => onResolve(item.id)}>
        {resolving === item.id ? 'Marking…' : 'Mark handled'}
      </button>
      <p className="cf-next-foot">
        Flagged {ago(item.createdAt)}
        {waiting > 1 ? ` · ${waiting - 1} more waiting` : ''}
      </p>
    </section>
  )
}

/** One of the rest of the queue: a line until opened, the full brief once it is. */
function QueueRow({ e, resolving, onResolve }: { e: Escalation; resolving: boolean; onResolve: () => void }) {
  const [open, setOpen] = useState(false)
  const who = e.brief.patientName ?? e.brief.patientPhone ?? 'Unidentified caller'
  const urgent = e.urgency === 'emergency' || e.urgency === 'high'

  return (
    <li className={`cf-q${open ? ' is-open' : ''}`}>
      <button className="cf-q-row" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cf-q-who">{who}</span>
        <span className="cf-q-reason">{e.reason}</span>
        <span className={`cf-pill is-${urgent ? 'coral' : 'sage'}`}>{e.urgency}</span>
        <span className="cf-q-when">{ago(e.createdAt)}</span>
      </button>
      {open && (
        <div className="cf-q-body">
          {e.brief.whatHappened.length > 0 && (
            <ul>
              {e.brief.whatHappened.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <p className="cf-next-do">{e.brief.recommendedAction}</p>
          <div className="cf-q-do">
            {e.brief.patientPhone && (
              <a className="cf-btn is-dark" href={`tel:${e.brief.patientPhone}`}>
                <Glyph name="phone" /> Call
              </a>
            )}
            <button className="cf-btn" disabled={resolving} onClick={onResolve}>
              {resolving ? 'Marking…' : 'Mark handled'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/** What it earned, and what it cost to earn it. */
function Earned({ money, noCalls, period }: { money: Payload['money']; noCalls: boolean; period: string }) {
  const cost = money.modelCostPaise + money.telephonyCostPaise
  const earned = money.bookedRevenuePaise
  // How much of the bar the running cost takes — a sliver is the point.
  const share = earned > 0 ? Math.max(1.5, Math.min(100, (cost / earned) * 100)) : 0

  return (
    <section className="cf-card cf-earned">
      <header className="cf-chart-head">
        <span className="cf-tile">
          <Glyph name="rupee" />
        </span>
        <span className="cf-chart-k">Earned {period}</span>
      </header>
      <p className="cf-stat-n is-big">{noCalls ? '—' : <Count to={earned} format={(n) => paise(Math.round(n))} />}</p>
      <p className="cf-stat-note">booked at list price</p>
      <div className="cf-bar" aria-hidden>
        <span style={{ width: `${share}%` }} />
      </div>
      <dl className="cf-mini">
        <div>
          <dt>To run</dt>
          <dd>{paise(cost)}</dd>
        </div>
        <div>
          <dt>Return</dt>
          <dd>{money.roi > 0 ? `${money.roi.toFixed(1)}×` : '—'}</dd>
        </div>
        <div>
          <dt>Per booking</dt>
          <dd>{paise(money.costPerBookingPaise)}</dd>
        </div>
      </dl>
    </section>
  )
}

/** Which languages the desk answered in, as bars — the product's one claim, counted. */
function Languages({ heard }: { heard: Record<string, number> }) {
  const rows = Object.entries(heard).sort((a, b) => b[1] - a[1])
  const total = rows.reduce((n, [, v]) => n + v, 0)
  return (
    <section className="cf-card cf-langs">
      <header className="cf-chart-head">
        <span className="cf-tile">
          <Glyph name="globe" />
        </span>
        <span className="cf-chart-k">Languages heard</span>
      </header>
      {rows.length === 0 ? (
        <p className="cf-empty">No calls yet.</p>
      ) : (
        <ul className="cf-lang-list">
          {rows.map(([l, n]) => (
            <li key={l}>
              <span className="cf-lang-name" lang={l.split('-')[0]}>
                {LANG[l] ?? l}
              </span>
              <span className="cf-lang-bar" aria-hidden>
                <span style={{ width: `${(n / total) * 100}%` }} />
              </span>
              <span className="cf-lang-n mono">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
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

/** Which pill a call wears: booked sage, needs-a-person coral, answered sky. */
function tone(c: Call): string {
  if (c.triageBand === 'RED' || c.outcome === 'escalated' || c.outcome === 'failed') return 'coral'
  if (c.outcome === 'booked' || c.outcome === 'rescheduled') return 'sage'
  if (c.outcome === 'answered') return 'sky'
  return 'grey'
}

type GlyphName =
  | 'phone'
  | 'play'
  | 'list'
  | 'bell'
  | 'wave'
  | 'pulse'
  | 'check'
  | 'chev'
  | 'back'
  | 'rupee'
  | 'globe'

function Glyph({ name }: { name: GlyphName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const d: Record<GlyphName, React.ReactNode> = {
    phone: (
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        {...p}
      />
    ),
    play: <path d="M8 5.5v13l10-6.5z" {...p} />,
    list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" {...p} />,
    bell: (
      <>
        <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" {...p} />
        <path d="M10 20.5a2.2 2.2 0 0 0 4 0" {...p} />
      </>
    ),
    wave: <path d="M3 12h3l2-5 3 10 3-12 3 9 2-2h2" {...p} />,
    pulse: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path d="M12 7v5l3 2" {...p} />
      </>
    ),
    check: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="3" {...p} />
        <path d="M8 3v4M16 3v4M8.5 13.5l2.5 2.5 4.5-5" {...p} />
      </>
    ),
    chev: <path d="M9 6l6 6-6 6" {...p} />,
    back: <path d="M15 6l-6 6 6 6" {...p} />,
    rupee: <path d="M7 5h10M7 9h10M7 5c5 0 6 2 6 4s-1.5 4-6 4l7 6" {...p} />,
    globe: (
      <>
        <circle cx="12" cy="12" r="8.5" {...p} />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.3 8.4 12S9.6 5.9 12 3.5z" {...p} />
      </>
    ),
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      {d[name]}
    </svg>
  )
}

/** "4 min ago", "3 h ago", "yesterday", then a date — how people say it. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h ago`
  if (h < 48) return 'yesterday'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
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
