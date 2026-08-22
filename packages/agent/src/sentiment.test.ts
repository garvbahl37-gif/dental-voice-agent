import { describe, expect, it } from 'vitest'
import { analyseSentiment, detectIntent } from './sentiment'

/**
 * The failure worth guarding against is a furious call reported as pleasant,
 * because a dashboard that says everyone is happy is one nobody checks again.
 */

describe('analyseSentiment', () => {
  it('reads an angry caller as negative', () => {
    const r = analyseSentiment([
      'I waited forty minutes and nobody apologised.',
      'This is ridiculous, I want to speak to the manager.',
    ])
    expect(r.sentiment).toBe('negative')
    expect(r.score).toBeLessThan(0)
    expect(r.signals.length).toBeGreaterThan(0)
  })

  it('reads a grateful caller as positive', () => {
    const r = analyseSentiment(['That is perfect, thank you so much. Very helpful.'])
    expect(r.sentiment).toBe('positive')
    expect(r.score).toBeGreaterThan(0)
  })

  it('catches unhappiness in Hinglish, not just English', () => {
    expect(analyseSentiment(['Service bahut kharab hai, bakwas.']).sentiment).toBe('negative')
    expect(analyseSentiment(['बहुत खराब सर्विस है।']).sentiment).toBe('negative')
  })

  it('catches thanks in Hinglish too', () => {
    expect(analyseSentiment(['Badhiya, shukriya.']).sentiment).toBe('positive')
  })

  it('treats an ordinary booking as neutral', () => {
    expect(analyseSentiment(['I would like to book a cleaning for next week.']).sentiment).toBe('neutral')
  })

  it('separates being in pain from being displeased', () => {
    // Someone with toothache is distressed, not dissatisfied — routing these
    // the same way sends the wrong person an apology.
    const r = analyseSentiment(['I have terrible pain in my tooth, it is really hurting.'])
    expect(r.distressed).toBe(true)
  })

  it('does not let one complaint in a long call dominate', () => {
    const long = analyseSentiment([
      'Hello, I would like to book a cleaning please.',
      'Bandra branch would be best for me, some time next week if possible.',
      'Morning is better because I work in the afternoons.',
      'Last time the wait was a bit annoying but it was fine otherwise.',
    ])
    const short = analyseSentiment(['Annoying.'])
    expect(long.score).toBeGreaterThan(short.score)
  })

  it('is neutral on silence rather than guessing', () => {
    expect(analyseSentiment([]).sentiment).toBe('neutral')
    expect(analyseSentiment(['   ']).score).toBe(0)
  })

  it('shows what it matched, so a surprising score can be checked', () => {
    const r = analyseSentiment(['This is unacceptable and rude.'])
    expect(r.signals.join(' ')).toMatch(/unacceptable|rude/)
  })
})

describe('detectIntent', () => {
  it('recognises the ordinary reasons people ring a dentist', () => {
    expect(detectIntent(['I want to book an appointment'])).toBe('book')
    expect(detectIntent(['Can I move my appointment to Friday'])).toBe('reschedule')
    expect(detectIntent(['I need to cancel'])).toBe('cancel')
    expect(detectIntent(['How much is a cleaning'])).toBe('question')
  })

  it('recognises them in Hinglish', () => {
    expect(detectIntent(['Mujhe appointment chahiye'])).toBe('book')
    expect(detectIntent(['Kitna kharcha hoga'])).toBe('question')
  })

  it('puts an emergency ahead of a booking mentioned in the same breath', () => {
    // "I need an appointment, my face is swollen" is an emergency first.
    expect(detectIntent(['I need an appointment, my face is swollen'])).toBe('emergency')
  })

  it('puts a complaint ahead of a booking', () => {
    expect(detectIntent(['I want to complain about my last appointment'])).toBe('complaint')
  })

  it('says unknown rather than guessing', () => {
    expect(detectIntent([])).toBe('unknown')
    expect(detectIntent(['Hello?'])).toBe('unknown')
  })
})
