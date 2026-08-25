'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './landing.css'
import { useMotion } from './use-motion'
import { SectionHead, Spoken, Waveform } from './motion-parts'
import { Register } from './register'
import { Intro } from './intro'
import { Nav } from './nav'
import { Refusals } from './refusals'
import { Channels } from './channels'
import { Triage } from './triage'

/**
 * The landing page.
 *
 * One job: convince the person who runs a dental practice, in about thirty
 * seconds, that this answers their phone better than the phone currently gets
 * answered. Everything here is either a claim that is demonstrated on the page
 * or a claim the console can be opened to check.
 *
 * The hero is not a description of the product — it is the product's one
 * unfakeable moment, a caller changing language mid-call and the desk following
 * without being asked. It plays at real conversational tempo because the tempo
 * *is* the claim: an answer that lands a beat too late is how a caller knows
 * they are talking to software.
 *
 * No persona name anywhere. The thing that answers is "the front desk", which
 * is also exactly what it tells a caller who asks.
 */

// ── The call in the hero ─────────────────────────────────────────────────────
//
// Authored, not recorded — but every fact in it is drawn from the seeded
// practice: real branches, a real dentist, a real service, and the diary
// lookup that would make the offered slot true. The
// caller opens in Hinglish, moves to Devanagari, and closes in English — the
// three registers an Indian front desk actually hears, in one call.

type Beat =
  | { kind: 'turn'; who: 'caller' | 'desk'; at: string; lang?: string; deva?: boolean; text: string }
  | { kind: 'tool'; text: string; done?: boolean }

const CALL: Array<Beat & { after: number }> = [
  { kind: 'turn', who: 'desk', at: '0:00', text: 'Smile Dental Care, good morning.', after: 500 },
  {
    kind: 'turn',
    who: 'caller',
    at: '0:04',
    lang: 'Hinglish',
    text: 'Haan hi, mujhe cleaning ke liye appointment chahiye tha.',
    after: 2600,
  },
  {
    kind: 'turn',
    who: 'desk',
    at: '0:07',
    lang: 'Hinglish',
    text: 'Bilkul — scaling and polishing. Bandra, Andheri ya Powai, kaun si branch aapke paas hai?',
    after: 1700,
  },
  {
    kind: 'turn',
    who: 'caller',
    at: '0:13',
    lang: 'हिन्दी',
    deva: true,
    text: 'बांद्रा। कल शाम को कुछ मिल जाएगा?',
    after: 3000,
  },
  { kind: 'tool', text: 'checking the Bandra diary · Thu 21 Aug', after: 900 },
  {
    kind: 'turn',
    who: 'desk',
    at: '0:17',
    lang: 'हिन्दी',
    deva: true,
    text: 'कल शाम डॉक्टर कविता अय्यर के पास सवा छह बजे का समय खाली है। बुक कर दूँ?',
    after: 1500,
  },
  { kind: 'turn', who: 'caller', at: '0:23', text: 'Yes, please. Ravi Menon.', after: 3100 },
  { kind: 'tool', text: 'booked · Ravi Menon · Dr. Kavita Iyer · 6:15 pm', done: true, after: 1200 },
  {
    kind: 'turn',
    who: 'desk',
    at: '0:27',
    text: 'Done, Ravi — 6:15 tomorrow with Dr. Iyer at Bandra. Confirmation is on its way.',
    after: 1000,
  },
]

function useCallPlayback(): [number, () => void] {
  // Someone reading with reduced motion gets the finished transcript, not a
  // stalled one — the content is the point, the timing is the flourish.
  const reduced = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [shown, bump] = useReducer((n: number, action: 'next' | 'reset') => {
    if (action === 'reset') return 0
    return Math.min(n + 1, CALL.length)
  }, 0)

  useEffect(() => {
    if (reduced) {
      for (let i = 0; i < CALL.length; i++) bump('next')
      return
    }
    if (shown >= CALL.length) return
    const wait = CALL[shown]?.after ?? 800
    const t = window.setTimeout(() => bump('next'), wait)
    return () => window.clearTimeout(t)
  }, [shown, reduced])

  return [reduced ? CALL.length : shown, () => bump('reset')]
}

