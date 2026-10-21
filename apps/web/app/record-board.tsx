'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { VoiceBlob } from '@/components/VoiceBlob'
import './record-board.css'

/**
 * The call becoming the record — the panel under the hero.
 *
 * The two references together. CareFlow's board: a big dark card where its
 * video call plays, and beside it white, black and sage cards. Momo's glass,
 * green and orb inside them. Here the dark card is the call itself — the orb,
 * a live timer, the language the caller is in, and what is said running
 * underneath as captions, word by word. The cards beside it fill in as the
 * call reaches each fact: the treatment once it is named, the branch once it
 * is chosen, the slot once the diary offers it, the name once it is given,
 * and the booking once it is written. A rail along the foot says how far the
 * call has got, from "Heard" to "Written to the diary".
 *
 * Authored, not recorded — but every fact is drawn from the seeded practice:
 * real branches, a real dentist, a real service. The caller opens in
 * Hinglish, moves to Devanagari, and closes in English — the three registers
 * an Indian front desk actually hears, in one call. It plays while it is on
 * screen, rests, and plays again; finished at once for reduced motion.
 */

type Turn = { who: 'caller' | 'desk'; at: string; text: string; lang?: string; said?: string }

const CALL: Turn[] = [
  { who: 'caller', at: '0:04', text: 'Haan hi, mujhe cleaning ke liye appointment chahiye tha.', lang: 'hi-Latn', said: 'Hinglish' },
  { who: 'desk', at: '0:07', text: 'Bilkul — scaling and polishing. Bandra, Andheri ya Powai, kaun si branch aapke paas hai?', lang: 'hi-Latn' },
  { who: 'caller', at: '0:13', text: 'बांद्रा। कल शाम को कुछ मिल जाएगा?', lang: 'hi', said: 'हिन्दी' },
  { who: 'desk', at: '0:17', text: 'कल शाम डॉक्टर कविता अय्यर के पास सवा छह बजे का समय खाली है। बुक कर दूँ?', lang: 'hi' },
  { who: 'caller', at: '0:23', text: 'Yes, please. Ravi Menon.', said: 'English' },
  { who: 'desk', at: '0:27', text: 'Done, Ravi — 6:15 tomorrow with Dr. Iyer at Bandra.' },
]

/** How far the call has to have got for each step on the rail to be done. */
const STEPS: Array<[string, number]> = [
  ['Heard', 1],
  ['Understood', 2],
  ['Checked the diary', 4],
  ['Confirmed', 5],
  ['Written to the diary', 6],
]

/** Long enough to read the line as its words arrive, never a wait. */
const pace = (t: Turn) => Math.min(3200, 1200 + t.text.split(/\s+/).length * 150)

/**
 * Plays the call while it is on screen, one turn at a time, rests on the
 * finished record, and plays again. Holds still while scrolled away.
 */
function usePlayback(ref: React.RefObject<HTMLElement | null>) {
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const [shown, setShown] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [ref])

  useEffect(() => {
    if (!visible || reduced) return
    const t =
      shown >= CALL.length
        ? window.setTimeout(() => setShown(0), 7000)
        : window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 500 : pace(CALL[shown - 1]!))
    return () => window.clearTimeout(t)
  }, [visible, shown, reduced])

  return [reduced ? CALL.length : shown, () => setShown(0)] as const
}

