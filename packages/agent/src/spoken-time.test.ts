import { describe, it, expect } from 'vitest'
import { spokenHours, spokenTime } from './spoken-time'

/**
 * How a time is said.
 *
 * The bug these guard: the formatter localised the weekday and left the clock
 * in English, so the model was handed "सोमवार at 12 thirty in the afternoon"
 * and said exactly that — "twelve बारह thirty". Half a sentence in each
 * language is worse than either one.
 */
const at = (h: number, m: number) => {
  // A Monday, so the weekday is stable across runs.
  const d = new Date(2026, 7, 31, h, m, 0)
  return d.toISOString()
}

describe('spokenTime — Hindi', () => {
  it('says half past with साढ़े, not "twelve thirty"', () => {
    const { phrase } = spokenTime(at(12, 30), 'hi-IN')
    expect(phrase).toContain('साढ़े बारह')
    expect(phrase).not.toMatch(/thirty|12:30|\bat\b/)
  })

  it('uses the irregular words for half past one and two', () => {
    // डेढ़ and ढाई are their own words; "साढ़े एक" is not something anyone says.
    expect(spokenTime(at(13, 30), 'hi-IN').phrase).toContain('डेढ़')
    expect(spokenTime(at(14, 30), 'hi-IN').phrase).toContain('ढाई')
    expect(spokenTime(at(13, 30), 'hi-IN').phrase).not.toContain('साढ़े')
  })

  it('counts the quarters in words', () => {
    expect(spokenTime(at(11, 15), 'hi-IN').phrase).toContain('सवा ग्यारह')
    // A quarter to four is "पौने चार", counted from the hour ahead.
    expect(spokenTime(at(15, 45), 'hi-IN').phrase).toContain('पौने चार')
  })

  it('names the part of the day in Hindi', () => {
    expect(spokenTime(at(9, 0), 'hi-IN').phrase).toContain('सुबह')
    expect(spokenTime(at(13, 0), 'hi-IN').phrase).toContain('दोपहर')
    expect(spokenTime(at(19, 0), 'hi-IN').phrase).toContain('शाम')
  })

  it('carries no Latin letters at all', () => {
    // One Latin word is all it takes for the reply to come out as a hybrid.
    for (const [h, m] of [[9, 0], [12, 30], [15, 45], [18, 15], [20, 10]] as const) {
      expect(spokenTime(at(h, m), 'hi-IN').phrase).not.toMatch(/[A-Za-z]/)
    }
  })
})

describe('spokenTime — Marathi', () => {
  it('uses Marathi words, not Hindi ones', () => {
    expect(spokenTime(at(12, 30), 'mr-IN').phrase).toContain('साडे बारा')
    expect(spokenTime(at(13, 30), 'mr-IN').phrase).toContain('दीड')
    expect(spokenTime(at(14, 30), 'mr-IN').phrase).toContain('अडीच')
  })

  it('names the part of the day in Marathi', () => {
    expect(spokenTime(at(9, 0), 'mr-IN').phrase).toContain('सकाळी')
    expect(spokenTime(at(19, 0), 'mr-IN').phrase).toContain('संध्याकाळी')
  })
})

describe('spokenTime — Hinglish', () => {
  it('is romanised throughout, never Devanagari', () => {
    const { phrase } = spokenTime(at(12, 30), 'hi-Latn-IN')
    expect(phrase).toContain('saadhe')
    expect(phrase).not.toMatch(/[ऀ-ॿ]/)
  })
})

describe('spokenTime — English and the rest', () => {
  it('reads normally in English', () => {
    const { phrase, native } = spokenTime(at(12, 30), 'en-IN')
    expect(phrase).toContain('12 thirty')
    expect(phrase).toContain('in the afternoon')
    expect(native).toBe(true)
  })

  it('flags a language whose idiom is not written out, so the model renders it', () => {
    // Better an honest "say this natively" than this file guessing at Tamil.
    const { native } = spokenTime(at(12, 30), 'ta-IN')
    expect(native).toBe(false)
  })

  it('survives a locale the platform does not know', () => {
    expect(() => spokenTime(at(10, 0), 'kn-IN')).not.toThrow()
  })
})

/**
 * The opening hours are the most-asked question on the line, and they arrive
 * from the practice record as a 24-hour range. Read back as digits in a Hindi
 * sentence they were correct and foreign: "सुबह 9:00 बजे से शाम 7:00 बजे तक".
 */
describe('spokenHours', () => {
  it('writes a Hindi range in words, keeping the days as they are', () => {
    expect(spokenHours('Mon–Sat 9:00–19:00', 'hi-IN')).toBe('Mon–Sat सुबह नौ बजे–शाम सात बजे')
  })

  it('carries the half hour into the idiom', () => {
    expect(spokenHours('9:30–13:30', 'hi-IN')).toBe('सुबह साढ़े नौ–दोपहर डेढ़')
  })

  it('writes Marathi in Marathi', () => {
    expect(spokenHours('10:00–18:00', 'mr-IN')).toBe('सकाळी दहा वाजता–संध्याकाळी सहा वाजता')
  })

  it('leaves English alone', () => {
    expect(spokenHours('Mon–Sat 9:00–19:00', 'en-IN')).toBe('Mon–Sat 9:00–19:00')
  })

  it('leaves a language whose idiom is not written out alone', () => {
    expect(spokenHours('9:00–19:00', 'ta-IN')).toBe('9:00–19:00')
  })

  it('carries no digits into a Hindi line', () => {
    expect(spokenHours('Mon–Sat 9:00–19:00', 'hi-IN')).not.toMatch(/[0-9]/)
  })

  it('passes through anything that is not a clock', () => {
    expect(spokenHours('By appointment only', 'hi-IN')).toBe('By appointment only')
    expect(spokenHours('call 022 2640 1234', 'hi-IN')).toBe('call 022 2640 1234')
  })

  it('refuses an impossible clock rather than inventing an hour', () => {
    expect(spokenHours('25:99', 'hi-IN')).toBe('25:99')
  })
})
