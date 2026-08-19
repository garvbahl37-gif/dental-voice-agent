import { describe, it, expect } from 'vitest'
import { redact, redactDeep, tail } from './redact'

describe('redact', () => {
  it('masks Indian mobile numbers', () => {
    expect(redact('call me on +91 98765 43210')).toBe('call me on [phone]')
  })

  it('masks a plain ten-digit number', () => {
    expect(redact('my number is 9876543210')).toBe('my number is [phone]')
  })

  it('masks dates of birth', () => {
    expect(redact('dob 14/03/1991')).toBe('dob [dob]')
  })

  it('masks email addresses', () => {
    expect(redact('reach me at priya@example.com')).toBe('reach me at [email]')
  })

  it('leaves clinical text alone', () => {
    expect(redact('root canal on Thursday')).toBe('root canal on Thursday')
  })

  it('leaves short numbers alone', () => {
    expect(redact('chair 4 at 3 pm')).toBe('chair 4 at 3 pm')
  })
})

describe('redactDeep', () => {
  it('redacts nested string values', () => {
    const out = redactDeep({ patient: { phone: '+91 98765 43210', name: 'Priya' }, ok: true })
    expect(out).toEqual({ patient: { phone: '[phone]', name: 'Priya' }, ok: true })
  })

  it('redacts inside arrays', () => {
    expect(redactDeep(['9876543210', 'cleaning'])).toEqual(['[phone]', 'cleaning'])
  })

  it('passes non-string primitives through untouched', () => {
    expect(redactDeep({ n: 42, b: false, z: null })).toEqual({ n: 42, b: false, z: null })
  })
})

describe('tail', () => {
  it('keeps the last four characters for support correlation', () => {
    expect(tail('9876543210')).toBe('******3210')
  })

  it('fully masks a value shorter than the keep window', () => {
    expect(tail('123')).toBe('***')
  })
})