export function ProductPanel() {
  const root = useRef<HTMLDivElement>(null)
  const [shown, replay] = usePlayback(root)

  const now = shown > 0 ? CALL[shown - 1]! : null
  const before = shown > 1 ? CALL[shown - 2]! : null
  const heard = CALL.slice(0, shown)
  const language = [...heard].reverse().find((t) => t.said)?.said
  const done = STEPS.filter(([, at]) => shown >= at).length

  const named = shown >= 2 // the desk names the treatment
  const branch = shown >= 3 // the caller chooses Bandra
  const offered = shown >= 4 // the diary's slot is offered
  const given = shown >= 5 // the caller gives a name
  const booked = shown >= 6 // written to the diary

  return (
    <div className="mo-panel-wrap" ref={root}>
      <span className="mo-drop" data-reveal aria-hidden />
      <div className="mo-panel rb" data-reveal style={{ '--i': 1 } as React.CSSProperties}>
        {/* ── The call, in CareFlow's big dark card ─────────────────────── */}
        <section className="rb-call" aria-label="Call transcript">
          <header className="rb-call-top">
            <span className="rb-live">
              <i aria-hidden /> {shown > 0 && shown < CALL.length ? 'On the call' : shown >= CALL.length ? 'Call ended' : 'Ringing'}
            </span>
            <span className="rb-time mono">{now?.at ?? '0:00'}</span>
            <span className="rb-lang" aria-label="Language the caller is speaking">
              {language ? (
                <span key={language} className="rb-in">
                  {language}
                </span>
              ) : (
                '—'
              )}
            </span>
            <button className="rb-replay" onClick={replay} aria-label="Play the call again">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5.5v13l10-6.5z" />
              </svg>
            </button>
          </header>

          <div className="rb-orb">
            <span className={`rb-orb-ring${now?.who === 'caller' ? ' is-caller' : ''}`} aria-hidden />
            <VoiceBlob
              state={!now ? 'idle' : now.who === 'desk' ? 'speaking' : 'listening'}
              micLevel={now?.who === 'caller' ? 0.3 : 0}
              agentLevel={now?.who === 'desk' ? 0.3 : 0}
              spectrum={empty}
              live={false}
            />
          </div>

          {/* Captions: the line before, dimmed, and the line now, arriving a
              word at a time as though it were being said. */}
          <div className="rb-caps" aria-live="polite">
            {before && (
              <p key={`b${shown}`} className={`rb-cap is-before is-${before.who}`} lang={before.lang}>
                <b>{before.who === 'caller' ? 'Caller' : 'Front desk'}</b>
                {before.text}
              </p>
            )}
            {now ? (
              <p key={`n${shown}`} className={`rb-cap is-now is-${now.who}`} lang={now.lang}>
                <b>
                  {now.who === 'caller' ? 'Caller' : 'Front desk'} <span className="mono">{now.at}</span>
                </b>
                {now.text.split(' ').map((w, i) => (
                  <span key={i} className="rb-w" style={{ '--w': i } as React.CSSProperties}>
                    {w}{' '}
                  </span>
                ))}
              </p>
            ) : (
              <p className="rb-cap is-wait">A patient is calling Smile Dental Care…</p>
            )}
          </div>
        </section>

        {/* ── What the call became, in CareFlow's cards ─────────────────── */}
        <div className="rb-side">
          <section className="rb-card rb-appt" aria-label="Appointment">
            <header className="rb-head">
              <span>Appointment</span>
              <span className={`rb-pill${booked ? ' is-booked' : offered ? ' is-held' : branch ? ' is-busy' : ''}`}>
                {booked ? (
                  <>
                    <Tick /> Booked
                  </>
                ) : offered ? (
                  'Offered'
                ) : branch ? (
                  <>
                    <i className="rb-spin" aria-hidden /> Checking the diary
                  </>
                ) : (
                  'Waiting'
                )}
              </span>
            </header>
            <p className="rb-when">
              <Fill on={offered} w="58%">
                6:15 pm
              </Fill>
              <small>
                <Fill on={offered} w="34%">
                  Tomorrow · Scaling &amp; polishing
                </Fill>
              </small>
            </p>
            <dl className="rb-pairs">
              <div>
                <dt>Branch</dt>
                <dd>
                  <Fill on={branch} w="70%">
                    Bandra
                  </Fill>
                </dd>
              </div>
              <div>
                <dt>Dentist</dt>
                <dd>
                  <Fill on={offered} w="80%">
                    Dr. Kavita Iyer
                  </Fill>
                </dd>
              </div>
            </dl>
            {/* The evening in the diary: two times already taken, and the
                caller's slot held while it is offered, then written in. */}
            <div className={`rb-day${offered ? ' is-held' : ''}${booked ? ' is-booked' : ''}`} aria-hidden>
              <div className="rb-day-track">
                <span className="rb-taken t1" />
                <span className="rb-taken t2" />
                <span className="rb-slot">{booked ? 'Ravi M.' : ''}</span>
              </div>
              <div className="rb-day-hours">
                <span>5 pm</span>
                <span>6</span>
                <span>7</span>
                <span>8 pm</span>
              </div>
            </div>
          </section>

          <section className="rb-card is-ink rb-patient" aria-label="Patient">
            <header className="rb-head">
              <span>Patient</span>
            </header>
            <div className="rb-who">
              <span className={`rb-initials${given ? ' is-on' : ''}`} aria-hidden>
                {given ? 'RM' : '?'}
              </span>
              <span className="rb-name">
                <Fill on={given} w="80%">
                  Ravi Menon
                </Fill>
              </span>
            </div>
            <div className="rb-langs" aria-label="Languages spoken">
              {['Hinglish', 'हिन्दी', 'English'].map((l) => (
                <span key={l} className={heard.some((t) => t.said === l) ? 'is-on' : undefined}>
                  {l}
                </span>
              ))}
            </div>
          </section>

          <section className="rb-card is-sage rb-reason" aria-label="Visit reason">
            <header className="rb-head">
              <span>Visit reason</span>
            </header>
            <p className="rb-treat">
              <Fill on={named} w="90%">
                Scaling &amp; polishing
              </Fill>
            </p>
            <div className="rb-tags">
              {named && <span className="rb-in">Cleaning</span>}
              {branch && <span className="rb-in">Evening slot</span>}
            </div>
          </section>
        </div>

        {/* ── How far the call has got ──────────────────────────────────── */}
        <ol className="rb-steps" aria-label="Progress of the call">
          <span className="rb-steps-rail" aria-hidden>
            <i style={{ transform: `scaleX(${Math.min(done, STEPS.length - 1) / (STEPS.length - 1)})` }} />
          </span>
          {STEPS.map(([s], i) => (
            <li key={s} className={i < done ? 'is-done' : i === done ? 'is-now' : undefined}>
              <span className="rb-step-dot" aria-hidden>
                {i < done ? <Tick /> : i + 1}
              </span>
              <span className="rb-step-k">{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mo-caption" data-reveal style={{ '--i': 2 } as React.CSSProperties}>
        Every call becomes the record your desk needs — what was said, and what went into the diary.
      </p>
    </div>
  )
}

/** A value once the call has reached it; a shimmering placeholder until then. */
function Fill({ on, w, children }: { on: boolean; w: string; children: React.ReactNode }) {
  return on ? (
    <span className="rb-in">{children}</span>
  ) : (
    <span className="rb-sk" style={{ '--sk': w } as React.CSSProperties} aria-hidden />
  )
}

function Tick() {
  return (
    <svg className="rb-tick" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

const empty = () => new Uint8Array(0)
