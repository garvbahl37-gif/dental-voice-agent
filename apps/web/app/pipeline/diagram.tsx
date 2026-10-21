'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The whole platform on one board, moving.
 *
 * CareFlow's big dark card with Momo's white glass standing on it: the two
 * ways a call comes in, the voice session, the one model that hears and
 * speaks, the tools it reaches for, the database, and where it all ends up.
 * Packets run along the wires — sky blue for the caller's voice, green for
 * the desk's, white for a tool being asked, sage for a row being written —
 * and the board tells the story six beats at a time, lighting the part of
 * the platform each beat is about.
 *
 * Every box is a real component; every wire is a call the code makes. Two
 * layouts from one set of nodes: across on a wide screen, down on a phone.
 */

type NodeId =
  | 'phone'
  | 'browser'
  | 'session'
  | 'model'
  | 'diary'
  | 'patients'
  | 'knowledge'
  | 'triage'
  | 'handover'
  | 'db'
  | 'dashboard'
  | 'queue'
  | 'api'

type Kind = 'in' | 'out' | 'tool' | 'write' | 'show'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const NODES: Record<NodeId, { title: string; sub: string; icon: IconName; wide: Box; tall: Box }> = {
  phone: { title: 'Phone', sub: 'Twilio · 8 kHz', icon: 'phone', wide: { x: 90, y: 200, w: 160, h: 74 }, tall: { x: 145, y: 60, w: 160, h: 72 } },
  browser: { title: 'Browser', sub: '16k in · 24k out', icon: 'globe', wide: { x: 90, y: 400, w: 160, h: 74 }, tall: { x: 325, y: 60, w: 160, h: 72 } },
  session: { title: 'Voice session', sub: 'WebSocket', icon: 'socket', wide: { x: 300, y: 300, w: 170, h: 80 }, tall: { x: 235, y: 230, w: 230, h: 72 } },
  model: { title: 'Gemini Live', sub: 'speech in, speech out', icon: 'orb', wide: { x: 530, y: 300, w: 190, h: 210 }, tall: { x: 235, y: 420, w: 230, h: 170 } },
  diary: { title: 'Diary', sub: 'check · book · move', icon: 'calendar', wide: { x: 770, y: 100, w: 170, h: 62 }, tall: { x: 50, y: 660, w: 86, h: 74 } },
  patients: { title: 'Patients', sub: 'found by number', icon: 'person', wide: { x: 770, y: 200, w: 170, h: 62 }, tall: { x: 142, y: 660, w: 86, h: 74 } },
  knowledge: { title: 'Knowledge', sub: 'your pages', icon: 'book', wide: { x: 770, y: 300, w: 170, h: 62 }, tall: { x: 235, y: 660, w: 86, h: 74 } },
  triage: { title: 'Triage', sub: 'fixed rules', icon: 'shield', wide: { x: 770, y: 400, w: 170, h: 62 }, tall: { x: 328, y: 660, w: 86, h: 74 } },
  handover: { title: 'Handover', sub: 'to your team', icon: 'hand', wide: { x: 770, y: 500, w: 170, h: 62 }, tall: { x: 420, y: 660, w: 86, h: 74 } },
  db: { title: 'Postgres', sub: 'per practice', icon: 'db', wide: { x: 980, y: 300, w: 110, h: 112 }, tall: { x: 235, y: 880, w: 230, h: 72 } },
  dashboard: { title: 'Dashboard', sub: 'every 30 s', icon: 'chart', wide: { x: 1150, y: 170, w: 170, h: 70 }, tall: { x: 90, y: 1040, w: 130, h: 70 } },
  queue: { title: 'Needs a human', sub: 'reason · number', icon: 'bell', wide: { x: 1150, y: 300, w: 170, h: 70 }, tall: { x: 235, y: 1040, w: 130, h: 70 } },
  api: { title: 'API · webhooks', sub: 'signed', icon: 'code', wide: { x: 1150, y: 430, w: 170, h: 70 }, tall: { x: 380, y: 1040, w: 130, h: 70 } },
}

/** Lanes: the voice runs both ways, so in and out are drawn side by side. */
const EDGES: Array<{ from: NodeId; to: NodeId; kind: Kind; lane?: number }> = [
  { from: 'phone', to: 'session', kind: 'in', lane: -7 },
  { from: 'browser', to: 'session', kind: 'in', lane: -7 },
  { from: 'session', to: 'model', kind: 'in', lane: -7 },
  { from: 'model', to: 'session', kind: 'out', lane: 7 },
  { from: 'session', to: 'phone', kind: 'out', lane: 7 },
  { from: 'session', to: 'browser', kind: 'out', lane: 7 },
  { from: 'model', to: 'diary', kind: 'tool' },
  { from: 'model', to: 'patients', kind: 'tool' },
  { from: 'model', to: 'knowledge', kind: 'tool' },
  { from: 'model', to: 'triage', kind: 'tool' },
  { from: 'model', to: 'handover', kind: 'tool' },
  { from: 'diary', to: 'db', kind: 'write' },
  { from: 'patients', to: 'db', kind: 'write' },
  { from: 'triage', to: 'db', kind: 'write' },
  { from: 'handover', to: 'db', kind: 'write' },
  { from: 'db', to: 'dashboard', kind: 'show' },
  { from: 'db', to: 'queue', kind: 'show' },
  { from: 'db', to: 'api', kind: 'show' },
]

