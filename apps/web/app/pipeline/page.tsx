'use client'

import { useState } from 'react'
import '../landing.css'
import '../home.css'
import './pipeline.css'
import { useMotion } from '../use-motion'
import { useLandingFx } from '../landing-fx'
import { Nav } from '../nav'
import { Arrow, Eq, Footer, Scene } from '../home-sections'
import { Icon, PipelineBoard } from './diagram'

/**
 * The pipeline — how a call goes through Vaani, end to end.
 *
 * The two references mixed. Momo gives the sky the page opens on, the glass,
 * the green and the serif; CareFlow gives the board — the big dark card the
 * whole platform runs across, and the stage cards in white, sage, black and
 * coral, each with a small working picture of its part.
 *
 * Everything on it is drawn from the code, and each stage names the file it
 * comes from. What is not built — a WhatsApp confirmation, a live transfer to
 * a person — is not on it.
 */

type Tone = 'white' | 'sage' | 'ink' | 'coral' | 'dark'

const STAGES: Array<{ title: string; body: string[]; code: string; tone: Tone; art: React.ReactNode }> = [
  {
    title: 'The line opens',
    body: [
      'In the browser the microphone streams as 16 kHz audio over a WebSocket, and the reply comes back at 24 kHz, played without gaps.',
      'On the phone, Twilio streams the call in; it is converted both ways in 20 ms frames, and the caller is looked up by number before the first word.',
    ],
    code: 'lib/voice-client.ts · telephony/src/audio.ts',
    tone: 'white',
    art: <ArtLine />,
  },
  {
    title: 'One model hears and answers',
    body: [
      'The voice goes to Gemini Live, which listens and speaks in one step — no separate transcriber, no separate voice to wait on.',
      'Its own voice detection decides when a turn has ended, and talking over it stops it mid-word. If the connection drops, the session resumes where it was.',
    ],
    code: 'packages/live/src/session.ts',
    tone: 'dark',
    art: <ArtModel />,
  },
  {
    title: 'In the caller’s language',
    body: [
      'Eleven languages, Hinglish among them. The language is read from each turn, and when the accent should change it changes at the next finished turn, so nobody is cut off.',
      'Recognition leans toward the practice’s own words: its dentists, its areas, the names of treatments.',
    ],
    code: 'shared/src/lang.ts',
    tone: 'sage',
    art: <ArtLangs />,
  },
  {
    title: 'It looks things up',
    body: [
      'Thirteen tools, called mid-sentence: who is calling, what is open in the diary, what the practice offers, what its own pages say.',
      'Hours, branches and dentists are always to hand; uploaded pages and a crawl of the website are searched. When nothing matches well enough, it does not guess — the question becomes a callback.',
    ],
    code: 'agent/src/tools.ts · knowledge/src/retrieve.ts',
    tone: 'white',
    art: <ArtTools />,
  },
  {
    title: 'It books',
    body: [
      'A slot is offered only after the diary is read, and checked again inside the same database transaction that writes it, so two callers cannot take one chair.',
      'Moving an appointment books the new time before it lets go of the old one.',
    ],
    code: 'db/src/repo.ts',
    tone: 'ink',
    art: <ArtBook />,
  },
  {
    title: 'Triage by fixed rules',
    body: [
      'The model is told to hand any pain, swelling, bleeding or injury to the triage rules — written rules, not its own judgement — which sort the call red, amber or green.',
      'Each band has its words written out in all eleven languages and said as written. A red call goes into your team’s queue at high priority.',
    ],
    code: 'agent/src/triage.ts',
    tone: 'coral',
    art: <ArtTriage />,
  },
  {
    title: 'Everything is written down',
    body: [
      'Each phone call leaves its transcript, outcome, language, triage band and reply times, with the appointments it made and the handovers it raised.',
      'Every row belongs to one practice, so a practice only ever sees its own.',
    ],
    code: 'db/src/schema.ts',
    tone: 'white',
    art: <ArtRows />,
  },
  {
    title: 'Your desk sees it',
    body: [
      'The dashboard refreshes every thirty seconds: the calls, how fast the first reply came, what was booked, and who needs a call back.',
      'Your own systems can read calls and appointments with a scoped key, and a phone call ends with a signed webhook.',
    ],
    code: 'api/dashboard · api/v1',
    tone: 'sage',
    art: <ArtDesk />,
  },
]

const FACTS = ['One model, speech to speech', '13 tools', '11 languages', 'Triage by fixed rules', 'Every row per practice']