function LiveCall() {
  const [shown, replay] = useCallPlayback()
  const bodyRef = useRef<HTMLDivElement>(null)
  const running = shown < CALL.length
  const beats = CALL.slice(0, shown)
  const nextIsDesk = running && CALL[shown]?.kind === 'turn' && CALL[shown]?.who === 'desk'

  // The frame is fixed, so the transcript scrolls inside it the way a call
  // screen does — and stays scrollable afterwards, because the early Hinglish
  // turns are the evidence for the headline's claim.
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: shown > 1 ? 'smooth' : 'auto' })
  }, [shown])

  return (
    <div className="lp-call">
      <div className="lp-call-head">
        <span className="lp-call-title">
          <span className="lp-live" aria-hidden="true" />
          {running ? 'Call in progress' : 'Call ended'}
        </span>
        <span className="lp-call-clock">
          {running ? 'inbound · Bandra West' : '0:31 · booked'}
        </span>
      </div>

      <div className="lp-call-body" ref={bodyRef} aria-live="polite">
        {beats.map((b, i) =>
          b.kind === 'tool' ? (
            <span key={i} className={`lp-tool${b.done ? ' lp-tool-ok' : ''}`}>
              {b.done ? '✓' : '⟳'} {b.text}
            </span>
          ) : (
            <div key={i} className={`lp-turn lp-turn-${b.who}`}>
              <span className="lp-turn-meta">
                <span className="lp-who">{b.who === 'caller' ? 'Caller' : 'Front desk'}</span>
                <span className="lp-time">{b.at}</span>
                {b.lang && <span className="lp-lang">{b.lang}</span>}
              </span>
              <span
                className={`lp-bubble${b.deva ? ' lp-deva' : ''}`}
                lang={b.deva ? 'hi' : 'en'}
              >
                {b.text}
              </span>
            </div>
          ),
        )}

        {nextIsDesk && (
          <span className="lp-typing" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
      </div>

      <div className="lp-call-foot">
        <span>An example call against the seeded practice — real branches, dentists and diary.</span>
        {!running && (
          <button className="lp-replay" onClick={replay}>
            Play again
          </button>
        )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Landing() {
  useMotion()

  const [year] = useState(() => new Date().getFullYear())

  return (
    <div className="lp">
      <Intro />
      <Nav />

      <header id="top" className="lp-wrap lp-hero">
        <div>
          {/* The claim, made by the type rather than about it. */}
          {/* The claim, made by the type rather than about it: the script
              changes mid-sentence, and the sentence arrives as it is spoken. */}
          <h1 className="lp-h1">
            <Spoken
              words={[
                { t: 'Your' },
                { t: 'phone' },
                { t: 'rings' },
                { t: 'in' },
                { t: 'English.', cls: 'lp-en' },
                { t: 'Or' },
                { t: 'in' },
                { t: 'हिन्दी.', cls: 'lp-deva', lang: 'hi' },
                { t: 'Or,' },
                { t: 'halfway' },
                { t: 'through,' },
                { t: 'in' },
                { t: 'both.' },
              ]}
            />
          </h1>

          <p className="lp-hero-lede" data-reveal style={{ '--i': 8 } as React.CSSProperties}>
            A front desk that picks up on the first ring, in whichever language the caller
            reaches for, and books straight into your diary while they are still on the line.
          </p>

          <div className="lp-cta-row" data-reveal style={{ '--i': 9 } as React.CSSProperties}>
            <a className="lp-btn lp-btn-primary" href="/start">
              Set up your practice →
            </a>
            <a className="lp-btn lp-btn-ghost" href="/console">
              Hear it first
            </a>
          </div>
          <p className="lp-cta-note" data-reveal style={{ '--i': 10 } as React.CSSProperties}>
            Runs in the browser. Needs a microphone, no sign-up.
          </p>
        </div>

        <LiveCall />
        <Waveform />
      </header>

      <Register />

      <section id="does" className="lp-band">
        <div className="lp-wrap">
          <SectionHead eyebrow="What it does" title="Everything the desk does between patients">
            Not a menu tree and not a chatbot reading a script. It listens, works out what the
            caller wants from how they said it, and acts on your real data.
          </SectionHead>

          <div className="lp-cards">
            <article className="lp-card" data-reveal style={{ '--i': 0 } as React.CSSProperties}>
              <h3>Books against the real diary</h3>
              <p>
                Every slot it offers is read from your calendar at the moment it speaks, matched
                to a dentist who does that treatment at that branch. It never offers a time that
                has gone.
              </p>
              <p className="lp-quote">
                &ldquo;Saturday is full at Bandra, but Dr. Mehta has 11:30 at Andheri — or Monday
                evening here. Which suits you?&rdquo;
              </p>
            </article>

            <article className="lp-card" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
              <h3>Understands what people call things</h3>
              <p>
                <em>Safai</em>, cleaning, descaling and scaling are one treatment. So are cap and
                crown, RCT and root canal, <em>akal daadh</em> and wisdom tooth. Callers do not
                use your price-list vocabulary.
              </p>
              <p className="lp-quote lp-deva" lang="hi">
                &ldquo;अकल दाढ़ का मतलब wisdom tooth — उसके लिए डॉक्टर क़ुरैशी को दिखाना होगा।&rdquo;
              </p>
            </article>

            <article className="lp-card" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
              <h3>Answers only from your practice</h3>
              <p>
                Timings, fees, parking, which branch has digital X-ray, whether a dentist speaks
                Marathi. If the answer is not in what you gave it, it says so and offers the
                clinic&rsquo;s number instead of guessing.
              </p>
              <p className="lp-quote">
                &ldquo;I don&rsquo;t have the aligner pricing in front of me — let me have Dr.
                Nair&rsquo;s office call you back today.&rdquo;
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* The centrepiece. A practice is trusting this with clinical questions, so
          the limits deserve the loudest surface on the page, not a footnote. */}
      <section id="limits" className="lp-band lp-limits">
        <div className="lp-wrap">
          <SectionHead eyebrow="What it won&rsquo;t do" title="The refusals are the product">
            A receptionist who improvises about your patients&rsquo; health is a liability, not a
            feature. These are hard stops, not tendencies — each one is enforced before anything
            reaches the caller&rsquo;s ear.
          </SectionHead>

          <Refusals />
        </div>
      </section>

      <section className="lp-band lp-tint">
        <div className="lp-wrap">
          <SectionHead
            eyebrow="Emergencies"
            title="It stops selling appointments and starts helping"
          >
            When a caller describes something that cannot wait for Tuesday, booking stops. It
            gives the branch&rsquo;s emergency line, tells them what to do in the meantime in
            their own language, and flags the call for a human before the line even drops.
          </SectionHead>

          {/* Full width, and drivable. It is the highest-stakes thing the desk
              does, so it gets the room to be shown rather than described. */}
          <Triage />
        </div>
      </section>

      <section id="channels" className="lp-band">
        <div className="lp-wrap">
          <SectionHead
            eyebrow="Where it answers"
            title="One desk, wherever the patient reaches you"
          >
            The conversation, the diary and the practice&rsquo;s knowledge stay the same. Only the
            pipe changes.
          </SectionHead>

          <Channels />
        </div>
      </section>

      {/* The last thing on the page is an invitation, so it gets the level
          meter back — the page opened on a live line and closes on one. */}
      <section className="lp-close">
        <Waveform />
        <div className="lp-wrap">
          <p className="lp-eyebrow" data-reveal>
            No sign-up
          </p>
          <h2 className="lp-h2" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
            Call the desk yourself
          </h2>
          <p className="lp-lede" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
            Try to trip it up. Switch to Hindi mid-sentence, talk over it, change your mind about
            the branch, ask it what to take for the pain.
          </p>
          <div className="lp-cta-row" data-reveal style={{ '--i': 3 } as React.CSSProperties}>
            <a className="lp-btn lp-btn-primary" href="/console">
              Take a call →
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-wrap lp-foot">
        <span>Vaani · a front desk for dental practices · {year}</span>
        <span>
          <a href="/console">Console</a> · Mumbai · 11 languages, Hinglish included
        </span>
      </footer>
    </div>
  )
}
