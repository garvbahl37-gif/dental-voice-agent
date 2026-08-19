import { describe, it, expect } from 'vitest'
import { silenceThresholdMs, classifyQuestion, type EndpointContext } from './endpointing'

const base: EndpointContext = {
  questionKind: 'none',
  partialText: 'book an appointment',
  lang: 'en-IN',
}

describe('silenceThresholdMs', () => {
  it('returns the base threshold with no modifiers', () => {
    expect(silenceThresholdMs(base)).toBe(600)
  })

  it('waits longer after an open question', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'open' })).toBe(900)
  })

  it('cuts in faster after a yes/no question', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'yesno' })).toBe(450)
  })

  it('waits longer when the caller trails off on an English filler', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'i want to um' })).toBe(1000)
  })

  it('waits longer on a romanised Hindi filler', () => {
    expect(
      silenceThresholdMs({ ...base, partialText: 'mujhe matlab', lang: 'hi-Latn-IN' }),
    ).toBe(1000)
  })

  it('waits longer on a Devanagari filler', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'मुझे मतलब', lang: 'hi-IN' })).toBe(1000)
  })

  it('waits longer when the English utterance is grammatically incomplete', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my name is' })).toBe(1100)
  })

  it('waits longer when the Hindi utterance dangles on a postposition', () => {
    expect(
      silenceThresholdMs({ ...base, partialText: 'mera naam hai', lang: 'hi-Latn-IN' }),
    ).toBe(1100)
  })

  it('waits longer mid phone number', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my number is 98765' })).toBe(1100)
  })

  it('does not wait extra once a full phone number is spoken', () => {
    expect(silenceThresholdMs({ ...base, partialText: 'my number is 9876543210' })).toBe(600)
  })

  it('stacks question kind and filler modifiers', () => {
    expect(silenceThresholdMs({ ...base, questionKind: 'yesno', partialText: 'well uh' })).toBe(850)
  })

  it('treats an empty partial as base — silence before any speech is not a trailing thought', () => {
    expect(silenceThresholdMs({ ...base, partialText: '' })).toBe(600)
  })

  it('never returns a threshold that would cut off a normal breath', () => {
    const kinds = ['open', 'yesno', 'none'] as const
    for (const questionKind of kinds) {
      expect(silenceThresholdMs({ ...base, questionKind })).toBeGreaterThanOrEqual(400)
    }
  })
})

describe('classifyQuestion', () => {
  it('classifies an open question', () => {
    expect(classifyQuestion('How can I help you today?')).toBe('open')
  })

  it('classifies a yes/no question', () => {
    expect(classifyQuestion('Does Thursday at four work for you?')).toBe('yesno')
  })

  it('classifies a Hindi yes/no question', () => {
    expect(classifyQuestion('Kya aapko Thursday theek rahega?')).toBe('yesno')
  })

  it('classifies a statement as not a question', () => {
    expect(classifyQuestion('You are booked for Thursday at four.')).toBe('none')
  })

  it('treats a confirmation request as yes/no', () => {
    expect(classifyQuestion('Shall I confirm that?')).toBe('yesno')
  })
})
