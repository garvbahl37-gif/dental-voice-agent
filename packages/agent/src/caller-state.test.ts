import { describe, it, expect } from 'vitest'
import {
  confirm, describeState, emptyCallerState, normalisePhone,
  remember, speakPhone, wasCorrected,
} from './caller-state'

describe('caller state — corrections supersede (spec §25)', () => {
  it('replaces a value rather than keeping both', () => {
    let s = emptyCallerState()
    s = remember(s, 'preferredTime', 'tomorrow')
    s = remember(s, 'preferredTime', 'Thursday')
    expect(s.preferredTime?.value).toBe('Thursday')
  })

  it('remembers what it was, so the change can be acknowledged', () => {
    let s = emptyCallerState()
    s = remember(s, 'preferredTime', 'tomorrow')
    s = remember(s, 'preferredTime', 'Thursday')
    expect(s.preferredTime?.previous).toBe('tomorrow')
    expect(wasCorrected(s, 'preferredTime')).toBe(true)
  })

  it('drops confirmation when a value is corrected', () => {
    // A corrected number has not been read back yet.
    let s = emptyCallerState()
    s = confirm(remember(s, 'phone', '9876543210'), 'phone')
    s = remember(s, 'phone', '9123456780')
    expect(s.phone?.confirmed).toBe(false)
  })

  it('keeps confirmation when the same value is repeated', () => {
    let s = emptyCallerState()
    s = confirm(remember(s, 'name', 'Rahul Verma'), 'name')
    s = remember(s, 'name', 'Rahul Verma')
    expect(s.name?.confirmed).toBe(true)
  })
})

describe('caller state — do not ask twice (spec §28)', () => {
  it('tells the agent what it already knows', () => {
    let s = emptyCallerState()
    s = remember(s, 'name', 'Rahul Verma')
    s = remember(s, 'phone', '9876543210')
    const d = describeState(s)
    expect(d).toMatch(/do NOT ask for these again/i)
    expect(d).toContain('Rahul Verma')
    expect(d).toContain('9876543210')
  })

  it('names what is still missing', () => {
    let s = emptyCallerState()
    s = remember(s, 'name', 'Rahul Verma')
    expect(describeState(s)).toMatch(/still missing.*mobile number/i)
  })

  it('says plainly when nothing is known yet', () => {
    expect(describeState(emptyCallerState())).toMatch(/not learned anything/i)
  })

  it('flags an unconfirmed value so it gets read back', () => {
    let s = emptyCallerState()
    s = remember(s, 'phone', '9876543210')
    expect(describeState(s)).toContain('unconfirmed')
  })
})

describe('normalisePhone (spec §11)', () => {
  it('reads digits spoken as words', () => {
    expect(normalisePhone('my number is nine eight seven six five four three two one zero'))
      .toBe('9876543210')
  })
  it('reads Hindi digit words', () => {
    expect(normalisePhone('nau aath saat cheh paanch char teen do ek shunya')).toBe('9876543210')
  })
  it('strips spacing and the country code', () => {
    expect(normalisePhone('+91 98765 43210')).toBe('9876543210')
  })
  it('handles a leading zero', () => {
    expect(normalisePhone('098765 43210')).toBe('9876543210')
  })
  it('rejects a number that is too short', () => {
    expect(normalisePhone('my number is 98765')).toBeNull()
  })
  it('rejects an impossible Indian mobile', () => {
    expect(normalisePhone('1234567890')).toBeNull()
  })
  it('returns null when there is no number at all', () => {
    expect(normalisePhone('I would like a cleaning please')).toBeNull()
  })
})

describe('speakPhone', () => {
  it('groups the way the number is written and said', () => {
    // One ten-digit run is impossible to check against a scrap of paper.
    expect(speakPhone('9876543210')).toBe('98765 43210')
  })
  it('leaves a malformed value alone rather than mangling it', () => {
    expect(speakPhone('12345')).toBe('12345')
  })
})
