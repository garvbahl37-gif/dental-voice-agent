'use client'

import { useEffect, useRef } from 'react'
import type { Lang, WordMark } from '@vaani/shared'

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
  /** Caller turns carry a single text; the desk's may be several utterances. */
  text?: string
  utterances?: Utterance[]
  interim?: boolean
}

interface Props {
  turns: Turn[]
  startedAt: number | null
}

export function Transcript({ turns, startedAt }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns])

  return (
    <div style={s.scroll}>
      {turns.map((turn) => (
        <Row key={turn.id} turn={turn} startedAt={startedAt} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function Row({ turn, startedAt }: { turn: Turn; startedAt: number | null }) {
  const caller = turn.speaker === 'caller'
  const deva = turn.lang === 'hi-IN'

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
            {turn.lang === 'hi-IN' ? 'हिन्दी' : 'Hinglish'}
          </span>
        )}
      </div>

      <div
        className={deva ? 'deva' : undefined}
        lang={deva ? 'hi' : 'en'}
        style={{
          ...s.bubble,
          background: caller ? 'var(--caller-soft)' : 'var(--agent-soft)',
          borderColor: caller ? 'var(--caller-line)' : 'var(--agent-line)',
          borderRadius: caller ? '4px 14px 14px 14px' : '14px 4px 14px 14px',
          fontFamily: caller ? 'var(--font-ui)' : 'var(--font-display)',
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
  unspoken: {
    textDecoration: 'line-through',
    textDecorationColor: 'var(--alert)',
    color: 'var(--ink-faint)',
    opacity: 0.5,
  },
}
