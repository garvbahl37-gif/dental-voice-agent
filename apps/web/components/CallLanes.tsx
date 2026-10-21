'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './call-lanes.css'

/**
 * A call, drawn as the two voices in it.
 *
 * After Eugen Eşanu's call-transcript study: a lane per speaker on one
 * timeline, a playhead you can drag, and the timestamped turns underneath. Its
 * purple and green are this product's two channels — slate for the caller,
 * turmeric for the desk — so the colours already mean who is speaking.
 *
 * The lanes earn their place on a product built around being interrupted.
 * A transcript reads as tidy alternation even when two people talked at once;
 * here a barge-in is visible as both lanes filled at the same moment, marked,
 * and counted.
 *
 * There is no recording behind the playhead. Moving it picks out what was
 * being said at that moment, which is the part of scrubbing a transcript needs.
 */

export interface LaneTurn {
  id: string
  who: 'caller' | 'desk'
  /** Milliseconds from the start of the call. */
  start: number
  end: number
  text: string
  lang?: string
  /** The desk was talked over and stopped. */
  cut?: boolean
}

interface Props {
  turns: LaneTurn[]
  /** The call's length in ms — the full width of the lanes. */
  duration: number
  /** Lengths were inferred from the words rather than measured. Said under the lanes. */
  estimated?: boolean
}

/** Less than this is two people breathing near each other, not a barge-in. */
const OVERLAP_MS = 250

