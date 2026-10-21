'use client'

import { useEffect, useState } from 'react'
import './landing.css'
import './home.css'
import { useMotion } from './use-motion'
import { useLandingFx } from './landing-fx'
import { Intro } from './intro'
import { Nav } from './nav'
import { HowItWorks } from './how-it-works'
import { ProductPanel } from './record-board'
import {
  Arrow,
  CallCard,
  Close,
  Eq,
  Flow,
  Footer,
  HeroOrbit,
  Languages,
  Needs,
  POLLEN,
  Scene,
  Voices,
  Wordmark,
} from './home-sections'

/**
 * The landing page.
 *
 * One job: convince the person who runs a dental practice, in about thirty
 * seconds, that this answers their phone better than the phone currently gets
 * answered. Laid out after Odama's Momo: one calm claim over a sky, the call
 * itself standing in the light, and the record it produces a line below.
 *
 * The headline's last word is the product's one differentiating claim, so it
 * is shown rather than said: "language" turns through the scripts the desk
 * answers in. No persona name anywhere — the thing that answers is "the front
 * desk", which is also exactly what it tells a caller who asks.
 */

/** "Language", in each language it answers in. */
const WORD: Array<[string, string]> = [
  ['language', 'en'],
  ['भाषा', 'hi'],
  ['மொழி', 'ta'],
  ['ભાષા', 'gu'],
  ['ভাষা', 'bn'],
  ['భాష', 'te'],
  ['ಭಾಷೆ', 'kn'],
  ['ഭാഷ', 'ml'],
  ['ਭਾਸ਼ਾ', 'pa'],
]

function Turning() {
  const [at, setAt] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setAt((i) => (i + 1) % WORD.length), 2200)
    return () => clearInterval(id)
  }, [])
  const [w, lang] = WORD[at]!
  return (
    <span className="mo-turn">
      {/* Keyed so each word arrives rather than swapping in place. The
          visible word is decoration to a screen reader, which hears the
          English one once. */}
      <span key={w} className="mo-turn-word" lang={lang} aria-hidden>
        {w}
        {/* A green stroke drawn under each word as it lands. */}
        <svg className="mo-turn-line" viewBox="0 0 200 12" preserveAspectRatio="none">
          <path d="M3 8 C 48 2, 118 12, 197 4" pathLength={1} />
        </svg>
      </span>
      <span className="sr-only">language</span>
    </span>
  )
}

export default function Landing() {
  useMotion()
  useLandingFx()

  const [year] = useState(() => new Date().getFullYear())

  return (
    <div className="lp mo">
      <Intro />

      {/* Fixed over the page rather than sticky inside the hero, so the bar —
          and the progress line along its foot — stay with the reader all
          the way down. */}
      <Nav />

      <div className="mo-hero" id="top">
        <Scene variant="sky" />
        <HeroOrbit />
        <span className="mo-pollen is-hero" aria-hidden>
          {POLLEN.map((p, i) => (
            <i key={i} style={p} />
          ))}
        </span>

        <header className="mo-hero-in">
          <p className="mo-eyebrow" data-reveal>
            <i aria-hidden /> AI front desk for dental practices
          </p>
          {/* Word by word: each rises and comes into focus in turn, and the
              last one keeps turning through the scripts once it has landed.
              The spaces sit between the spans, never inside them — an
              inline-block swallows its own trailing space. */}
          <h1 className="mo-h1" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
            {['Every', 'patient', 'call,'].map((w, i) => (
              <span key={w}>
                {i > 0 && ' '}
                <span className="mo-w" style={{ '--w': i } as React.CSSProperties}>
                  {w}
                </span>
              </span>
            ))}
            <br />
            {['in', 'their', 'own'].map((w, i) => (
              <span key={w}>
                {i > 0 && ' '}
                <span className="mo-w" style={{ '--w': i + 3 } as React.CSSProperties}>
                  {w}
                </span>
              </span>
            ))}{' '}
            <span className="mo-w" style={{ '--w': 6 } as React.CSSProperties}>
              <Turning />.
            </span>
          </h1>
          <p className="mo-lede" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
            Vaani answers your practice&rsquo;s phone in eleven Indian languages, books straight
            into the diary, and hands emergencies to your team while the caller is still on the
            line.
          </p>
          <div className="mo-ctas" data-reveal style={{ '--i': 3 } as React.CSSProperties}>
            <a className="mo-btn is-dark" href="/start">
              Set up your practice <Arrow />
            </a>
            <a className="mo-btn" href="/console">
              <Eq /> Hear it first
            </a>
          </div>
        </header>

        <div className="mo-hero-call" data-reveal style={{ '--i': 4 } as React.CSSProperties}>
          <Flow className="mo-hero-flow" />
          <div className="mo-lift" data-tilt>
            <CallCard />
          </div>
        </div>
      </div>

      <ProductPanel />
      <Languages />
      <HowItWorks />
      <Needs />
      <Voices />
      <Close />
      <Wordmark />
      <Footer year={year} />
    </div>
  )
}
