'use client'

import { useEffect, useRef } from 'react'
import { LANG_CHIP, htmlLang, scriptOf, type Lang, type WordMark } from '@vaani/shared'

/**
 * The transcript.
 *
 * Two properties it must have, both of which the first version got wrong.
 *
 * **One bubble per turn.** The agent's reply is synthesised in clauses, but the
 * caller experiences it as one answer. Rendering a bubble per clause made a
 * single sentence look like the agent repeating herself.
 *
 * **Words appear when they are spoken.** `tts.begin` fires when the *server*
 * starts synthesising, which — because it streams ahead of playback — is often
 * seconds before the caller hears anything. Captioning on that event shows text
 * for speech that has not happened yet. Words are revealed against reported
 * playback position instead, so the transcript tracks the ear.
 */

export interface Utterance {
  id: string
  text: string
  marks: WordMark[]
  playedMs: number
  /** Generated but cut off by the caller interrupting. */
  unspoken?: string
}

export interface Turn {
  id: string
  speaker: 'caller' | 'priya'
  lang: Lang
  at: number
  /**
   * When this voice stopped. For the caller, the last moment their words were
   * still arriving; for the desk, when the audio queued for the reply ran out
   * — or the moment it was cut off. What the call summary's lanes are drawn on.
   */
  endAt?: number
  /** The desk was talked over and stopped. */
  cut?: boolean
  /** Caller turns carry a single text; the desk's may be several utterances. */
  text?: string
  utterances?: Utterance[]
  interim?: boolean
}

/**
 * What the desk did between the words, set into the conversation.
 *
 * The practice panel showed a tool name and a latency off to the side, which
 * told you something happened but not what came of it. A diary that was
 * checked belongs where the caller was told about it — the open slots under
 * the sentence that offered them, the booking under the "done".
 */
export type InlineCard =
  | {
      kind: 'tool'
      id: string
      at: number
      name: string
      args: Record<string, unknown>
      result?: unknown
      ok?: boolean
      ms?: number
    }
  | {
      kind: 'booked'
      id: string
      at: number
      patient?: string
      service?: string
      doctor?: string
      start?: string
      when?: string
    }
  | { kind: 'triage'; id: string; at: number; band: string; reason: string }
  | {
      kind: 'patient'
      id: string
      at: number
      name?: string
      phone?: string
      upcoming?: number
      isNew?: boolean
    }

/** Shown by their own card instead, so a chip for them would say it twice. */
const CARDED = new Set(['book_appointment', 'lookup_patient', 'create_patient', 'triage_symptoms'])

const TOOL_LABEL: Record<string, string> = {
  check_availability: 'Checking the diary',
  list_services: 'Reading the treatment list',
  list_my_appointments: 'Finding their appointments',
  reschedule_appointment: 'Moving the appointment',
  cancel_appointment: 'Cancelling',
  join_waitlist: 'Adding to the waitlist',
  search_knowledge: 'Checking what the practice says',
  escalate_to_human: 'Flagging it for the practice',
  record_note: 'Leaving a note',
}

interface Props {
  turns: Turn[]
  /** Tool results and practice events, placed by time among the turns. */
  cards?: InlineCard[]
  startedAt: number | null
  /** True between the caller finishing and the reply's first word. */
  thinking?: boolean
}

