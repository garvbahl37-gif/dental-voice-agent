'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { VoiceBlob } from '@/components/VoiceBlob'
import { Scene } from './home-sections'
import './how-it-works.css'

/**
 * How it works — one pinned showcase instead of three rows.
 *
 * The section holds still while it is scrolled through. On the left, three
 * steps, each with a rail along its top that fills with the scroll, the active
 * one opened to its sentence. On the right, one stage that cross-fades between
 * three scenes, each building itself in as its step arrives: a call ringing in
 * and answered, the diary checked and a slot booked, and the callback list
 * with an emergency already flagged.
 *
 * Every fact on the stage is one the code makes true — the first ring, the
 * diary checked before a time is offered and again as it is written, triage
 * by fixed rules, a brief with the number to ring. No invented figures.
 *
 * On a phone a pinned section fights the thumb, so the three steps stack,
 * each with its own scene, and build in as they are scrolled to.
 */

const STEPS = [
  {
    k: 'Answer',
    title: 'Your front desk, always answering.',
    body: 'Vaani picks up on the first ring, day or night, and answers in the caller’s language — English, Hindi, Hinglish and eight more.',
  },
  {
    k: 'Book',
    title: 'Turn calls into appointments.',
    body: 'It checks the real diary before offering a time, books while the caller listens, and writes up what was said.',
  },
  {
    k: 'Hand over',
    title: 'Keep people in charge of what matters.',
    body: 'Emergencies are triaged by fixed rules, not by the model, and anything it cannot answer lands with your team — with a brief and the number to ring.',
  },
]

