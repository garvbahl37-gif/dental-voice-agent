import { describe, it, expect } from 'vitest'
import { cacheKey, PHRASES, PHRASE_KEYS, phrase } from './phrase-cache'
import { marksFromAlignment } from './cloud'
import { ALL_LANGS } from '@vaani/shared'

describe('cacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).toBe(cacheKey('hello', 'v1', 'en-IN', 'flash'))
  })

  it('changes when the voice changes', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(
      cacheKey('hello', 'v2', 'en-IN', 'flash'),
    )
  })

  it('changes when the language changes', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(
      cacheKey('hello', 'v1', 'hi-IN', 'flash'),
    )
  })

  it('changes when the model changes, so a voice-model upgrade invalidates', () => {
    expect(cacheKey('hello', 'v1', 'en-IN', 'flash')).not.toBe(
      cacheKey('hello', 'v1', 'en-IN', 'turbo'),
    )
  })
})

describe('PHRASES', () => {
  it('covers every phrase in every supported language', () => {
    for (const key of PHRASE_KEYS) {
      for (const lang of ALL_LANGS) {
        expect(PHRASES[key][lang], `${key}/${lang}`).toBeTruthy()
      }
    }
  })

  it('writes Hindi in Devanagari and Hinglish in Latin script', () => {
    for (const key of PHRASE_KEYS) {
      expect(PHRASES[key]['hi-IN'], `${key} hi-IN`).toMatch(/[ऀ-ॿ]/)
      expect(PHRASES[key]['hi-Latn-IN'], `${key} hi-Latn-IN`).not.toMatch(/[ऀ-ॿ]/)
    }
  })

  it('resolves a phrase by key and language', () => {
    expect(phrase('hold', 'hi-Latn-IN')).toBe('Ek second, main dekhti hoon.')
  })

  it('has enough phrases to cover the common path of a call', () => {
    expect(PHRASE_KEYS.length).toBeGreaterThanOrEqual(20)
  })
})

describe('marksFromAlignment', () => {
  it('folds character timings into word marks', () => {
    const chars = ['H', 'i', ' ', 't', 'h', 'e', 'r', 'e']
    const starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]
    const durations = [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]
    expect(marksFromAlignment(chars, starts, durations)).toEqual([
      { word: 'Hi', startMs: 0, endMs: 200 },
      { word: 'there', startMs: 300, endMs: 800 },
    ])
  })

  it('returns nothing for empty alignment', () => {
    expect(marksFromAlignment([], [], [])).toEqual([])
  })

  it('handles a trailing word with no closing space', () => {
    expect(marksFromAlignment(['o', 'k'], [0, 0.1], [0.1, 0.1])).toEqual([
      { word: 'ok', startMs: 0, endMs: 200 },
    ])
  })
})