/** The six beats the board tells, and what each one lights. */
export const BEATS: Array<{ title: string; line: string; nodes: NodeId[]; edges: (e: (typeof EDGES)[number]) => boolean }> = [
  {
    title: 'The line opens',
    line: 'A call arrives by phone through Twilio, or in the browser. On the phone, the caller is looked up by number before the first word.',
    nodes: ['phone', 'browser', 'session'],
    edges: (e) => e.kind === 'in' && e.to === 'session',
  },
  {
    title: 'One model hears and answers',
    line: 'The voice streams to Gemini Live, which listens and speaks in one step — no separate transcriber, no separate voice.',
    nodes: ['session', 'model'],
    edges: (e) => (e.kind === 'in' && e.from === 'session') || e.kind === 'out',
  },
  {
    title: 'It looks things up',
    line: 'Mid-sentence it asks the tools: who is calling, what is open in the diary, what your pages say.',
    nodes: ['model', 'patients', 'diary', 'knowledge'],
    edges: (e) => e.kind === 'tool' && ['patients', 'diary', 'knowledge'].includes(e.to),
  },
  {
    title: 'It books, or hands over',
    line: 'A slot is re-checked as it is booked. Pain or swelling goes to the triage rules; anything it cannot answer goes to your team.',
    nodes: ['model', 'diary', 'triage', 'handover'],
    edges: (e) => e.kind === 'tool' && ['diary', 'triage', 'handover'].includes(e.to),
  },
  {
    title: 'Everything is written down',
    line: 'Transcript, outcome, language, triage band, appointments and handovers land in the practice’s own rows.',
    nodes: ['diary', 'patients', 'triage', 'handover', 'db'],
    edges: (e) => e.kind === 'write',
  },
  {
    title: 'Your desk sees it',
    line: 'The dashboard picks it up within thirty seconds; a phone call also fires a signed webhook to your own systems.',
    nodes: ['db', 'dashboard', 'queue', 'api'],
    edges: (e) => e.kind === 'show',
  },
]

const BEAT_MS = 3400

type Layout = 'wide' | 'tall'
const VIEW: Record<Layout, { w: number; h: number }> = { wide: { w: 1240, h: 600 }, tall: { w: 470, h: 1100 } }