export function Transcript({ turns, cards = [], startedAt, thinking = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  /**
   * Follow the newest line by scrolling this column only.
   *
   * `scrollIntoView` scrolls every ancestor too, the page included. On desktop
   * the page cannot scroll so it made no difference, but on a phone the panel
   * sits below the call — and this runs on every word revealed, so anyone who
   * scrolled down to read a booking was dragged back up several times a second.
   */
  useEffect(() => {
    const el = scrollRef.current
    el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [turns, cards, thinking])

  // Interleaved by when each happened. The sort is stable, so turns that share
  // a timestamp keep the order they arrived in.
  const items = [
    ...turns.map((t) => ({ at: t.at, turn: t })),
    ...cards
      .filter((c) => c.kind !== 'tool' || !CARDED.has(c.name))
      .map((c) => ({ at: c.at, card: c })),
  ].sort((a, b) => a.at - b.at)

  return (
    <div ref={scrollRef} style={s.scroll}>
      {items.map((item) =>
        'turn' in item && item.turn ? (
          <Row key={item.turn.id} turn={item.turn} startedAt={startedAt} />
        ) : 'card' in item && item.card ? (
          <Card key={`${item.card.kind}-${item.card.id}`} card={item.card} />
        ) : null,
      )}
      {thinking && <Thinking />}
    </div>
  )
}

function Card({ card }: { card: InlineCard }) {
  switch (card.kind) {
    case 'tool':
      return <ToolCard card={card} />
    case 'booked':
      return (
        <div className="tx-card-row is-desk tx-in">
          <div className="tx-card tx-booked" role="status">
            <span className="tx-tick" aria-hidden>
              ✓
            </span>
            <div className="tx-booked-body">
              <span className="tx-card-k">Booked</span>
              <p className="tx-booked-line">
                {[card.patient, card.doctor, card.start ? clockOf(card.start) : card.when]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <span className="tx-card-sub">
                {[card.service, card.start ? dayOf(card.start) : null].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
        </div>
      )
    case 'triage':
      return (
        <div className="tx-card-row tx-in">
          <div className={`tx-card tx-triage is-${card.band}`} role="alert">
            <span className="tx-card-k">
              {card.band === 'red' ? 'Emergency — clinic alerted' : 'Urgent — flagged for the doctor'}
            </span>
            <p>{card.reason}</p>
          </div>
        </div>
      )
    case 'patient':
      return (
        <div className="tx-card-row tx-in">
          <span className="tx-chip is-done">
            <span aria-hidden>{card.isNew ? '+' : '✓'}</span>
            {card.isNew ? 'New patient' : 'Caller identified'}
            {card.name ? ` · ${card.name}` : ''}
            {!card.isNew && card.upcoming ? ` · ${card.upcoming} upcoming` : ''}
          </span>
        </div>
      )
  }
}

/**
 * A lookup, as it runs.
 *
 * A pending chip while the tool is out, so the pause in the conversation has a
 * visible reason; the diary check then opens into the slots it found.
 */
function ToolCard({ card }: { card: Extract<InlineCard, { kind: 'tool' }> }) {
  const done = card.ms !== undefined
  const result = (card.result ?? {}) as {
    service?: string
    durationMin?: number
    slots?: Array<{ slotStart: string; doctor?: string; when?: string }>
  }

  if (card.name === 'check_availability' && done && result.slots && result.slots.length > 0) {
    return (
      <div className="tx-card-row is-desk tx-in">
        <div className="tx-card tx-slots">
          <div className="tx-card-head">
            <span className="tx-card-k">Open in the diary</span>
            <span className="tx-ms mono">{Math.round(card.ms!)} ms</span>
          </div>
          <span className="tx-card-sub">
            {[result.service, result.durationMin ? `${result.durationMin} min` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <ul className="tx-slot-grid">
            {result.slots.slice(0, 4).map((slot) => (
              <li key={slot.slotStart + (slot.doctor ?? '')} className="tx-slot">
                <span className="tx-slot-day">{dayOf(slot.slotStart)}</span>
                <strong className="tx-slot-time">{clockOf(slot.slotStart)}</strong>
                {slot.doctor && <span className="tx-slot-doc">{slot.doctor}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  const label = TOOL_LABEL[card.name] ?? card.name.replace(/_/g, ' ')
  const detail =
    card.name === 'check_availability'
      ? String(card.args.service ?? '')
      : card.name === 'search_knowledge'
        ? String(card.args.query ?? '')
        : ''
  const nothing = card.name === 'check_availability' && done && result.slots?.length === 0

  return (
    <div className="tx-card-row tx-in">
      <span className={`tx-chip${done ? ' is-done' : ''}${card.ok === false || nothing ? ' is-bad' : ''}`}>
        {done ? <span aria-hidden>{card.ok === false ? '!' : '✓'}</span> : <i className="tx-spin" aria-hidden />}
        {nothing ? 'Nothing open — waitlist offered' : label}
        {detail && !nothing ? ` · ${detail}` : ''}
        {done && <em className="mono">{Math.round(card.ms!)} ms</em>}
      </span>
    </div>
  )
}

function dayOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

function clockOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

/**
 * The pause before the reply.
 *
 * Voice has no equivalent of watching someone type, so a caller who has just
 * finished speaking has nothing to tell them they were heard. This is the one
 * moment in the call where showing that something is happening matters more
 * than showing what.
 */
function Thinking() {
  return (
    <div style={{ ...s.row, alignItems: 'flex-end' }} aria-live="polite">
      <div style={s.meta}>
        <span style={{ ...s.who, color: 'var(--agent)' }}>Front desk</span>
      </div>
      <div
        className="tx-in"
        style={{
          ...s.bubble,
          ...s.thinking,
          background: 'var(--agent-soft)',
          borderColor: 'var(--agent-line)',
          borderRadius: '14px 4px 14px 14px',
        }}
      >
        <span className="sr-only">Thinking</span>
        <i className="tx-dot" aria-hidden />
        <i className="tx-dot" aria-hidden />
        <i className="tx-dot" aria-hidden />
      </div>
    </div>
  )
}

function Row({ turn, startedAt }: { turn: Turn; startedAt: number | null }) {
  const caller = turn.speaker === 'caller'
  // The `lang` attribute picks the face; no per-script classes to maintain.
  const indic = scriptOf(turn.lang) !== 'latin'

  return (
    <div style={{ ...s.row, alignItems: caller ? 'flex-start' : 'flex-end' }}>
      <div style={s.meta}>
        <span style={{ ...s.who, color: caller ? 'var(--caller)' : 'var(--agent)' }}>
          {caller ? 'Caller' : 'Front desk'}
        </span>
        <span className="mono" style={s.time}>
          {timecode(turn.at, startedAt)}
        </span>
        {turn.lang !== 'en-IN' && (
          <span className="mono" style={s.chip}>
            {LANG_CHIP[turn.lang]}
          </span>
        )}
      </div>

      <div
        className="tx-in"
        lang={htmlLang(turn.lang)}
        style={{
          ...s.bubble,
          background: caller ? 'var(--caller-soft)' : 'var(--agent-soft)',
          borderColor: caller ? 'var(--caller-line)' : 'var(--agent-line)',
          borderRadius: caller ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
          fontFamily: indic ? 'inherit' : caller ? 'var(--font-ui)' : 'var(--font-display)',
          fontSize: caller ? 15.5 : 17,
          opacity: turn.interim ? 0.62 : 1,
          textAlign: caller ? 'left' : 'right',
        }}
      >
        {caller ? (
          <>
            {turn.text}
            {turn.interim && <Caret />}
          </>
        ) : (
          (turn.utterances ?? []).map((u, i) => (
            <Spoken key={u.id} utterance={u} first={i === 0} />
          ))
        )}
      </div>
    </div>
  )
}

/**
 * One synthesised utterance, revealed word by word against playback.
 *
 * Falls back to showing everything once the utterance has finished, so a
 * missing or approximate mark can never leave text permanently hidden.
 */
function Spoken({ utterance, first }: { utterance: Utterance; first: boolean }) {
  const { text, marks, playedMs, unspoken } = utterance
  const finished = playedMs === Number.POSITIVE_INFINITY

  const words = marks.length > 0 ? marks : null

  return (
    <>
      {!first && ' '}
      {words
        ? words.map((m, i) => {
            const heard = finished || m.endMs <= playedMs
            return (
              <span
                key={`${m.word}-${i}`}
                style={{
                  opacity: heard ? 1 : 0.22,
                  transition: 'opacity 160ms ease',
                }}
              >
                {i > 0 ? ' ' : ''}
                {m.word}
              </span>
            )
          })
        : text}
      {unspoken ? (
        <span style={s.unspoken} title="Generated but never reached the caller">
          {' '}
          {unspoken}
        </span>
      ) : null}
    </>
  )
}

function Caret() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 2,
        height: '0.95em',
        marginLeft: 3,
        verticalAlign: '-0.1em',
        background: 'var(--caller)',
        animation: 'blink 1s step-end infinite',
      }}
    />
  )
}

function timecode(at: number, start: number | null): string {
  if (!start) return '0:00'
  const sec = Math.max(0, Math.floor((at - start) / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const s: Record<string, React.CSSProperties> = {
  scroll: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    padding: '8px 4px 32px',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    maxWidth: '78%',
    animation: 'rise 260ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  meta: { display: 'flex', alignItems: 'center', gap: 9 },
  who: { fontSize: 11.5, fontWeight: 600, letterSpacing: '0.01em' },
  time: { fontSize: 10, color: 'var(--ink-faint)' },
  chip: {
    fontSize: 9,
    color: 'var(--ink-muted)',
    background: 'var(--bg-tint)',
    border: '1px solid var(--hairline)',
    borderRadius: 'var(--r-pill)',
    padding: '1px 7px',
  },
  bubble: {
    border: '1px solid',
    padding: '11px 15px',
    lineHeight: 1.5,
    boxShadow: 'var(--shadow-sm)',
  },
  thinking: {
    display: 'flex',
    gap: 5,
    alignItems: 'center',
    padding: '14px 16px',
  },
  unspoken: {
    textDecoration: 'line-through',
    textDecorationColor: 'var(--alert)',
    color: 'var(--ink-faint)',
    opacity: 0.5,
  },
}