export function HowItWorks() {
  const track = useRef<HTMLDivElement>(null)
  const [step, setStep] = useState(0)

  /**
   * The scroll through the pinned track, from 0 to 3.
   *
   * Written straight to a custom property, so the rails fill without React
   * rendering on every frame; state changes only when the step does.
   */
  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    const read = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const total = r.height - window.innerHeight
      if (total <= 0) return
      const p = Math.min(0.9999, Math.max(0, -r.top / total)) * STEPS.length
      el.style.setProperty('--p', p.toFixed(4))
      const s = Math.floor(p)
      setStep((prev) => (prev === s ? prev : s))
    }
    const queue = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
    }
  }, [])

  /** Clicking a step scrolls to just inside where that step begins. */
  const jump = useCallback((i: number) => {
    const el = track.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const total = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + total * ((i + 0.08) / STEPS.length), behavior: 'smooth' })
  }, [])

  return (
    <section id="how" className="hw">
      {/* ── Wide screens: pinned ─────────────────────────────────────────── */}
      <div className="hw-track" ref={track}>
        <div className="hw-sticky">
          <div className="hw-copy">
            <p className="mo-eyebrow">
              <i aria-hidden /> How it works
            </p>
            <h2 className="hw-title">A smarter way to handle every patient call.</h2>
            <ol className="hw-steps">
              {STEPS.map((s, i) => (
                <li
                  key={s.k}
                  className={`hw-step${i === step ? ' is-on' : ''}${i < step ? ' is-done' : ''}`}
                  style={{ '--s': i } as React.CSSProperties}
                >
                  <span className="hw-rail" aria-hidden>
                    <i />
                  </span>
                  <button className="hw-step-btn" onClick={() => jump(i)} aria-current={i === step ? 'step' : undefined}>
                    <span className="hw-num mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="hw-step-t">{s.title}</span>
                  </button>
                  <div className="hw-step-body">
                    <div>
                      <p>{s.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="hw-stage" data-step={step}>
            <Scene variant="room" />
            <span className="hw-glow" aria-hidden />
            <p className="hw-cap mono" aria-hidden>
              <span key={step}>
                {String(step + 1).padStart(2, '0')} · {STEPS[step]!.k}
              </span>
            </p>
            <Ring on={step === 0} />
            <Diary on={step === 1} />
            <Handover on={step === 2} />
            <ol className="hw-dots" aria-hidden>
              {STEPS.map((s, i) => (
                <li key={s.k} className={i === step ? 'is-on' : undefined} />
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* ── Phones: stacked ──────────────────────────────────────────────── */}
      <div className="hw-stack">
        <div className="mo-head">
          <p className="mo-eyebrow" data-reveal>
            <i aria-hidden /> How it works
          </p>
          <h2 data-reveal>
            <span className="mo-wipe">A smarter way to handle every patient call.</span>
          </h2>
        </div>
        {STEPS.map((s, i) => (
          <article key={s.k} className="hw-card" data-reveal>
            <p className="hw-card-k mono">
              {String(i + 1).padStart(2, '0')} · {s.k}
            </p>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="hw-stage is-small">
              <Scene variant="room" />
              <span className="hw-glow" aria-hidden />
              {i === 0 ? <Ring on /> : i === 1 ? <Diary on /> : <Handover on />}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

/* ── The three scenes ─────────────────────────────────────────────────────── */

const k = (n: number) => ({ '--k': n }) as React.CSSProperties

/** A call ringing in, answered on the first ring, the language turning. */
function Ring({ on }: { on: boolean }) {
  return (
    <div className={`hw-scene${on ? ' is-on' : ''}`} aria-hidden={!on}>
      <div className="hw-panel hw-ring">
        <p className="hw-incoming hw-a" style={k(0)}>
          <i /> Incoming call · +91 98200 11001
        </p>
        <div className="hw-ring-orb hw-a" style={k(1)}>
          <span className="hw-wave w1" />
          <span className="hw-wave w2" />
          <span className="hw-wave w3" />
          <div className="hw-orb">
            <VoiceBlob state={on ? 'speaking' : 'idle'} micLevel={0} agentLevel={on ? 0.3 : 0} spectrum={empty} live={false} />
          </div>
        </div>
        <p className="hw-ring-name hw-a" style={k(2)}>
          Vaani front desk
        </p>
        <p className="hw-ring-sub hw-a" style={k(2)}>
          Smile Dental Care · answering
        </p>
        <div className="hw-langs hw-a" style={k(3)}>
          {[
            ['English', 'en'],
            ['हिन्दी', 'hi'],
            ['Hinglish', 'en'],
            ['தமிழ்', 'ta'],
            ['मराठी', 'mr'],
          ].map(([l, lang], i) => (
            <span key={l} lang={lang} style={{ '--n': i } as React.CSSProperties}>
              {l}
            </span>
          ))}
        </div>
        <span className="hw-answer hw-a" style={k(4)}>
          <PhoneIcon />
        </span>
      </div>
      <span className="hw-chip c1 hw-a" style={k(5)}>
        <Dot /> Picked up on the first ring
      </span>
      <span className="hw-chip c2 hw-a" style={k(6)}>
        <Dot /> Eleven languages
      </span>
      <span className="hw-chip c3 hw-a" style={k(7)}>
        <Dot /> Day or night
      </span>
    </div>
  )
}

/** The ask, the diary's open slots, the pick, the booking confirmed. */
function Diary({ on }: { on: boolean }) {
  return (
    <div className={`hw-scene${on ? ' is-on' : ''}`} aria-hidden={!on}>
      <div className="hw-panel hw-diary">
        <div className="hw-bubble is-caller hw-a" style={k(0)}>
          <small>Caller · Hinglish</small>
          Kal shaam ko koi slot milega? Bandra.
        </div>
        <div className="hw-checking hw-a" style={k(1)}>
          <span className="hw-spin" /> Checking the Bandra diary
        </div>
        <div className="hw-slots hw-a" style={k(2)}>
          <p>Open tomorrow · Scaling &amp; polishing</p>
          <div>
            <span className="is-taken">5:30 pm</span>
            <span className="is-picked">6:15 pm</span>
            <span>7:00 pm</span>
          </div>
        </div>
        <div className="hw-bubble is-desk hw-a" style={k(3)}>
          <small>Front desk</small>
          Kal shaam sava chhe baje, Dr. Iyer ke saath. Book kar doon?
        </div>
        <div className="hw-booked hw-a" style={k(5)}>
          <span className="hw-tick" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          <span>
            <small>Booked</small>
            Ravi Menon · Dr. Iyer · 6:15 pm
          </span>
        </div>
      </div>
      <span className="hw-chip c1 hw-a" style={k(4)}>
        <Dot /> Checked before it is offered
      </span>
      <span className="hw-chip c2 hw-a" style={k(6)}>
        <Dot /> Checked again as it books
      </span>
    </div>
  )
}

/** The callback list: an emergency flagged, the brief, the number to ring. */
function Handover({ on }: { on: boolean }) {
  return (
    <div className={`hw-scene${on ? ' is-on' : ''}`} aria-hidden={!on}>
      <div className="hw-panel hw-hand">
        <header className="hw-hand-head hw-a" style={k(0)}>
          <span>Needs a human</span>
          <span className="hw-count">2</span>
        </header>
        <article className="hw-alert hw-a" style={k(1)}>
          <div className="hw-alert-top">
            <span className="hw-band">Emergency</span>
            <span className="hw-alerted">
              <i /> Top of the queue
            </span>
          </div>
          <h4>Facial swelling with fever</h4>
          <p className="hw-who">Aditya Rao · Hindi · just now</p>
          <p className="hw-brief">Booking stopped. Told to go to the emergency room, and put first in your team's queue.</p>
          <span className="hw-callback">
            <PhoneIcon /> Call back +91 98200 11003
          </span>
        </article>
        <article className="hw-normal hw-a" style={k(3)}>
          <div>
            <h4>Billing question it cannot answer</h4>
            <p className="hw-who">Vikram Shetty · Hinglish</p>
          </div>
          <span className="hw-tag">Normal</span>
        </article>
      </div>
      <span className="hw-chip c1 hw-a" style={k(2)}>
        <Dot /> Triage by fixed rules
      </span>
      <span className="hw-chip c2 hw-a" style={k(4)}>
        <Dot /> A brief with every handover
      </span>
    </div>
  )
}

const empty = () => new Uint8Array(0)

function Dot() {
  return <i className="hw-dot" aria-hidden />
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
