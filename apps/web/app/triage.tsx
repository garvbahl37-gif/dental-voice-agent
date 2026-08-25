'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The emergency path, shown as the call it actually is.
 *
 * This is the highest-stakes thing the desk does — the moment it stops being a
 * booking tool — so it gets the page's only device mockup and the only section
 * a visitor can drive. Pick what the caller says and watch the whole path run:
 * recognised, booking stopped, the branch's line given, a human flagged, and
 * the words the caller actually hears while they are still on the phone.
 *
 * The replies are the shape the triage scripts produce: the number first,
 * because that is the part that matters if the call drops, then what to do in
 * the meantime, in the language it was asked in.
 */

interface Case {
  id: string
  chip: string
  said: string
  lang?: string
  reply: string
  band: 'red' | 'amber'
}

const CASES: Case[] = [
  {
    id: 'bleeding',
    chip: 'Bleeding',
    said: 'Bleeding won’t stop after the extraction',
    reply:
      'Take this down — 022 2655 1200, that’s Bandra’s emergency line. Bite firmly on clean gauze for ten minutes, don’t rinse. Someone is being told now.',
    band: 'red',
  },
  {
    id: 'knocked',
    chip: 'Knocked-out tooth',
    said: 'दाँत टूट गया है, बहुत खून बह रहा है',
    lang: 'hi',
    reply:
      'नंबर लिख लीजिए — 022 2655 1200. दाँत को दूध में रखिए, जड़ को मत छुइए, और सीधे आ जाइए। मैं अभी बता रही हूँ।',
    band: 'red',
  },
  {
    id: 'pain',
    chip: 'Pain, no sleep',
    said: 'Bahut tez dard, so nahi paa raha',
    lang: 'hi-Latn',
    reply:
      'Aaj hi dikhana chahiye. 022 2655 1200 par emergency line hai. Main dawai nahi bata sakti — par abhi ke liye thandi sikai kar sakte hain.',
    band: 'red',
  },
  {
    id: 'swelling',
    chip: 'Swelling with fever',
    said: 'चेहरा सूज गया है और बुखार है',
    lang: 'hi',
    reply:
      'यह इंतज़ार नहीं कर सकता — 022 2655 1200. सूजन के साथ बुखार का मतलब है आज ही दिखाना होगा। मैं डॉक्टर को बता रही हूँ।',
    band: 'red',
  },
]

const STEPS = [
  { k: 'Heard', v: 'in whichever language it came in' },
  { k: 'Recognised', v: 'matched to the red band, not a keyword' },
  { k: 'Booking stops', v: 'mid-sentence, if it has to' },
  { k: 'Line given', v: 'the branch’s own emergency number' },
  { k: 'Flagged', v: 'a human sees it before the call drops' },
]

const STEP_MS = 620
const HOLD_MS = 4200

export function Triage() {
  const [at, setAt] = useState(0)
  const [step, setStep] = useState(-1)
  const [live, setLive] = useState(false)
  const [held, setHold] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Nothing runs off-screen: a five-step timer ticking away where nobody is
  // looking is pure battery.
  useEffect(() => {
    const el = root.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setLive(Boolean(e?.isIntersecting)), {
      threshold: 0.25,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!live) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStep(STEPS.length - 1)
      return
    }
    if (step < STEPS.length - 1) {
      const t = setTimeout(() => setStep((s) => s + 1), step < 0 ? 380 : STEP_MS)
      return () => clearTimeout(t)
    }
    // Once someone has picked a case themselves, it stops moving on its own.
    if (held) return
    const t = setTimeout(() => {
      setAt((i) => (i + 1) % CASES.length)
      setStep(-1)
    }, HOLD_MS)
    return () => clearTimeout(t)
  }, [live, step, held])

  const choose = useCallback((i: number) => {
    setHold(true)
    setAt(i)
    setStep(-1)
  }, [])

  const now = CASES[at]!
  const done = step >= STEPS.length - 1

  return (
    <div className="lp-tri" ref={root}>
      {/* What the caller says. Buttons, because picking one changes the call. */}
      <div className="lp-tri-pick" role="group" aria-label="Try an emergency">
        <span className="lp-tri-pick-k">A caller says</span>
        {CASES.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`lp-tri-chip${i === at ? ' is-on' : ''}`}
            onClick={() => choose(i)}
            aria-pressed={i === at}
          >
            {c.chip}
          </button>
        ))}
      </div>

      {/* The handset. One device on the page, and it is this one. */}
      <div className="lp-tri-phone">
        <div className="lp-tri-screen">
          <div className="lp-tri-bar">
            <span className={`lp-tri-band lp-band-${now.band}`}>
              <span className="lp-tri-ring" aria-hidden />
              {now.band === 'red' ? 'Emergency' : 'Urgent'}
            </span>
            <span className="lp-tri-clock mono">live</span>
          </div>

          <div className="lp-tri-thread" key={now.id}>
            <p className="lp-tri-said" lang={now.lang}>
              {now.said}
            </p>

            {/* The reply lands only once the path has run — the pause is the
                product working, not the page being slow. */}
            <div className={`lp-tri-reply${done ? ' is-in' : ''}`}>
              <span className="lp-tri-who">Front desk</span>
              <p lang={now.lang}>{now.reply}</p>
            </div>
          </div>
        </div>
      </div>

      <ol className="lp-tri-steps" aria-label="What happens">
        {STEPS.map((s, i) => (
          <li
            key={s.k}
            className={`lp-tri-step${i <= step ? ' is-done' : ''}${i === step ? ' is-now' : ''}`}
          >
            <span className="lp-tri-mark" aria-hidden />
            <span className="lp-tri-k">{s.k}</span>
            <span className="lp-tri-v">{s.v}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
