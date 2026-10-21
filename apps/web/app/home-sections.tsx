'use client'

import { useEffect, useRef, useState } from 'react'
import { VoiceBlob } from '@/components/VoiceBlob'

/**
 * The landing page's sections, laid out after Odama's Momo, section for
 * section: a calm sky with the call card standing in it, the record board a
 * line below (record-board.tsx), a strip where the logos go, the pinned walk through a call
 * (how-it-works.tsx), the things patients ask for, a ring of voices, a glass
 * closing card, the wordmark, and a white footer.
 *
 * Momo is full of photographs of people. This page has none: where Momo has
 * faces, Vaani has the scripts its callers speak, and where Momo quotes
 * customers, Vaani shows example calls against the demo practice, labelled as
 * examples. Every claim in the copy is one the code makes true.
 */

const reveal = (i: number) => ({ '--i': i }) as React.CSSProperties

// ── Scenery ──────────────────────────────────────────────────────────────────

/**
 * Painted, not photographed: a mint sky, soft clouds, curved glass on either
 * side with a ring of light, planters with greenery, and a warm horizon. No
 * request, no licence, and it takes the page's own colours.
 */
export function Scene({ variant = 'sky' }: { variant?: 'sky' | 'garden' | 'room' }) {
  return (
    <div className={`mo-scene is-${variant}`} aria-hidden>
      <span className="mo-cloud c1" />
      <span className="mo-cloud c2" />
      <span className="mo-cloud c3" />
      <span className="mo-cloud c4" />
      {variant !== 'garden' && (
        <>
          <span className="mo-glass is-left">
            <i className="mo-ring" />
            <i className="mo-glint" />
          </span>
          <span className="mo-glass is-right">
            <i className="mo-ring" />
            <i className="mo-glint" />
          </span>
        </>
      )}
      <span className="mo-hills" />
      <span className="mo-leaves is-left" />
      <span className="mo-leaves is-right" />
      {variant === 'garden' && <span className="mo-flowers" />}
      <span className="mo-floor" />
    </div>
  )
}

/**
 * The big ellipse behind the hero's words, with two lights riding it: a green
 * one one way, a warm white one the other, each a bright head on a fading
 * tail. Drawn in SVG so the lights follow the curve at any width.
 */
const RIM = 'M 1 210 A 519 209 0 1 1 1039 210 A 519 209 0 1 1 1 210'

export function HeroOrbit() {
  return (
    <span className="mo-ellipse e-hero" aria-hidden>
      <svg viewBox="0 0 1040 420" preserveAspectRatio="none">
        <path className="mo-rim" d={RIM} />
        {/* Each light is three dashes of the same path — a long faint one, a
            shorter brighter one, a bright head — fronts lined up, so the
            tail fades behind it. */}
        {['', ' is-warm'].map((w) =>
          ['t1', 't2', 'head'].map((k) => (
            <path key={k + w} className={`mo-comet is-${k}${w}`} d={RIM} pathLength={100} />
          )),
        )}
      </svg>
    </span>
  )
}

