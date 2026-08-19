import { describe, it, expect } from 'vitest'
import { detectLang } from './lang-detect'

describe('detectLang', () => {
  it('detects plain English', () => {
    const r = detectLang('I want to book an appointment for tomorrow')
    expect(r.lang).toBe('en-IN')
    expect(r.codeSwitched).toBe(false)
  })

  it('detects Devanagari Hindi', () => {
    const r = detectLang('मुझे कल अपॉइंटमेंट चाहिए')
    expect(r.lang).toBe('hi-IN')
    expect(r.confidence).toBeGreaterThan(0.9)
  })

  it('detects romanised Hindi', () => {
    const r = detectLang('mujhe kal appointment chahiye subah ke liye')
    expect(r.lang).toBe('hi-Latn-IN')
  })

  it('detects Hinglish as code-switched, not as one language or the other', () => {
    const r = detectLang('Mujhe kal morning ek appointment book karna hai for cleaning')
    expect(r.lang).toBe('hi-Latn-IN')
    expect(r.codeSwitched).toBe(true)
  })

  it('flags mixed-script input as code-switched', () => {
    const r = detectLang('मुझे Thursday ko appointment chahiye')
    expect(r.codeSwitched).toBe(true)
  })

  it('keeps the conversation language on a bare noun phrase', () => {
    // "root canal" carries no grammatical signal in either language.
    expect(detectLang('root canal', 'hi-Latn-IN').lang).toBe('hi-Latn-IN')
    expect(detectLang('root canal', 'en-IN').lang).toBe('en-IN')
  })

  it('returns low confidence when there is nothing to go on', () => {
    expect(detectLang('root canal').confidence).toBeLessThan(0.5)
  })

  it('handles an empty transcript without throwing', () => {
    expect(detectLang('')).toMatchObject({ confidence: 0 })
  })

  it('is more confident with more evidence', () => {
    const short = detectLang('i want')
    const long = detectLang('i want to book an appointment for my mother please')
    expect(long.confidence).toBeGreaterThanOrEqual(short.confidence)
  })

  it('reads a Hindi-dominant sentence with one English noun as Hinglish', () => {
    // Borrowed nouns are normal in Hindi speech; grammar decides the register.
    const r = detectLang('mujhe appointment chahiye')
    expect(r.lang).toBe('hi-Latn-IN')
  })
})