export function CallLanes({ turns, duration, estimated = false }: Props) {
  const total = Math.max(duration, ...turns.map((t) => t.end), 1)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLOListElement>(null)
  const dragging = useRef(false)

  /** Where both voices were going at once. */
  const overlaps = useMemo(() => {
    const out: Array<{ start: number; end: number; desk: string }> = []
    for (const c of turns.filter((x) => x.who === 'caller')) {
      for (const d of turns.filter((x) => x.who === 'desk')) {
        const start = Math.max(c.start, d.start)
        const end = Math.min(c.end, d.end)
        if (end - start >= OVERLAP_MS) out.push({ start, end, desk: d.id })
      }
    }
    return out
  }, [turns])

  // A reply that was cut off counts even when the overlap was too short to
  // draw; a reply talked over twice still counts once.
  const interruptions = new Set([
    ...overlaps.map((o) => o.desk),
    ...turns.filter((x) => x.cut).map((x) => x.id),
  ]).size

  // What was being said at the playhead: the turn covering it, or failing
  // that the last one to have started.
  const active =
    [...turns].reverse().find((x) => x.start <= t && t <= x.end) ??
    [...turns].reverse().find((x) => x.start <= t)

  const seek = useCallback(
    (ms: number) => setT(Math.min(total, Math.max(0, ms))),
    [total],
  )

  const fromPointer = useCallback(
    (clientX: number) => {
      const el = track.current
      if (!el) return
      const r = el.getBoundingClientRect()
      seek(((clientX - r.left) / r.width) * total)
    },
    [seek, total],
  )

  // Replay at twice the speed of the call: slow enough to follow the
  // turn-taking, quick enough that a three-minute call is worth watching.
  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      const dt = (now - last) * 2
      last = now
      setT((prev) => {
        const next = prev + dt
        if (next >= total) {
          setPlaying(false)
          return total
        }
        return next
      })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, total])

  // Keep the turn being said in view — scrolling the list only, never the
  // page, which on a phone would drag the reader away from the lanes.
  useEffect(() => {
    const el = list.current
    const item = active ? el?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(active.id)}"]`) : null
    if (!el || !item || el.scrollHeight <= el.clientHeight) return
    const top = item.offsetTop - el.offsetTop - 12
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - item.offsetHeight) {
      el.scrollTo({ top, behavior: 'smooth' })
    }
  }, [active])

  const pct = (ms: number) => `${(ms / total) * 100}%`

  if (turns.length === 0) return null

  return (
    <section className="ln" aria-label="The call, by speaker">
      <div className="ln-bar">
        <button
          type="button"
          className="ln-play"
          onClick={() => {
            if (!playing && t >= total) setT(0)
            setPlaying((p) => !p)
          }}
          aria-label={playing ? 'Pause the replay' : 'Replay the call'}
        >
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <span className="ln-clock mono">
          <b>{clock(t)}</b> / {clock(total)}
        </span>
        <span className={`ln-cuts${interruptions > 0 ? ' has' : ''}`}>
          {interruptions === 0
            ? 'No interruptions'
            : `${interruptions} ${interruptions === 1 ? 'interruption' : 'interruptions'}`}
        </span>
      </div>

      <div
        ref={track}
        className="ln-track"
        role="slider"
        tabIndex={0}
        aria-label="Position in the call"
        aria-valuemin={0}
        aria-valuemax={Math.round(total / 1000)}
        aria-valuenow={Math.round(t / 1000)}
        aria-valuetext={`${clock(t)} of ${clock(total)}`}
        onPointerDown={(e) => {
          dragging.current = true
          setPlaying(false)
          e.currentTarget.setPointerCapture(e.pointerId)
          fromPointer(e.clientX)
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10_000 : 2_000
          const to =
            e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? t + step
              : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                ? t - step
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? total
                    : null
          if (to === null) return
          e.preventDefault()
          setPlaying(false)
          seek(to)
        }}
      >
        <div className="ln-scrub">
          <span className="ln-scrub-fill" style={{ width: pct(t) }} />
        </div>

        {(['caller', 'desk'] as const).map((who) => (
          <div key={who} className={`ln-lane is-${who}`}>
            <span className="ln-who">{who === 'caller' ? 'Caller' : 'Front desk'}</span>
            <div className="ln-rail">
              {turns
                .filter((x) => x.who === who)
                .map((x) => (
                  <span
                    key={x.id}
                    className={`ln-seg${active?.id === x.id ? ' is-on' : ''}${x.cut ? ' is-cut' : ''}`}
                    style={{ left: pct(x.start), width: `max(6px, ${pct(x.end - x.start)})` }}
                  />
                ))}
              {overlaps.map((o, i) => (
                <span key={i} className="ln-x" style={{ left: pct(o.start), width: `max(4px, ${pct(o.end - o.start)})` }} />
              ))}
            </div>
          </div>
        ))}

        <div className="ln-head" style={{ left: pct(t) }} aria-hidden>
          <span className="ln-head-time mono">{clock(t)}</span>
        </div>
      </div>

      {estimated && (
        <p className="ln-note">
          Each turn starts where it was logged; its length is read from how much was said.
        </p>
      )}

      <ol className="ln-turns" ref={list}>
        {turns.map((x) => (
          <li key={x.id} data-turn={x.id}>
            <button
              type="button"
              className={`ln-turn is-${x.who}${active?.id === x.id ? ' is-on' : ''}`}
              onClick={() => {
                setPlaying(false)
                seek(x.start)
              }}
            >
              <span className="ln-turn-head">
                <span className="ln-turn-who">{x.who === 'caller' ? 'Caller' : 'Front desk'}</span>
                {x.cut && <span className="ln-turn-cut">talked over</span>}
                <span className="ln-turn-at mono">[{clock(x.start)}]</span>
              </span>
              <span className="ln-turn-text" lang={x.lang}>
                {x.text}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * A rough length for a turn nobody timed.
 *
 * About fourteen characters a second is ordinary speech across the scripts
 * this desk handles; the floor keeps a "yes" from vanishing to a hairline.
 */
export function spokenMs(text: string): number {
  return Math.min(20_000, Math.max(900, text.trim().length * 70))
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function PlayGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <rect x="2.5" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
      <rect x="7.1" y="2" width="2.4" height="8" rx="0.8" fill="currentColor" />
    </svg>
  )
}
