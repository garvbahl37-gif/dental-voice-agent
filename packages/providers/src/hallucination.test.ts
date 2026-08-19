import { describe, it, expect } from 'vitest'
import { acceptTranscript, hasSpeechEnergy, isHallucination } from './hallucination'

const silence = (n = 16000) => new Int16Array(n)
const speech = (n = 16000) => {
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin(i / 8) * 6000)
  return pcm
}

describe('hasSpeechEnergy', () => {
  it('rejects digital silence', () => {
    expect(hasSpeechEnergy(silence())).toBe(false)
  })
  it('accepts speech-level audio', () => {
    expect(hasSpeechEnergy(speech())).toBe(true)
  })
  it('rejects a buffer too short to judge', () => {
    expect(hasSpeechEnergy(new Int16Array(64))).toBe(false)
  })
  it('accepts speech surrounded by silence', () => {
    const pcm = silence(32000)
    pcm.set(speech(6000), 12000)
    expect(hasSpeechEnergy(pcm)).toBe(true)
  })
})

describe('isHallucination', () => {
  const invented = [
    'Thank you.', 'Thanks for watching!', 'www.pens.com.au', 'Please subscribe to my channel',
    'Subtitles by the Amara.org community', 'Bye.', '...', '[MUSIC]', '(applause)', 'धन्यवाद।',
  ]
  it.each(invented)('rejects %s', (t) => expect(isHallucination(t)).toBe(true))

  const genuine = [
    'Hello, I would like to book a teeth cleaning appointment please.',
    'Thank you, that works for me.',
    'My name is Rahul Verma.',
    'mujhe kal subah ka slot chahiye',
    'नमस्ते, मुझे अपॉइंटमेंट चाहिए',
    'Nine eight seven six five four three two one zero.',
  ]
  it.each(genuine)('keeps %s', (t) => expect(isHallucination(t)).toBe(false))

  it('keeps a thank-you that is part of a real sentence', () => {
    expect(isHallucination('Thank you, could I book for Thursday?')).toBe(false)
  })
})

describe('acceptTranscript', () => {
  it('drops a plausible transcript when the audio was silent', () => {
    // The exact failure seen in the browser audit: Whisper inventing words
    // over the lead-in silence before the caller had spoken.
    expect(acceptTranscript('Scribe to the next step.', silence())).toBe('')
  })
  it('keeps a real transcript backed by real audio', () => {
    expect(acceptTranscript('I need an appointment', speech())).toBe('I need an appointment')
  })
  it('drops a stock phrase even when audio is loud', () => {
    expect(acceptTranscript('Thanks for watching!', speech())).toBe('')
  })
})

describe('noise fragments', () => {
  const noise = ['SMA, Cp.', 'S.', 'A B', 'Mm.', 'Uh.', '- -', 'TV.']
  it.each(noise)('rejects %s', (t) => expect(isHallucination(t)).toBe(true))

  const real = [
    'Hello there',
    'Yes please',
    'Haan ji',
    'Thursday',
    'नमस्ते',
    'nine eight seven',
    'My name is Rahul',
  ]
  it.each(real)('keeps %s', (t) => expect(isHallucination(t)).toBe(false))
})

describe('silence must never become a caller turn', () => {
  const secs = (n: number) => new Int16Array(16000 * n)

  it('rejects a burst too short to be a turn', () => {
    // 200ms of sound in a 2s buffer — a cough, a door, one syllable of TV.
    const pcm = secs(2)
    for (let i = 0; i < 3200; i++) pcm[8000 + i] = Math.round(Math.sin(i / 8) * 7000)
    expect(hasSpeechEnergy(pcm)).toBe(false)
  })

  it('accepts a genuine short answer', () => {
    // ~600ms — "yes please" carries at least this much voiced audio.
    const pcm = secs(2)
    for (let i = 0; i < 9600; i++) pcm[4000 + i] = Math.round(Math.sin(i / 8) * 7000)
    expect(hasSpeechEnergy(pcm)).toBe(true)
  })

  it('rejects room tone across the whole buffer', () => {
    const pcm = Int16Array.from({ length: 32000 }, () => Math.round((Math.random() - 0.5) * 120))
    expect(hasSpeechEnergy(pcm)).toBe(false)
  })

  it('rejects the exact phrase Whisper invents from digital silence', () => {
    // Measured against Groq whisper-large-v3-turbo: pure silence returns this.
    expect(acceptTranscript('Thank you.', secs(2))).toBe('')
  })
})
