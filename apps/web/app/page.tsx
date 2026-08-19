'use client'

import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './landing.css'

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
  const [year] = useState(() => new Date().getFullYear())

  return (
    <div className="lp">
      <nav className="lp-nav">
        <div className="lp-wrap lp-nav-inner">
          <a className="lp-mark" href="#top">
            <span className="lp-mark-name">Vaani</span>
            <span className="lp-mark-sub">front desk</span>
          </a>
          <div className="lp-nav-links">
            <a className="lp-nav-link" href="#does">
              What it does
            </a>
            <a className="lp-nav-link" href="#limits">
              What it won&rsquo;t do
            </a>
            <a className="lp-nav-link" href="#channels">
              Where it answers
            </a>
            <a className="lp-btn lp-btn-primary lp-btn-sm" href="/console">
              Take a call
            </a>
          </div>
        </div>
      </nav>

      <header id="top" className="lp-wrap lp-hero">
        <div>
          {/* The claim, made by the type rather than about it. */}
          <h1 className="lp-h1">
            Your phone rings in <span className="lp-en">English</span>. Or in{' '}
            <span className="lp-deva" lang="hi">
              हिन्दी
            </span>
            . Or, halfway through, in both.
          </h1>

          <p className="lp-hero-lede">
            A front desk that picks up on the first ring, in whichever language the caller
            reaches for, and books straight into your diary while they are still on the line.
          </p>

          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/console">
              Take a call →
            </a>
            <a className="lp-btn lp-btn-ghost" href="#does">
              See what it handles
            </a>
          </div>
          <p className="lp-cta-note">
            Runs in the browser. Needs a microphone, no sign-up.
          </p>
        </div>

        <LiveCall />
      </header>

      {/* What is actually loaded — countable, and checkable in the console. */}
      <div className="lp-ledger-band">
        <div className="lp-wrap lp-ledger">
          {[
            ['3', 'branches, each with its own hours and diary'],
            ['6', 'dentists, matched to what you ask for'],
            ['12', 'treatments, under the names patients use'],
            ['3', 'languages, switchable mid-sentence'],
          ].map(([n, k]) => (
            <div key={k} className="lp-ledger-cell">
              <span className="lp-ledger-n">{n}</span>
              <span className="lp-ledger-k">{k}</span>
            </div>
          ))}
        </div>
      </div>

      <section id="does" className="lp-band">
        <div className="lp-wrap">
          <p className="lp-eyebrow">What it does</p>
          <h2 className="lp-h2">Everything the desk does between patients</h2>
          <p className="lp-lede">
            Not a menu tree and not a chatbot reading a script. It listens, works out what the
            caller wants from how they said it, and acts on your real data.
          </p>

          <div className="lp-cards">
            <article className="lp-card">
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

            <article className="lp-card">
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

            <article className="lp-card">
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
          <p className="lp-eyebrow">What it won&rsquo;t do</p>
          <h2 className="lp-h2">The refusals are the product</h2>
          <p className="lp-lede">
            A receptionist who improvises about your patients&rsquo; health is a liability, not a
            feature. These are hard stops, not tendencies — each one is enforced before anything
            reaches the caller&rsquo;s ear.
          </p>

          <ul className="lp-limit-list">
            {[
              [
                <>
                  <s>Diagnose</s> anything
                </>,
                <>
                  &ldquo;Is this a cavity or just sensitivity?&rdquo; gets a slot with a dentist,
                  never an opinion. <em>It does not speculate about a mouth it cannot see.</em>
                </>,
              ],
              [
                <>
                  <s>Prescribe</s> or advise on medicine
                </>,
                <>
                  No painkiller names, no dosages, no antibiotics, not even the obvious ones.{' '}
                  <em>Not for a patient who insists, and not in Hindi when the same question comes
                  back rephrased.</em>
                </>,
              ],
              [
                <>
                  <s>Invent</s> a price
                </>,
                <>
                  Fees come from your list or they do not get said. A quoted number a patient
                  repeats at the counter is worse than no number at all.
                </>,
              ],
              [
                <>
                  <s>Guess</s> at availability
                </>,
                <>
                  It would rather say &ldquo;let me check&rdquo; and take a beat than fill silence
                  with a slot that turns out to be taken.
                </>,
              ],
              [
                <>
                  <s>Pretend</s> to be a person
                </>,
                <>
                  Asked directly, it says it is the practice&rsquo;s assistant and offers to put a
                  human on. <em>It has no name and does not perform one.</em>
                </>,
              ],
            ].map(([k, v], i) => (
              <li key={i} className="lp-limit">
                <span className="lp-limit-k">{k}</span>
                <span className="lp-limit-v">{v}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="lp-band">
        <div className="lp-wrap lp-urgent">
          <div>
            <p className="lp-eyebrow">Emergencies</p>
            <h2 className="lp-h2">It stops selling appointments and starts helping</h2>
            <p className="lp-lede">
              When a caller describes something that cannot wait for Tuesday, booking stops. It
              gives the branch&rsquo;s emergency line, tells them what to do in the meantime in
              their own language, and flags the call for a human before the line even drops.
            </p>
          </div>

          <div className="lp-urgent-card">
            <span className="lp-urgent-tag">Recognised, in any of the three</span>
            <ul className="lp-trigger-list">
              {[
                ['bleeding that won’t stop', false],
                ['खून नहीं रुक रहा', true],
                ['knocked-out tooth', false],
                ['चेहरा सूज गया है', true],
                ['swelling with fever', false],
                ['bahut tez dard, so nahi paa raha', false],
                ['jaw injury', false],
                ['दाँत टूट गया है', true],
              ].map(([t, deva]) => (
                <li
                  key={t as string}
                  className={`lp-trigger${deva ? ' lp-deva' : ''}`}
                  lang={deva ? 'hi' : 'en'}
                >
                  {t as string}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="channels" className="lp-band">
        <div className="lp-wrap">
          <p className="lp-eyebrow">Where it answers</p>
          <h2 className="lp-h2">One desk, wherever the patient reaches you</h2>
          <p className="lp-lede">
            The conversation, the diary and the practice&rsquo;s knowledge stay the same. Only the
            pipe changes.
          </p>

          <div className="lp-channels">
            {[
              [
                'Live',
                'Browser',
                'Speak to it now from this page. Same engine that runs the phone line.',
                true,
              ],
              [
                'Next',
                'Phone line',
                'Your existing number, forwarded. Answers on the first ring, hands off to reception when asked.',
                false,
              ],
              [
                'Next',
                'WhatsApp',
                'The same booking flow in text, for patients who would rather type than talk.',
                false,
              ],
            ].map(([state, name, copy, live]) => (
              <div key={name as string} className="lp-channel">
                <span
                  className={`lp-channel-state ${live ? 'lp-state-live' : 'lp-state-next'}`}
                >
                  {state as string}
                </span>
                <h4>{name as string}</h4>
                <p>{copy as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-close">
        <div className="lp-wrap">
          <h2 className="lp-h2">Call the desk yourself</h2>
          <p className="lp-lede">
            Try to trip it up. Switch to Hindi mid-sentence, talk over it, change your mind about
            the branch, ask it what to take for the pain.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/console">
              Take a call →
            </a>
          </div>
        </div>
      </section>

      <footer className="lp-wrap lp-foot">
        <span>Vaani · a front desk for dental practices · {year}</span>
        <span>
          <a href="/console">Console</a> · Mumbai · English, हिन्दी, Hinglish
        </span>
      </footer>
    </div>
  )
}