/** A wire from one box to another: across on a wide board, down on a tall one. */
function wire(a: Box, b: Box, layout: Layout, lane = 0): string {
  if (layout === 'wide') {
    const forward = b.x > a.x
    const x1 = a.x + (forward ? a.w / 2 : -a.w / 2)
    const x2 = b.x + (forward ? -b.w / 2 : b.w / 2)
    const y1 = a.y + lane
    const y2 = b.y + lane
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }
  const down = b.y > a.y
  const y1 = a.y + (down ? a.h / 2 : -a.h / 2)
  const y2 = b.y + (down ? -b.h / 2 : b.h / 2)
  const x1 = a.x + lane
  const x2 = b.x + lane
  const my = (y1 + y2) / 2
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`
}

export function PipelineBoard() {
  const root = useRef<HTMLDivElement>(null)
  const [beat, setBeat] = useState(0)
  const [visible, setVisible] = useState(false)
  const [held, setHeld] = useState(false)

  // Runs while on screen; the packets' own animation is paused off it too.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      const on = !!e?.isIntersecting
      setVisible(on)
      for (const svg of el.querySelectorAll('svg')) (on ? svg.unpauseAnimations() : svg.pauseAnimations())
    }, { threshold: 0.15 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setTimeout(() => setBeat((b) => (b + 1) % BEATS.length), BEAT_MS)
    return () => window.clearTimeout(t)
  }, [beat, visible, held])

  const now = BEATS[beat]!

  return (
    <div className="pl-board" ref={root} data-beat={beat}>
      <Board layout="wide" beat={beat} />
      <Board layout="tall" beat={beat} />

      <div className="pl-story">
        <ol className="pl-beats" aria-label="The six steps">
          {BEATS.map((b, i) => (
            <li key={b.title}>
              <button
                className={i === beat ? 'is-on' : i < beat ? 'is-done' : undefined}
                onClick={() => {
                  setHeld(true)
                  setBeat(i)
                }}
                aria-label={b.title}
                aria-current={i === beat ? 'step' : undefined}
              >
                {/* Keyed to the beat so the fill starts again each time. */}
                <i key={i === beat ? `on${beat}` : 'off'} style={{ animationDuration: held ? '0s' : `${BEAT_MS}ms` }} />
              </button>
            </li>
          ))}
        </ol>
        <div className="pl-now" key={beat} aria-live="polite">
          <span className="pl-now-n mono">{String(beat + 1).padStart(2, '0')}</span>
          <div>
            <h3>{now.title}</h3>
            <p>{now.line}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function Board({ layout, beat }: { layout: Layout; beat: number }) {
  const view = VIEW[layout]
  const now = BEATS[beat]!
  // Boxes are kept by their centres, which is what the wires join.
  const pct = (b: Box) =>
    ({
      left: `${((b.x - b.w / 2) / view.w) * 100}%`,
      top: `${((b.y - b.h / 2) / view.h) * 100}%`,
      width: `${(b.w / view.w) * 100}%`,
      height: `${(b.h / view.h) * 100}%`,
    }) as React.CSSProperties

  return (
    <div className={`pl-canvas is-${layout}`} style={{ aspectRatio: `${view.w} / ${view.h}` }}>
      <svg className="pl-wires" viewBox={`0 0 ${view.w} ${view.h}`} aria-hidden>
        {EDGES.map((e, i) => {
          const d = wire(NODES[e.from][layout], NODES[e.to][layout], layout, e.lane)
          const hot = now.edges(e)
          return (
            <g key={i} className={`pl-edge is-${e.kind}${hot ? ' is-hot' : ''}`}>
              <path className="pl-wire" d={d} />
              <path className="pl-wire-glow" d={d} />
              {/* Two packets a wire, half a run apart; tools also answer back. */}
              {[0, 1].map((k) => (
                <circle key={k} className="pl-packet" r={e.kind === 'tool' || e.kind === 'write' ? 4 : 4.5}>
                  <animateMotion
                    dur={e.kind === 'in' || e.kind === 'out' ? '1.6s' : '2.2s'}
                    begin={`${k * (e.kind === 'in' || e.kind === 'out' ? 0.8 : 1.1) + (i % 4) * 0.15}s`}
                    repeatCount="indefinite"
                    path={d}
                    {...(e.kind === 'tool' && k === 1 ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})}
                  />
                </circle>
              ))}
            </g>
          )
        })}
      </svg>

      {(Object.keys(NODES) as NodeId[]).map((id) => {
        const n = NODES[id]
        const lit = now.nodes.includes(id)
        return (
          <div key={id} className={`pl-node is-${id}${lit ? ' is-lit' : ''}`} style={pct(n[layout])}>
            {id === 'model' ? (
              <span className="pl-orb" aria-hidden>
                <i />
              </span>
            ) : (
              <span className="pl-icon" aria-hidden>
                <Icon name={n.icon} />
              </span>
            )}
            <span className="pl-node-t">
              <b>{n.title}</b>
              <small>{n.sub}</small>
            </span>
          </div>
        )
      })}
    </div>
  )
}

type IconName = 'phone' | 'globe' | 'socket' | 'orb' | 'calendar' | 'person' | 'book' | 'shield' | 'hand' | 'db' | 'chart' | 'bell' | 'code'

export function Icon({ name }: { name: IconName }) {
  const d: Record<IconName, React.ReactNode> = {
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
    globe: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z" />
      </>
    ),
    socket: <path d="M4 12h3l2-5 3 10 2-7 2 4h4" />,
    orb: <circle cx="12" cy="12" r="8" />,
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="3" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20c1.2-3.6 3.8-5.4 7-5.4s5.8 1.8 7 5.4" />
      </>
    ),
    book: <path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3zM17 7.5h2V20" />,
    shield: <path d="M12 3.5l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9v-5zM9 12l2 2 4-4" />,
    hand: <path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 10.5V5a1.5 1.5 0 0 1 3 0v5.5M13 10.5V6a1.5 1.5 0 0 1 3 0v6M16 9.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 14a1.5 1.5 0 0 1 2.5-1.6L8 14" />,
    db: (
      <>
        <ellipse cx="12" cy="6" rx="7" ry="2.8" />
        <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
      </>
    ),
    chart: <path d="M4 19h16M6 15l4-5 3 3 5-7" />,
    bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" />,
    code: <path d="M8.5 7L4 12l4.5 5M15.5 7L20 12l-4.5 5M13.5 5l-3 14" />,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d[name]}
    </svg>
  )
}
