import { describe, it, expect } from 'vitest'
import {
  ALL_LANGS,
  LANG_LABEL,
  LANG_ENGLISH,
  LANG_CHIP,
  LangSchema,
  accentFor,
  htmlLang,
  scriptOf,
} from './lang'

describe('language table', () => {
  it('names every language in all of the maps', () => {
    // A missing entry renders as `undefined` in the picker rather than failing,
    // so it has to be caught here.
    for (const l of ALL_LANGS) {
      expect(LANG_LABEL[l], `label for ${l}`).toBeTruthy()
      expect(LANG_ENGLISH[l], `english name for ${l}`).toBeTruthy()
      expect(LANG_CHIP[l], `chip for ${l}`).toBeTruthy()
    }
  })

  it('names each language in its own script', () => {
    // The point of the picker: nobody looks for their language in English.
    expect(LANG_LABEL['ta-IN']).toBe('தமிழ்')
    expect(LANG_LABEL['ml-IN']).toBe('മലയാളം')
    expect(LANG_LABEL['bn-IN']).toBe('বাংলা')
  })

  it('accepts every listed language and rejects anything else', () => {
    for (const l of ALL_LANGS) expect(LangSchema.safeParse(l).success).toBe(true)
    expect(LangSchema.safeParse('fr-FR').success).toBe(false)
    expect(LangSchema.safeParse('ta').success).toBe(false)
  })
})

describe('accentFor', () => {
  it('gives each language its own accent', () => {
    /**
     * This is the guard on a real bug: an earlier version bucketed every Indian
     * language into "hi", so switching from Tamil to Malayalam looked like no
     * change and the session kept the wrong accent for the rest of the call.
     */
    const accents = ALL_LANGS.filter((l) => l !== 'hi-Latn-IN').map(accentFor)
    expect(new Set(accents).size).toBe(accents.length)
  })

  it('speaks Hinglish with the Hindi accent', () => {
    // Hinglish *is* Hindi speech that borrows English nouns.
    expect(accentFor('hi-Latn-IN')).toBe('hi-IN')
    expect(accentFor('ta-IN')).toBe('ta-IN')
  })
})

describe('htmlLang', () => {
  it('gives a tag the browser can pick a font from', () => {
    expect(htmlLang('ta-IN')).toBe('ta')
    expect(htmlLang('en-IN')).toBe('en')
  })

  it('keeps Hinglish distinguishable from Hindi', () => {
    // Same language, different script — the font must follow the script.
    expect(htmlLang('hi-IN')).toBe('hi')
    expect(htmlLang('hi-Latn-IN')).toBe('hi-Latn')
  })
})

describe('scriptOf', () => {
  it('routes romanised Hindi to the Latin stack', () => {
    expect(scriptOf('hi-Latn-IN')).toBe('latin')
    expect(scriptOf('hi-IN')).toBe('devanagari')
    expect(scriptOf('mr-IN')).toBe('devanagari')
  })
})
