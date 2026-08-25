'use client'

import { ALL_LANGS, LANG_LABEL, LANG_ENGLISH, htmlLang } from '@vaani/shared'

/**
 * The page's two moving fixtures.
 *
 * Both are drawn from what the product actually is rather than added as
 * decoration: a voice has a waveform, and this desk's distinguishing feature is
 * the eleven scripts it answers in. Neither invents an idea the page does not
 * already make.
 */

/**
 * An idle waveform, behind the hero.
 *
 * Bars, not a sine curve — a sine curve reads as a logo, bars read as a live
 * level meter, which is what the console actually shows during a call. The
 * heights and delays are fixed rather than random so the page renders the same
 * on the server as in the browser.
 */
const BARS = [
  18, 63, 47, 73, 55, 56, 42, 51, 68, 55, 70, 33,
  53, 35, 72, 54, 67, 47, 45, 58, 58, 72, 46, 60,
  23, 67, 47, 73, 51, 53, 45, 55, 69, 56, 67, 31,
  57, 36, 74, 52, 65, 42, 50, 60, 60, 71, 45, 56,
  28, 69, 47, 73, 48, 51, 47, 59, 69, 56, 64, 29,
  60, 37, 75, 49, 63, 38, 54, 62, 62, 69, 44, 52,
]

export function Waveform() {
  return (
    <div className="lp-wave" aria-hidden>
      {BARS.map((h, i) => (
        <span
          key={i}
          className="lp-wave-bar"
          style={{ '--h': `${h}%`, '--i': i } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

/**
 * The eleven languages, moving past.
 *
 * Each in its own script, which is the whole point — a list of English names
 * would say the same thing and show none of it. The row is duplicated so the
 * loop has no seam, and the copy is hidden from assistive technology so the
 * languages are announced once rather than twice.
 */
export function LanguageRiver() {
  const run = ALL_LANGS.map((l) => (
    <span key={l} className="lp-river-item">
      <span className="lp-river-native" lang={htmlLang(l)}>
        {LANG_LABEL[l]}
      </span>
      <span className="lp-river-en">{LANG_ENGLISH[l]}</span>
    </span>
  ))

  return (
    <div className="lp-river" role="group" aria-label="The languages it answers in">
      <div className="lp-river-track">
        <div className="lp-river-run">{run}</div>
        <div className="lp-river-run" aria-hidden>
          {ALL_LANGS.map((l) => (
            <span key={l} className="lp-river-item">
              <span className="lp-river-native" lang={htmlLang(l)}>
                {LANG_LABEL[l]}
              </span>
              <span className="lp-river-en">{LANG_ENGLISH[l]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A headline whose words arrive in order.
 *
 * Split on words, not characters. Per-character staggering is the effect this
 * is usually reached for, and on a sentence this long it produces a wall of
 * spans that screen readers read letter by letter and that costs a hundred
 * nodes for a second of motion. Words carry the same sense of the line being
 * spoken, and a word is still a word to a reader.
 *
 * The spaces are text nodes *between* the spans, never inside them. A word has
 * to be `inline-block` to be moved at all, and an inline-block swallows its own
 * trailing whitespace — which ran the first draft's headline together as
 * "Yourphone ringsin".
 */
export interface Word {
  t: string
  cls?: string
  lang?: string
}

export function Spoken({ words }: { words: Word[] }) {
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          {i > 0 ? ' ' : null}
          <span
            className={`lp-word${w.cls ? ` ${w.cls}` : ''}`}
            lang={w.lang}
            style={{ '--i': i } as React.CSSProperties}
          >
            {w.t}
          </span>
        </span>
      ))}
    </>
  )
}