export default function Pipeline() {
  useMotion()
  useLandingFx()
  const [year] = useState(() => new Date().getFullYear())

  return (
    <div className="lp mo pl">
      <Nav home={false} />

      {/* ── Momo's sky ───────────────────────────────────────────────────── */}
      <header className="pl-hero mo-hero" id="top">
        <Scene variant="sky" />
        <div className="pl-hero-in">
          <p className="mo-eyebrow" data-reveal>
            <i aria-hidden /> The pipeline
          </p>
          <h1 data-reveal style={{ '--i': 1 } as React.CSSProperties}>
            From the first ring
            <br />
            to your <em>dashboard</em>.
          </h1>
          <p className="pl-lede" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
            What happens to a call inside Vaani, end to end — the line, the model, the tools it reaches
            for, the rules it will not bend, and the record your team works from.
          </p>
          <ul className="pl-facts" data-reveal style={{ '--i': 3 } as React.CSSProperties}>
            {FACTS.map((f, i) => (
              <li key={f} style={{ '--f': i } as React.CSSProperties}>
                <i aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </div>
      </header>

      {/* ── CareFlow's board: the whole thing, moving ────────────────────── */}
      <section className="pl-overview" aria-label="The whole pipeline">
        <div className="lp-wrap">
          <div data-reveal>
            <PipelineBoard />
          </div>
          <ul className="pl-legend" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
            <li className="is-in">Caller’s voice</li>
            <li className="is-out">Desk’s voice</li>
            <li className="is-tool">A tool asked</li>
            <li className="is-write">A row written</li>
          </ul>
        </div>
      </section>

      {/* ── Stage by stage ───────────────────────────────────────────────── */}
      <section className="pl-stages">
        <div className="lp-wrap">
          <div className="mo-head">
            <h2 data-reveal>
              <span className="mo-wipe">Stage by stage.</span>
            </h2>
            <p data-reveal style={{ '--i': 1 } as React.CSSProperties}>
              Each part of the pipeline, what it does, and the file in the code it comes from.
            </p>
          </div>

          <ol className="pl-spine-list">
            <span className="pl-spine" aria-hidden>
              <i />
              <b />
            </span>
            {STAGES.map((s, i) => (
              <li key={s.title} className="pl-stage" data-reveal>
                <span className="pl-stage-dot mono" aria-hidden>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <article className={`pl-card is-${s.tone}`}>
                  <div className="pl-card-copy">
                    <p className="pl-card-n mono">Stage {String(i + 1).padStart(2, '0')}</p>
                    <h3>{s.title}</h3>
                    {s.body.map((b) => (
                      <p key={b}>{b}</p>
                    ))}
                    <p className="pl-code mono">
                      <Icon name="code" /> {s.code}
                    </p>
                  </div>
                  <div className="pl-art" aria-hidden>
                    {s.art}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The budgets ──────────────────────────────────────────────────── */}
      <section className="pl-budgets">
        <div className="lp-wrap">
          <div className="pl-budget-card" data-reveal>
            <div className="pl-budget-head">
              <h2>The time it is held to.</h2>
              <p>
                Targets, not claims: the budgets the console colours its live readout against, so a slow
                reply shows as slow.
              </p>
            </div>
            <dl>
              <div>
                <dt>Mouth to ear, typical</dt>
                <dd>
                  ≤700<small>ms</small>
                </dd>
              </div>
              <div>
                <dt>Mouth to ear, slowest 1 in 20</dt>
                <dd>
                  ≤1100<small>ms</small>
                </dd>
              </div>
              <div>
                <dt>Stops when talked over</dt>
                <dd>
                  120<small>ms</small>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ── Close ────────────────────────────────────────────────────────── */}
      <section className="mo-close pl-close">
        <Scene variant="garden" />
        <div className="mo-close-card" data-reveal>
          <h2>
            Hear it work,
            <br />
            end to end.
          </h2>
          <p>Take a call in the browser and watch each of these stages happen as you speak.</p>
          <div className="mo-ctas">
            <a className="mo-btn is-dark" href="/console">
              <Eq /> Take a call
            </a>
            <a className="mo-btn" href="/start">
              Set up your practice <Arrow />
            </a>
          </div>
        </div>
      </section>

      <Footer year={year} home={false} />
    </div>
  )
}

/* ── The small working pictures, one a stage ──────────────────────────────── */

const v = (n: number) => ({ '--v': n }) as React.CSSProperties

/** Voice leaving a phone and a browser and arriving at the session. */
function ArtLine() {
  return (
    <div className="art-line">
      <span className="art-end">
        <Icon name="phone" />
        <small>8 kHz</small>
      </span>
      <span className="art-wave">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={v(i)} />
        ))}
        <b />
      </span>
      <span className="art-end is-mid">
        <Icon name="socket" />
        <small>16 kHz</small>
      </span>
      <span className="art-wave is-back">
        {Array.from({ length: 18 }, (_, i) => (
          <i key={i} style={v(i)} />
        ))}
        <b />
      </span>
      <span className="art-end">
        <Icon name="globe" />
        <small>24 kHz</small>
      </span>
    </div>
  )
}

/** The model: in and out on one orb, and a turn cut short when talked over. */
function ArtModel() {
  return (
    <div className="art-model">
      <span className="art-bars is-in">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={v(i)} />
        ))}
      </span>
      <span className="art-orb">
        <i />
      </span>
      <span className="art-bars is-out">
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={v(i)} />
        ))}
      </span>
      <span className="art-chip">Talked over → stops</span>
    </div>
  )
}

