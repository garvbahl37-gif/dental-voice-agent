'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * What happens when a caller says something that cannot wait.
 *
 * The trigger words were listed as chips, which showed the vocabulary and none
 * of the behaviour — and the behaviour is the whole claim. This plays the
 * sequence instead: the phrase arrives, it is recognised, booking stops, the
 * emergency line goes out, a human is flagged. Five steps, in the order they
 * actually fire, so a practice can see where their patient ends up.
 *
 * The phrases cycle through the three registers a Mumbai front desk hears,
 * because an emergency does not arrive in the language you built for.
 */

const HEARD = [
  { text: 'Bleeding won’t stop after the extraction', lang: undefined },
  { text: 'दाँत टूट गया है, बहुत खून बह रहा है', lang: 'hi' },
  { text: 'Bahut tez dard, so nahi paa raha', lang: 'hi-Latn' },
  { text: 'चेहरा सूज गया है और बुखार है', lang: 'hi' },
  { text: 'Knocked-out tooth — my son fell', lang: undefined },
]

const STEPS = [
  { k: 'Heard', v: 'The words, in whichever language they came in' },
  { k: 'Recognised', v: 'Matched against the red band, not a keyword list' },
  { k: 'Booking stops', v: 'It stops offering slots mid-sentence' },
  { k: 'Emergency line', v: 'The branch’s own number, read out and repeated' },
  { k: 'Flagged', v: 'A human sees it before the line even drops' },
]

const STEP_MS = 780
const HOLD_MS = 2600

export function Triage() {
  const [phrase, setPhrase] = useState(0)
  const [step, setStep] = useState(-1)
  const [live, setLive] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Nothing runs until it is on screen, and nothing keeps running once it is
  // not — a five-step timer ticking away off-screen is pure battery.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setLive(Boolean(e?.isIntersecting)), {
      threshold: 0.3,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!live) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Still and complete, rather than mid-sequence and stuck.
      setStep(STEPS.length - 1)
      return
    }
    if (step < STEPS.length - 1) {
      const t = setTimeout(() => setStep((s) => s + 1), step < 0 ? 420 : STEP_MS)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setPhrase((p) => (p + 1) % HEARD.length)
      setStep(-1)
    }, HOLD_MS)
    return () => clearTimeout(t)
  }, [live, step])

  const said = HEARD[phrase]!

  return (
    <div className="lp-triage" ref={root}>
      <div className="lp-triage-line">
        <span className="lp-triage-tag" aria-hidden>
          <span className="lp-triage-ring" />
          incoming
        </span>
        {/* Keyed so each phrase arrives rather than the text swapping in place. */}
        <p className="lp-triage-said" key={phrase} lang={said.lang}>
          {said.text}
        </p>
      </div>

      <ol className="lp-triage-steps" aria-label="What happens next">
        {STEPS.map((s, i) => (
          <li
            key={s.k}
            className={`lp-triage-step${i <= step ? ' is-done' : ''}${i === step ? ' is-now' : ''}`}
          >
            <span className="lp-triage-mark" aria-hidden />
            <span className="lp-triage-k">{s.k}</span>
            <span className="lp-triage-v">{s.v}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
