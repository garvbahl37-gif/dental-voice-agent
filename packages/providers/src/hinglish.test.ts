import { describe, it, expect } from 'vitest'
import { forSpeech, hinglishForSpeech } from './hinglish'

describe('hinglishForSpeech', () => {
  it('converts the phrase that exposed the bug', () => {
    // "theek rahega" read with English phonetics is what produced the mangled
    // pronunciation the practice heard.
    const { text } = hinglishForSpeech('Aapko Thursday subah ka slot theek rahega?')
    expect(text).toBe('आपको Thursday सुबह का slot ठीक रहेगा?')
  })

  it('keeps English words in Latin so they are pronounced as English', () => {
    const { text } = hinglishForSpeech('Main appointment book kar deti hoon')
    expect(text).toContain('appointment')
    expect(text).toContain('book')
    expect(text).toContain('मैं')
  })

  it('converts a greeting', () => {
    expect(hinglishForSpeech('Namaste, main Priya bol rahi hoon.').text).toBe(
      'नमस्ते, मैं Priya बोल रही हूँ.',
    )
  })

  it('handles dental vocabulary', () => {
    const { text } = hinglishForSpeech('Aapke daant mein dard hai?')
    expect(text).toBe('आपके दांत में दर्द है?')
  })

  it('preserves punctuation and spacing', () => {
    const { text } = hinglishForSpeech('Haan ji, theek hai!')
    expect(text).toBe('हाँ जी, ठीक है!')
  })

  it('leaves numerals alone', () => {
    expect(hinglishForSpeech('Aapka number 9876543210 hai?').text).toContain('9876543210')
  })

  it('reports how many tokens it converted', () => {
    expect(hinglishForSpeech('main aapko bata deti hoon').converted).toBeGreaterThan(3)
    expect(hinglishForSpeech('Thursday morning appointment').converted).toBe(0)
  })

  it('leaves an unknown word alone rather than guessing', () => {
    // A wrong transliteration is worse than none: an unrecognised Latin token
    // is far more likely to be an English word or a proper noun.
    expect(hinglishForSpeech('Dr Sharma ka clinic').text).toContain('Sharma')
  })
})

describe('forSpeech', () => {
  it('passes English through untouched', () => {
    const s = 'Thursday at four is free with Dr. Sharma.'
    expect(forSpeech(s, 'en-IN')).toBe(s)
  })

  it('passes Devanagari through untouched', () => {
    const s = 'नमस्ते, मैं प्रिया बोल रही हूँ।'
    expect(forSpeech(s, 'hi-IN')).toBe(s)
  })

  it('transliterates Hinglish', () => {
    expect(forSpeech('subah ka slot theek hai', 'hi-Latn-IN')).toBe('सुबह का slot ठीक है')
  })

  it('is idempotent on already-converted text', () => {
    const once = forSpeech('subah ka slot theek hai', 'hi-Latn-IN')
    expect(forSpeech(once, 'hi-Latn-IN')).toBe(once)
  })

  it('converts every Hindi word while leaving borrowed English words alone', () => {
    // "time" is genuinely English in this register — Hindi speakers borrow it,
    // and it should be pronounced as English, not transliterated.
    const out = forSpeech('mujhe kal subah ka time chahiye', 'hi-Latn-IN')
    expect(out).toBe('मुझे कल सुबह का time चाहिए')
  })

  it('leaves nothing in Latin when the clause has no English words', () => {
    expect(forSpeech('mujhe kal subah chahiye', 'hi-Latn-IN')).not.toMatch(/[A-Za-z]/)
  })
})