/** The language turning, one finished turn at a time. */
function ArtLangs() {
  const langs = ['English', 'हिन्दी', 'Hinglish', 'मराठी', 'ગુજરાતી', 'বাংলা', 'தமிழ்', 'తెలుగు', 'ಕನ್ನಡ', 'മലയാളം', 'ਪੰਜਾਬੀ']
  return (
    <div className="art-langs">
      {langs.map((l, i) => (
        <span key={l} style={v(i)}>
          {l}
        </span>
      ))}
    </div>
  )
}

/** Tools asked and answered, one line after another. */
function ArtTools() {
  const lines: Array<[string, string]> = [
    ['lookup_patient', 'found by number'],
    ['check_availability', 'read live from the diary'],
    ['list_services', 'from the practice'],
    ['search_knowledge', 'from your pages'],
  ]
  return (
    <ol className="art-tools">
      {lines.map(([t, r], i) => (
        <li key={t} style={v(i)}>
          <code>{t}</code>
          <span>{r}</span>
        </li>
      ))}
    </ol>
  )
}

/** A slot read, held, re-checked and written. */
function ArtBook() {
  return (
    <div className="art-book">
      <div className="art-slots">
        <span className="is-taken">5:30</span>
        <span className="is-pick">6:15</span>
        <span>7:00</span>
      </div>
      <div className="art-checks">
        <span style={v(0)}>Read the diary</span>
        <span style={v(1)}>Re-checked in the transaction</span>
        <span style={v(2)} className="is-done">
          Booked
        </span>
      </div>
    </div>
  )
}

/** The three bands, and a call matched to red. */
function ArtTriage() {
  return (
    <div className="art-triage">
      <p className="art-said">“My face is swollen and I have a fever.”</p>
      <span className="art-band is-red">
        <b>Red</b> facial swelling · to your team, high priority
      </span>
      <span className="art-band is-amber">
        <b>Amber</b> severe pain · broken tooth
      </span>
      <span className="art-band is-green">
        <b>Green</b> everything else
      </span>
    </div>
  )
}

/** Rows landing in the practice's tables. */
function ArtRows() {
  const rows: Array<[string, string]> = [
    ['calls', 'transcript · outcome · band'],
    ['appointments', '6:15 pm · Dr. Iyer'],
    ['escalations', 'red · high'],
    ['call_events', 'the call, step by step'],
  ]
  return (
    <ul className="art-rows">
      {rows.map(([t, r], i) => (
        <li key={t} style={v(i)}>
          <span className="mono">{t}</span>
          <span>{r}</span>
          <i />
        </li>
      ))}
    </ul>
  )
}

/** A corner of the dashboard: a week drawn in, a callback waiting. */
function ArtDesk() {
  return (
    <div className="art-desk">
      <svg className="art-chart" viewBox="0 0 200 70" preserveAspectRatio="none">
        <path className="art-area" d="M0 70 L0 48 C 25 44, 35 30, 60 34 S 95 52, 120 36 S 160 10, 200 18 L200 70 Z" />
        <path className="art-line-p" d="M0 48 C 25 44, 35 30, 60 34 S 95 52, 120 36 S 160 10, 200 18" />
      </svg>
      <div className="art-callback">
        <span className="art-dot" />
        <span>
          <b>Needs a human</b>
          <small>Billing question it could not answer</small>
        </span>
        <span className="art-call">Call back</span>
      </div>
    </div>
  )
}
