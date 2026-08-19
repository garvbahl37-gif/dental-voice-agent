import { describe, it, expect } from 'vitest'
import {
  alreadyAsked, describeConversation, extractFacts, learn, markConfirmed,
  newConversation, noteAsked, observeLanguage,
} from './conversation-state'

describe('memory — the "she forgets" defect', () => {
  it('surfaces what it already knows', () => {
    let s = newConversation()
    s = learn(s, 'name', 'Rahul Verma')
    s = learn(s, 'phone', '9876543210')
    const d = describeConversation(s)
    expect(d).toContain('Rahul Verma')
    expect(d).toContain('9876543210')
  })

  it('states plainly when it knows nothing', () => {
    expect(describeConversation(newConversation())).toMatch(/told you nothing/i)
  })

  it('records questions so they are never asked twice', () => {
    let s = newConversation()
    s = noteAsked(s, 'name')
    expect(alreadyAsked(s, 'name')).toBe(true)
    expect(describeConversation(s)).toMatch(/ALREADY asked for: name.*Do not ask again/s)
  })

  it('never re-offers a declined slot', () => {
    const s = newConversation()
    s.declinedSlots.push('Monday at ten')
    expect(describeConversation(s)).toMatch(/never offer them again.*Monday at ten/s)
  })
})

describe('facts — corrections supersede', () => {
  it('replaces rather than accumulating', () => {
    let s = newConversation()
    s = learn(s, 'preferredTime', 'tomorrow')
    s = learn(s, 'preferredTime', 'Thursday')
    expect(s.preferredTime?.value).toBe('Thursday')
  })

  it('clears confirmation when a value changes', () => {
    let s = newConversation()
    s = markConfirmed(learn(s, 'phone', '9876543210'), 'phone')
    s = learn(s, 'phone', '9123456780')
    expect(s.caller.phone?.confirmed).toBe(false)
  })

  it('does not require confirming what the database supplied', () => {
    let s = newConversation()
    s = learn(s, 'name', 'Rahul Verma', 'lookup')
    expect(s.caller.name?.confirmed).toBe(true)
  })

  it('flags heard values as needing a read-back', () => {
    let s = newConversation()
    s = learn(s, 'phone', '9876543210', 'caller')
    expect(describeConversation(s)).toMatch(/NOT yet read back/)
    expect(describeConversation(s)).toMatch(/Read back before booking.*Mobile/s)
  })

  it('counts corrections, so repeated failure can trigger a handoff', () => {
    let s = newConversation()
    s = learn(s, 'phone', '1')
    s = learn(s, 'phone', '2')
    s = learn(s, 'phone', '3')
    expect(s.correctionCount.phone).toBe(2)
  })
})

describe('language hysteresis — the "still speaks English" defect', () => {
  it('switches immediately on Devanagari', () => {
    const s = observeLanguage(newConversation(), 'hi-IN', 0.99)
    expect(s.language).toBe('hi-IN')
  })

  it('does not flip on a single ambiguous turn', () => {
    // "haan" and "yes" are plausible in either register; flipping on one turn
    // makes the agent oscillate mid-conversation.
    const s = observeLanguage(newConversation(), 'hi-Latn-IN', 0.4)
    expect(s.language).toBe('en-IN')
  })

  it('switches once two consecutive turns agree', () => {
    let s = newConversation()
    s = observeLanguage(s, 'hi-Latn-IN', 0.5)
    s = observeLanguage(s, 'hi-Latn-IN', 0.5)
    expect(s.language).toBe('hi-Latn-IN')
  })

  it('stays put when the caller alternates', () => {
    let s = newConversation()
    s = observeLanguage(s, 'hi-Latn-IN', 0.5)
    s = observeLanguage(s, 'en-IN', 0.5)
    s = observeLanguage(s, 'hi-Latn-IN', 0.5)
    expect(s.language).toBe('en-IN')
  })
})

describe('extraction', () => {
  it('pulls a spoken phone number', () => {
    expect(extractFacts('my number is nine eight seven six five four three two one zero').phone)
      .toBe('9876543210')
  })
  it('pulls a name', () => {
    expect(extractFacts('My name is Rahul Verma').name).toBe('Rahul Verma')
  })
  it('pulls a name from Hinglish', () => {
    expect(extractFacts('Mera naam Priya Sharma hai').name).toBeTruthy()
  })
  it('pulls a time preference', () => {
    expect(extractFacts('I would like Thursday morning').preferredTime).toMatch(/thursday|morning/i)
  })
  it('does not invent a name from a greeting', () => {
    // A wrong extraction becomes a fact the agent confidently repeats back.
    expect(extractFacts('Hello I am calling about an appointment').name).toBeUndefined()
    expect(extractFacts('I am fine thanks').name).toBeUndefined()
  })
  it('extracts nothing from a bare request', () => {
    expect(extractFacts('I need a cleaning')).toEqual({})
  })
})