/** The two small details the calls to action carry: a voice for "hear", an arrow for "go". */
export function Eq() {
  return (
    <span className="mo-eq" aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

export function Arrow() {
  return (
    <svg className="mo-arrow" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  )
}

/** Thin green lines that drift sideways forever, behind the call card. */
export function Flow({ className = '' }: { className?: string }) {
  const wave = (amp: number, len: number, phase: number) => {
    let d = `M 0 ${50 + Math.sin(phase) * amp}`
    for (let x = 0; x <= 2400; x += 40) {
      d += ` L ${x} ${(50 + Math.sin((x / len) * Math.PI * 2 + phase) * amp).toFixed(1)}`
    }
    return d
  }
  return (
    <svg className={`mo-flow ${className}`} viewBox="0 0 1200 100" preserveAspectRatio="none" aria-hidden>
      <g className="mo-flow-a">
        <path d={wave(9, 600, 0)} />
      </g>
      <g className="mo-flow-b">
        <path d={wave(6, 400, 1.4)} />
      </g>
      <g className="mo-flow-c">
        <path d={wave(4, 300, 2.6)} />
      </g>
    </svg>
  )
}

// ── The call card ────────────────────────────────────────────────────────────

/** A live-looking call: the orb, a timer that really ticks, a voice that moves. */
export function CallCard({ title = 'Vaani front desk', sub, start = 83, action = 'end' }: {
  title?: string
  sub?: string
  start?: number
  action?: 'end' | 'answer'
}) {
  const [t, setT] = useState(start)
  useEffect(() => {
    if (action !== 'end') return
    const id = setInterval(() => setT((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [action])

  return (
    <div className="mo-callcard">
      <div className="mo-orb">
        <VoiceBlob
          state={action === 'end' ? 'speaking' : 'idle'}
          micLevel={0}
          agentLevel={action === 'end' ? 0.3 : 0}
          spectrum={() => new Uint8Array(0)}
          live={false}
        />
      </div>
      <p className="mo-callcard-title">{title}</p>
      <p className="mo-callcard-sub">
        {sub ?? `${Math.floor(t / 60)}`.padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')}
      </p>
      {action === 'end' && <Voice />}
      <span className={`mo-callbtn is-${action}`} aria-hidden>
        <Icon name="phone" />
      </span>
    </div>
  )
}

/** The little interleaved voice trace under the timer. */
function Voice() {
  return (
    <svg className="mo-voice" viewBox="0 0 120 30" aria-hidden>
      {[0, 1, 2, 3].map((k) => (
        <path
          key={k}
          className={`mo-voice-l v${k}`}
          d={`M0 15 ${Array.from({ length: 25 }, (_, i) => {
            const x = i * 5
            const env = Math.sin((i / 24) * Math.PI)
            return `L${x} ${(15 + Math.sin(i * 0.9 + k * 1.3) * 11 * env).toFixed(1)}`
          }).join(' ')}`}
        />
      ))}
    </svg>
  )
}

// ── Where the logos go ───────────────────────────────────────────────────────

const LANGS: Array<[string, string]> = [
  ['English', 'en'],
  ['हिन्दी', 'hi'],
  ['Hinglish', 'en'],
  ['मराठी', 'mr'],
  ['ગુજરાતી', 'gu'],
  ['বাংলা', 'bn'],
  ['தமிழ்', 'ta'],
  ['తెలుగు', 'te'],
  ['ಕನ್ನಡ', 'kn'],
  ['മലയാളം', 'ml'],
  ['ਪੰਜਾਬੀ', 'pa'],
]

export function Languages() {
  return (
    <section id="languages" className="mo-langs">
      <p data-reveal>Built for the way India calls its dentist.</p>
      {/* A slow marquee: the list twice over, sliding one length and starting
          again, so the seam never shows. The copy is hidden from a screen
          reader, which hears the eleven once. */}
      <div className="mo-marquee" data-reveal style={reveal(1)}>
        <div className="mo-marquee-track">
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 || undefined}>
              {LANGS.map(([name, lang]) => (
                <li key={name} lang={lang}>
                  {name}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Whatever patients need ───────────────────────────────────────────────────

/** Where Momo floats five portraits: five of the scripts callers ring in. */
const BUBBLES: Array<[string, string]> = [
  ['हिन्दी', 'hi'],
  ['தமிழ்', 'ta'],
  ['English', 'en'],
  ['ગુજરાતી', 'gu'],
  ['বাংলা', 'bn'],
]

const NEEDS: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'calendar', title: 'Book an appointment', body: 'Booked against the real diary while the caller is still on the line.' },
  { icon: 'swap', title: 'Reschedule a visit', body: 'Moves or cancels an appointment without the back-and-forth.' },
  { icon: 'person', title: 'Capture patient details', body: 'Finds returning patients by number and takes down new ones.' },
  { icon: 'chat', title: 'Answer common questions', body: 'Hours, fees and parking — from your practice’s own words.' },
]

export function Needs() {
  return (
    <section id="needs" className="mo-needs">
      <Scene variant="sky" />
      {/* Each script sits in a holder that carries its place and its depth
          as the page scrolls; the disc inside pops in and floats on its own
          clock. Two orbits turn round the middle one, a light riding each. */}
      <div className="mo-bubbles" aria-hidden data-reveal>
        <span className="mo-sun" />
        <span className="mo-orbit o1">
          <i />
        </span>
        <span className="mo-orbit o2">
          <i />
        </span>
        {BUBBLES.map(([s, lang], i) => (
          <span key={s} className={`mo-bubble-pos b${i}`} style={{ '--n': i } as React.CSSProperties}>
            <span className="mo-bubble-script" lang={lang}>
              {s}
            </span>
          </span>
        ))}
      </div>
      <div className="lp-wrap mo-needs-in">
        <Head title={<>Whatever patients need,<br />Vaani is ready to help.</>}>
          From booking the chair to taking down a new patient&rsquo;s details, Vaani handles the
          everyday calls while keeping your team in the loop.
        </Head>
        <div className="mo-needs-grid">
          {NEEDS.map((n, i) => (
            <article key={n.title} className="mo-need" data-reveal data-tilt style={reveal(i)}>
              <span className="mo-need-icon">
                <Icon name={n.icon} />
              </span>
              <span className="mo-need-n mono" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
              <span className="mo-need-line" aria-hidden />
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Voices, where Momo has testimonials ──────────────────────────────────────

const VOICES: Array<{ script: string; lang: string; said: string; then: string; who: string }> = [
  {
    script: 'हि',
    lang: 'hi',
    said: 'बांद्रा। कल शाम को कुछ मिल जाएगा?',
    then: 'Dr. Kavita Iyer at 6:15 tomorrow — the diary was checked before it was offered.',
    who: 'Hindi · Bandra',
  },
  {
    script: 'Hi',
    lang: 'hi-Latn',
    said: 'Mujhe cleaning ke liye appointment chahiye tha.',
    then: 'Scaling and polishing, Thursday at 10:15 with Dr. Iyer at Bandra.',
    who: 'Hinglish · Bandra',
  },
  {
    script: 'En',
    lang: 'en',
    said: 'My face is swollen and I have a fever.',
    then: 'Booking stopped. Told to go to the emergency room, and put first in the clinic’s callback queue.',
    who: 'English · Powai',
  },
  {
    script: 'Hi',
    lang: 'hi-Latn',
    said: 'Koi painkiller bata do na, bahut dard ho raha hai.',
    then: 'No medicine named. Urgent pain, so it found the earliest slot instead.',
    who: 'Hinglish · Andheri',
  },
  {
    script: 'En',
    lang: 'en',
    said: 'Wait — am I talking to a real person?',
    then: 'No — the practice’s assistant, and it offered to put them through to reception.',
    who: 'English · Bandra',
  },
]

/** The honeycomb's other cells: every script the desk answers in, faint. */
const HONEY = ['En', 'हि', 'म', 'ગુ', 'বা', 'த', 'తె', 'ಕ', 'മ', 'ਪੰ', 'En', 'हि', 'த', 'ગુ', 'বা', 'म', 'ಕ', 'తె']
const HONEY_ROWS = [3, 4, 5, 4, 3]

export function Voices() {
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  const honey = useRef<HTMLDivElement>(null)

  const [seen, setSeen] = useState(false)

  // Only while it is on screen: the calls turn, and the comb ripples.
  useEffect(() => {
    const el = honey.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setSeen(!!e?.isIntersecting), { rootMargin: '100px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!seen || held || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setTimeout(() => setAt((i) => (i + 1) % VOICES.length), 6500)
    return () => window.clearTimeout(t)
  }, [at, held, seen])

  // A wave of light rings out through the comb each time the call changes.
  // Two identical animations under two names, swapped: a new name starts the
  // animation again with no layout read — the old way forced one across the
  // whole page every six and a half seconds, which a scroll felt as a hitch.
  // An attribute, not a class: the reveal adds a class to this element, and
  // a class list React rewrites would take it away again.
  const wave = at % 2 === 0 ? 'a' : 'b'

  let k = 0
  const v = VOICES[at]!

  return (
    <section id="voices" className="mo-section mo-voices">
      <div className="mo-honey" data-wave={wave} aria-hidden data-reveal ref={honey}>
        {HONEY_ROWS.map((n, r) => (
          <div key={r} className="mo-honey-row">
            {Array.from({ length: n }, (_, i) => {
              const s = HONEY[k++ % HONEY.length]!
              const lit = (r === 1 && (i === 1 || i === 2)) || (r === 2 && i > 0 && i < 4) || (r === 3 && (i === 1 || i === 2))
              // Rings out from the middle cell, for the ripple on arrival.
              const ring = Math.round(Math.hypot(r - 2, i - (n - 1) / 2))
              // The middle cell is the call on screen: its script, in green.
              const core = r === 2 && i === 2
              return (
                <span
                  key={i}
                  className={`mo-cell${lit ? ' is-lit' : ''}${core ? ' is-core' : ''}`}
                  style={{ '--i': r + i, '--ring': ring } as React.CSSProperties}
                >
                  {core ? (
                    <span key={at} className="mo-core-t" lang={v.lang}>
                      {v.script}
                    </span>
                  ) : (
                    s
                  )}
                </span>
              )
            })}
          </div>
        ))}
      </div>

      <div className="lp-wrap mo-quote">
        <figure className="mo-quote-text" key={at}>
          <blockquote>
            <span lang={v.lang}>“{v.said}”</span>
            <span className="mo-quote-then">{v.then}</span>
          </blockquote>
          <figcaption>
            <strong>Example call</strong>
            <span>{v.who} · against the demo practice</span>
          </figcaption>
        </figure>

        <div className="mo-quote-pick" role="tablist" aria-label="Example calls" onMouseEnter={() => setHeld(true)}>
          <span className="mo-quote-mark" aria-hidden>
            &ldquo;
          </span>
          {VOICES.map((x, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === at}
              aria-label={x.who}
              className={`mo-pick${i === at ? ' is-on' : ''}`}
              onClick={() => {
                setHeld(true)
                setAt(i)
              }}
            >
              {x.script}
              {i === at && !held && (
                // Keyed to the call, so the ring starts again with each one.
                <svg key={at} className="mo-pick-ring" viewBox="0 0 66 66" aria-hidden>
                  <circle cx="33" cy="33" r="31" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── The close, the wordmark, the footer ──────────────────────────────────────

/** Motes of light for the hero and the close: where each rises, how big, how fast. Fixed, so SSR matches. */
export const POLLEN = Array.from(
  { length: 14 },
  (_, i) =>
    ({
      '--x': `${(i * 37 + 11) % 100}%`,
      '--s': `${3 + (i % 3)}px`,
      '--t': `${9 + (i % 4) * 2.5}s`,
      '--d': `${-i * 1.3}s`,
      '--dx': `${((i % 5) - 2) * 18}px`,
    }) as React.CSSProperties,
)

export function Close() {
  return (
    <section className="mo-close">
      <Scene variant="garden" />
      <span className="mo-ellipse e1" aria-hidden />
      <span className="mo-ellipse e2" aria-hidden />
      {/* Rings leaving the card the way sound leaves the orb, and light
          rising out of the garden behind it. */}
      <span className="mo-close-waves" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="mo-pollen" aria-hidden>
        {POLLEN.map((p, i) => (
          <i key={i} style={p} />
        ))}
      </span>
      <div className="mo-close-card" data-reveal data-tilt>
        <div className="mo-orb is-small">
          <VoiceBlob state="idle" micLevel={0} agentLevel={0} spectrum={() => new Uint8Array(0)} live={false} />
        </div>
        <h2>
          Your front desk,
          <br />
          always ready.
        </h2>
        <p>
          Let Vaani take the calls, the bookings and the everyday questions, so your team can stay
          with the patient in the chair.
        </p>
        <div className="mo-ctas">
          <a className="mo-btn is-dark" href="/start">
            Set up your practice <Arrow />
          </a>
          <a className="mo-btn" href="/console">
            <Eq /> Hear it first
          </a>
        </div>
      </div>
    </section>
  )
}

const PILLS: Array<[string, string]> = [
  ['Easier to manage.', 'is-dark p1'],
  ['Smarter front desk.', 'p2'],
  ['Built for better care.', 'is-green p3'],
  ['In eleven languages.', 'p4'],
  ['Care, made easier.', 'is-mint p5'],
]

export function Wordmark() {
  return (
    <div className="mo-word" aria-hidden data-reveal>
      <span className="mo-word-text">
        {/* The holder spreads and gathers with the scroll; the letter inside
            keeps its own fill and its own rise. */}
        {'Vaani'.split('').map((c, i) => (
          <span key={i} className="mo-lx" style={{ '--l': i } as React.CSSProperties}>
            <span className="mo-letter">{c}</span>
          </span>
        ))}
      </span>
      {PILLS.map(([t, c], i) => (
        <span key={t} className={`mo-pill ${c}`} style={{ '--p': i } as React.CSSProperties}>
          {t}
        </span>
      ))}
    </div>
  )
}

export function Footer({ year, home = true }: { year: number; home?: boolean }) {
  // Off the landing page, its anchors have to lead back to it.
  const to = (anchor: string) => (home ? anchor : `/${anchor}`)
  return (
    <footer className="mo-foot">
      <div className="lp-wrap">
        <div className="mo-foot-top">
          <div className="mo-foot-brand" data-reveal>
            <a className="mo-logo" href={to('#top')}>
              Vaani
            </a>
            <p className="mo-foot-tag">Your front desk, always ready to answer.</p>
            <p>
              Vaani answers a dental practice&rsquo;s phone in eleven Indian languages, books into
              the diary, and hands the rest to your team.
            </p>
          </div>
          <nav className="mo-foot-cols" aria-label="Footer" data-reveal style={reveal(1)}>
            <div>
              <h4>Product</h4>
              <a href={to('#how')}>How it works</a>
              <a href="/pipeline">The pipeline</a>
              <a href={to('#needs')}>Use cases</a>
              <a href={to('#voices')}>Example calls</a>
              <a href={to('#languages')}>Languages</a>
            </div>
            <div>
              <h4>Try it</h4>
              <a href="/console">Take a call</a>
              <a href="/start">Set up a practice</a>
              <a href="/login">Sign in</a>
            </div>
            <div>
              <h4>Build on it</h4>
              <a href="/settings">API and webhooks</a>
              <a href="https://github.com/garvbahl37-gif/dental-voice-agent">Source</a>
            </div>
          </nav>
          <div className="mo-foot-contact" data-reveal style={reveal(2)}>
            <h4>Open source</h4>
            <small>Code</small>
            <p>
              <a href="https://github.com/garvbahl37-gif/dental-voice-agent">github.com/garvbahl37-gif</a>
            </p>
          </div>
        </div>
        <div className="mo-foot-legal">
          <span>© {year} Vaani. A front desk for dental practices.</span>
          <span>
            <a href="/console">Console</a> • <a href="/login">Sign in</a> •{' '}
            <a href="https://github.com/garvbahl37-gif/dental-voice-agent">GitHub</a>
          </span>
        </div>
      </div>
    </footer>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────

function Head({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mo-head">
      {/* The heading is observed; the span inside it is what wipes. A clipped
          element has no visible area, so an observer watching it would wait
          forever for it to come into view. */}
      <h2 data-reveal>
        <span className="mo-wipe">{title}</span>
      </h2>
      <p data-reveal style={reveal(1)}>
        {children}
      </p>
    </div>
  )
}

type IconName = 'phone' | 'wave' | 'play' | 'doc' | 'calendar' | 'swap' | 'person' | 'chat'

export function Icon({ name }: { name: IconName }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const d: Record<IconName, React.ReactNode> = {
    phone: (
      <path
        d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
        {...p}
      />
    ),
    wave: <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" {...p} />,
    play: <path d="M8 5.5v13l10-6.5z" fill="currentColor" stroke="none" />,
    doc: (
      <>
        <path d="M6 3.5h8l4 4v13H6z" {...p} />
        <path d="M14 3.5v4h4M9 12h6M9 15.5h6" {...p} />
      </>
    ),
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="3" {...p} />
        <path d="M3.5 10h17M8 3v4M16 3v4" {...p} />
      </>
    ),
    swap: <path d="M7 7h11l-3-3M17 17H6l3 3" {...p} />,
    person: (
      <>
        <circle cx="12" cy="8" r="3.6" {...p} />
        <path d="M5 20c1.2-3.6 3.8-5.4 7-5.4s5.8 1.8 7 5.4" {...p} />
      </>
    ),
    chat: (
      <>
        <path d="M4 5h16v11H9l-5 4z" {...p} />
        <path d="M8 9.5h8M8 12.5h5" {...p} />
      </>
    ),
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      {d[name]}
    </svg>
  )
}
