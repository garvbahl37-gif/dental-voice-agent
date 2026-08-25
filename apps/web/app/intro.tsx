'use client'

import { useEffect, useRef, useState } from 'react'
import { htmlLang, type Lang } from '@vaani/shared'

/**
 * The opening.
 *
 * A loading screen has to earn the time it takes, so this one is the product's
 * own claim compressed into two seconds: a line opens, and the same greeting
 * arrives in eleven scripts, one after another, faster than a person could
 * read them — which is the point. It resolves on the name.
 *
 * Three rules it keeps:
 *
 * It never blocks. The page behind it is fully rendered and interactive
 * underneath; this is a curtain, not a gate, and it lifts on a timer that
 * cannot hang. A loading screen that can trap someone is worse than none.
 *
 * It plays once. A curtain on every navigation is a toll, so a flag in
 * sessionStorage means a reader who came back from /console does not sit
 * through it again.
 *
 * It respects the request not to move: with reduced motion it never mounts.
 */

const GREETING: Array<{ lang: Lang; text: string }> = [
  { lang: 'en-IN', text: 'Good morning' },
  { lang: 'hi-IN', text: 'नमस्ते' },
  { lang: 'mr-IN', text: 'नमस्कार' },
  { lang: 'gu-IN', text: 'નમસ્તે' },
  { lang: 'bn-IN', text: 'নমস্কার' },
  { lang: 'ta-IN', text: 'வணக்கம்' },
  { lang: 'te-IN', text: 'నమస్కారం' },
  { lang: 'kn-IN', text: 'ನಮಸ್ಕಾರ' },
  { lang: 'ml-IN', text: 'നമസ്കാരം' },
  { lang: 'pa-IN', text: 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ' },
]

const STEP = 132
const SETTLE = 620

/** Bars for the meter that runs under the greeting — fixed, so SSR matches. */
const BARS = Array.from({ length: 28 }, (_, i) => 22 + ((i * 37) % 58))

/**
 * Whether the curtain runs, decided once per page load.
 *
 * Held outside the component so React's development double-mount asks and
 * answers the same question both times — a check that writes state on the
 * first pass and reads it back on the second disagrees with itself, and the
 * curtain never appeared.
 */
let decision: boolean | null = null

function shouldPlay(): boolean {
  if (decision !== null) return decision
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    decision = false
    return decision
  }
  let seen = false
  try {
    seen = sessionStorage.getItem('vaani-intro') === 'seen'
  } catch {
    // Storage disabled. Play it; a second showing beats never showing.
  }
  decision = !seen
  return decision
}

export function Intro() {
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (!shouldPlay()) return
    setOn(true)

    const push = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))

    for (let i = 1; i < GREETING.length; i++) push(() => setAt(i), i * STEP)
    const runFor = GREETING.length * STEP
    push(() => setLeaving(true), runFor + SETTLE)
    push(() => {
      setOn(false)
      // Marked as seen only once it has actually played. Writing the flag up
      // front meant React's development double-mount wrote it on the first
      // pass and then bailed on the second — after the remount had already
      // reset the state — so it never appeared at all.
      try {
        sessionStorage.setItem('vaani-intro', 'seen')
      } catch {
        /* private mode; showing it once more is the smaller failure */
      }
    }, runFor + SETTLE + 620)

    return () => {
      for (const t of timers.current) clearTimeout(t)
      timers.current = []
    }
  }, [])

  // The page underneath must not scroll while the curtain is down, or a reader
  // arrives already halfway through it.
  useEffect(() => {
    if (!on) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [on])

  if (!on) return null
  const now = GREETING[at]!

  return (
    <div className={`lp-intro${leaving ? ' is-leaving' : ''}`} aria-hidden>
      <div className="lp-intro-inner">
        <div className="lp-intro-meter" aria-hidden>
          {BARS.map((h, i) => (
            <span
              key={i}
              className="lp-intro-bar"
              style={{ '--h': `${h}%`, '--i': i } as React.CSSProperties}
            />
          ))}
        </div>

        <div className="lp-intro-say">
          {/* Keyed, so each script replaces the last rather than the text
              mutating inside one node. */}
          <span key={at} className="lp-intro-word" lang={htmlLang(now.lang)}>
            {now.text}
          </span>
        </div>

        <div className="lp-intro-rule">
          <span className="lp-intro-rule-fill" />
        </div>

        <p className="lp-intro-mark">
          <span className="lp-intro-name">Vaani</span>
          <span className="lp-intro-sub">a front desk that answers in eleven languages</span>
        </p>
      </div>
    </div>
  )
}
