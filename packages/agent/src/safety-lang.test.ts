import { describe, it, expect } from 'vitest'
import { ALL_LANGS, SCRIPT_RANGES, scriptOf } from '@vaani/shared'
import { guard } from './safety'
import { triage } from './triage'

/**
 * The safety text, in every language.
 *
 * These two are the highest-stakes strings in the system: a refusal is what a
 * caller hears the moment the guard blocks a clinical claim, and a triage
 * script is what they hear when something might be an emergency. An untranslated
 * entry does not throw — it falls back to English mid-sentence, at exactly the
 * moment comprehension matters most — so completeness is asserted rather than
 * assumed.
 */

const CLINICAL = 'You have an abscess and I am prescribing you antibiotics.'

describe('clinical refusals', () => {
  for (const lang of ALL_LANGS) {
    it(`refuses in ${lang}`, () => {
      const r = guard(CLINICAL, lang)
      expect(r.safe).toBe(false)
      expect(r.text.length).toBeGreaterThan(10)
    })
  }

  it('answers in the caller’s own script, not a transliteration', () => {
    for (const lang of ALL_LANGS) {
      const script = scriptOf(lang)
      if (script === 'latin') continue
      const { text } = guard(CLINICAL, lang)
      expect(SCRIPT_RANGES[script].test(text), `${lang} refusal is not in its script`).toBe(true)
    }
  })

  it('gives a different refusal per language', () => {
    // A map that quietly repeats one string would pass the checks above.
    const texts = ALL_LANGS.map((l) => guard(CLINICAL, l).text)
    expect(new Set(texts).size).toBeGreaterThan(ALL_LANGS.length - 2)
  })
})

describe('triage scripts', () => {
  const emergency = triage('my tooth was knocked out and it is bleeding a lot')

  it('has a script for every language', () => {
    for (const lang of ALL_LANGS) {
      expect(emergency.script[lang], `triage script for ${lang}`).toBeTruthy()
    }
  })

  it('reads the emergency script in the caller’s script', () => {
    for (const lang of ALL_LANGS) {
      const script = scriptOf(lang)
      if (script === 'latin') continue
      expect(SCRIPT_RANGES[script].test(emergency.script[lang]), `${lang}`).toBe(true)
    }
  })
})
