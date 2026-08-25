'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The refusals, demonstrated rather than listed.
 *
 * A list of five rules asks to be believed. Five exchanges — the caller
 * pushing, the desk declining and offering the thing it *can* do — show the
 * same rules being enforced, which is the only version of this a practice has
 * reason to trust. Every reply below is the shape the guard actually produces:
 * a refusal never ends on the refusal, it ends on an offer.
 *
 * It cycles on its own so a reader who does nothing still sees more than one,
 * and stops the moment anyone takes over — an auto-advancing thing that fights
 * the person using it is worse than one that never moved.
 */

interface Refusal {
  id: string
  /** The struck word, and what follows it. */
  verb: string
  rest: string
  /** What a caller actually says to push on this rule. */
  ask: string
  askLang?: string
  /** What comes back. */
  reply: string
  /** The line under the exchange — why the rule exists. */
  because: string
}

const REFUSALS: Refusal[] = [
  {
    id: 'diagnose',
    verb: 'Diagnose',
    rest: 'anything',
    ask: 'Is this a cavity or just sensitivity?',
    reply:
      'I can’t tell you that — it needs someone to look at it. Dr. Mehta has 11:30 on Thursday at Andheri. Shall I hold it?',
    because: 'It does not speculate about a mouth it cannot see.',
  },
  {
    id: 'prescribe',
    verb: 'Prescribe',
    rest: 'or advise on medicine',
    ask: 'Koi painkiller bata do na, bahut dard ho raha hai.',
    askLang: 'hi-Latn',
    reply:
      'Main dawai nahi bata sakti. Par aaj hi dikha sakte hain — ya agar wait nahi kar sakta, toh emergency line de deti hoon.',
    because:
      'Not for a patient who insists, and not in Hindi when the same question comes back rephrased.',
  },
  {
    id: 'price',
    verb: 'Invent',
    rest: 'a price',
    ask: 'Roughly what does a root canal come to?',
    reply:
      'That one isn’t on the list I have, so I won’t guess at it. Dr. Nair’s office can call you back with the figure today.',
    because: 'A quoted number a patient repeats at the counter is worse than no number at all.',
  },
  {
    id: 'availability',
    verb: 'Guess',
    rest: 'at availability',
    ask: 'Saturday morning is free, right?',
    reply:
      'Let me check rather than tell you wrong… Saturday’s full at Bandra. There’s 11:30 at Andheri, or Monday evening here.',
    because: 'It would rather take a beat than fill silence with a slot that turns out to be taken.',
  },
  {
    id: 'person',
    verb: 'Pretend',
    rest: 'to be a person',
    ask: 'Wait — am I talking to a real person?',
    reply:
      'No, I’m the practice’s assistant. I can put you through to reception if you’d rather speak to someone.',
    because: 'It has no name and does not perform one.',
  },
]

const DWELL = 7200

export function Refusals() {
  const [at, setAt] = useState(0)
  const [held, setHold] = useState(false)
  const tabs = useRef<HTMLDivElement>(null)
  const current = REFUSALS[at]!

  // Only runs while the section is on screen: a timer advancing a panel nobody
  // is looking at wakes the tab up for nothing.
  const [seen, setSeen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setSeen(Boolean(e?.isIntersecting)), {
      threshold: 0.25,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (held || !seen) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setAt((i) => (i + 1) % REFUSALS.length), DWELL)
    return () => clearTimeout(t)
  }, [at, held, seen])

  /** Arrow keys move between rules, as they would in any tab strip. */
  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const step =
        e.key === 'ArrowDown' || e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
            ? -1
            : 0
      if (!step) return
      e.preventDefault()
      setHold(true)
      const next = (at + step + REFUSALS.length) % REFUSALS.length
      setAt(next)
      // Focus follows selection, which is what a tab strip is expected to do.
      requestAnimationFrame(() => {
        tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      })
    },
    [at],
  )

  return (
    <div className="lp-ref" ref={root} onMouseEnter={() => setHold(true)} onFocusCapture={() => setHold(true)}>
      <div className="lp-ref-list" role="tablist" aria-label="What it will not do" ref={tabs} onKeyDown={onKey}>
        {REFUSALS.map((r, i) => (
          <button
            key={r.id}
            role="tab"
            id={`ref-tab-${r.id}`}
            aria-selected={i === at}
            aria-controls={`ref-panel-${r.id}`}
            tabIndex={i === at ? 0 : -1}
            className={`lp-ref-tab${i === at ? ' is-on' : ''}`}
            onClick={() => {
              setHold(true)
              setAt(i)
            }}
          >
            <span className="lp-ref-verb">{r.verb}</span>
            <span className="lp-ref-rest">{r.rest}</span>
            {/* The bar is the dwell timer made visible, so the panel changing
                under a reader is never a surprise. */}
            <span className="lp-ref-tick" aria-hidden>
              <span
                className="lp-ref-tick-fill"
                style={{ animationDuration: `${DWELL}ms`, animationPlayState: i === at && !held && seen ? 'running' : 'paused' }}
              />
            </span>
          </button>
        ))}
      </div>

      <div
        className="lp-ref-panel"
        role="tabpanel"
        id={`ref-panel-${current.id}`}
        aria-labelledby={`ref-tab-${current.id}`}
        /* Keyed so the exchange replays on every change rather than swapping
           text inside a panel that never moves. */
        key={current.id}
      >
        <div className="lp-ref-head">
          <span className="lp-ref-dot" aria-hidden />
          Caller pushes
        </div>

        <p className="lp-ref-ask" lang={current.askLang}>
          {current.ask}
        </p>

        <div className="lp-ref-reply">
          <span className="lp-ref-who">Front desk</span>
          <p lang={current.askLang}>{current.reply}</p>
        </div>

        <p className="lp-ref-because">{current.because}</p>
      </div>
    </div>
  )
}
