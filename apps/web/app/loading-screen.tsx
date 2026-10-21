'use client'

import { useEffect, useId, useState } from 'react'
import './loading-screen.css'

/**
 * What the app shows while it is opening — and, on the landing page, the
 * opening itself.
 *
 * Everything is centred on one point. There the orb from the hero sits, drawn
 * in CSS so it is on screen before any script has run: a glass sphere whose
 * rim turns and whose band sweeps across it, a green arc sweeping round it as
 * the thing being waited for, and sound leaving it in rings. Behind, a slow
 * aurora and faint orbits; below, the wordmark rising a letter at a time and
 * the same greeting turning through the scripts the desk answers in.
 *
 * It lifts by opening: a hole grows from the orb outward until the page
 * underneath is all there is, as though the page came out of the orb. Shown
 * over the page's skeleton rather than instead of it, so the layout underneath
 * is already the right shape. `done` starts the exit; the component removes
 * itself once it has run.
 */

/** "Hello", in the languages the desk answers in. Cycled by CSS alone. */
const HELLO: Array<[string, string]> = [
  ['Hello', 'en'],
  ['नमस्ते', 'hi'],
  ['வணக்கம்', 'ta'],
  ['નમસ્તે', 'gu'],
  ['নমস্কার', 'bn'],
  ['నమస్కారం', 'te'],
  ['ನಮಸ್ಕಾರ', 'kn'],
  ['നമസ്കാരം', 'ml'],
  ['ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ', 'pa'],
  ['नमस्कार', 'mr'],
]

/** How long the exit runs, so the component can leave when it has. */
const EXIT_MS = 820

export function LoadingScreen({ label = 'Opening the front desk', done = false }: { label?: string; done?: boolean }) {
  const [gone, setGone] = useState(false)
  // The arc's gradient is referenced by id; two screens can briefly overlap
  // during a navigation, and a shared id would paint one with the other's.
  const grad = `ls-g${useId().replace(/:/g, '')}`

  useEffect(() => {
    if (!done) {
      setGone(false)
      return
    }
    const t = window.setTimeout(() => setGone(true), EXIT_MS)
    return () => window.clearTimeout(t)
  }, [done])

  if (gone) return null

  return (
    <div className={`ls${done ? ' is-leaving' : ''}`} role="status" aria-live="polite">
      <div className="ls-sky" aria-hidden>
        <span className="ls-aurora a1" />
        <span className="ls-aurora a2" />
        <span className="ls-orbit o1" />
        <span className="ls-orbit o2" />
        <span className="ls-orbit o3" />
      </div>

      <div className="ls-stage" aria-hidden>
        <span className="ls-ping" />
        <span className="ls-ping p2" />
        <svg className="ls-ring" viewBox="0 0 168 168">
          <defs>
            <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#9be8b0" />
              <stop offset="55%" stopColor="#34c759" />
              <stop offset="100%" stopColor="#1f9d47" />
            </linearGradient>
          </defs>
          <circle className="ls-track" cx="84" cy="84" r="78" />
          <g className="ls-sweep">
            <circle className="ls-arc" cx="84" cy="84" r="78" stroke={`url(#${grad})`} />
          </g>
        </svg>
        <span className="ls-orb">
          <i className="ls-band" />
          <i className="ls-band b2" />
          <i className="ls-shine" />
        </span>
      </div>

      <div className="ls-text">
        <p className="ls-word" aria-hidden>
          {'Vaani'.split('').map((c, i) => (
            <span key={i} style={{ '--l': i } as React.CSSProperties}>
              {c}
            </span>
          ))}
        </p>
        <p className="ls-hello" aria-hidden>
          {HELLO.map(([w, lang], i) => (
            <span key={lang} lang={lang} style={{ '--g': i } as React.CSSProperties}>
              {w}
            </span>
          ))}
        </p>
        <p className="ls-label">
          {label}
          <span className="ls-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </p>
      </div>
    </div>
  )
}
