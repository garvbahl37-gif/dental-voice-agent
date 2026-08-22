import { describe, it, expect } from 'vitest'
import { voiceGender } from './voice'

describe('voiceGender', () => {
  it('follows the voice that is actually configured', () => {
    expect(voiceGender('Leda')).toBe('feminine')
    expect(voiceGender('Puck')).toBe('masculine')
  })

  it('assumes the shipped voice for one it does not know', () => {
    // Guessing from an unfamiliar name would be worse than matching Leda, which
    // is what ships and what the default prompt is written for.
    expect(voiceGender('Sulafat')).toBe('feminine')
  })

  it('lets the override win', () => {
    expect(voiceGender('Leda', 'masculine')).toBe('masculine')
    expect(voiceGender('Puck', 'feminine')).toBe('feminine')
  })

  it('ignores an override that is not a gender', () => {
    expect(voiceGender('Puck', 'yes please')).toBe('masculine')
    expect(voiceGender('Puck', '')).toBe('masculine')
  })
})
