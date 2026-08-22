import { describe, it, expect } from 'vitest'
import { detectLang } from './lang-detect'

describe('detectLang', () => {
  it('detects plain English', () => {
    const r = detectLang('I want to book an appointment for tomorrow')
    expect(r.lang).toBe('en-IN')
    expect(r.codeSwitched).toBe(false)
  })

  it('detects Devanagari Hindi', () => {
    const r = detectLang('मुझे कल अपॉइंटमेंट चाहिए')
    expect(r.lang).toBe('hi-IN')
    expect(r.confidence).toBeGreaterThan(0.9)
  })

  it('detects romanised Hindi', () => {
    const r = detectLang('mujhe kal appointment chahiye subah ke liye')
    expect(r.lang).toBe('hi-Latn-IN')
  })

  it('detects Hinglish as code-switched, not as one language or the other', () => {
    const r = detectLang('Mujhe kal morning ek appointment book karna hai for cleaning')
    expect(r.lang).toBe('hi-Latn-IN')
    expect(r.codeSwitched).toBe(true)
  })

  it('flags mixed-script input as code-switched', () => {
    const r = detectLang('मुझे Thursday ko appointment chahiye')
    expect(r.codeSwitched).toBe(true)
  })

  it('keeps the conversation language on a bare noun phrase', () => {
    // "root canal" carries no grammatical signal in either language.
    expect(detectLang('root canal', 'hi-Latn-IN').lang).toBe('hi-Latn-IN')
    expect(detectLang('root canal', 'en-IN').lang).toBe('en-IN')
  })

  it('returns low confidence when there is nothing to go on', () => {
    expect(detectLang('root canal').confidence).toBeLessThan(0.5)
  })

  it('handles an empty transcript without throwing', () => {
    expect(detectLang('')).toMatchObject({ confidence: 0 })
  })

  it('is more confident with more evidence', () => {
    const short = detectLang('i want')
    const long = detectLang('i want to book an appointment for my mother please')
    expect(long.confidence).toBeGreaterThanOrEqual(short.confidence)
  })

  it('reads a Hindi-dominant sentence with one English noun as Hinglish', () => {
    // Borrowed nouns are normal in Hindi speech; grammar decides the register.
    const r = detectLang('mujhe appointment chahiye')
    expect(r.lang).toBe('hi-Latn-IN')
  })
})

/**
 * The regional languages.
 *
 * Every script except Devanagari identifies its language on sight, so those
 * cases are cheap. Hindi and Marathi are the ones worth testing: they share an
 * alphabet, so the only thing separating them is vocabulary, and getting it
 * wrong means answering a Marathi caller in Hindi — which reads as the agent
 * not listening rather than as a detection bug.
 */
describe('detectLang — regional languages', () => {
  const unambiguous: [string, string][] = [
    ['ta-IN', 'எனக்கு நாளை ஒரு அப்பாயிண்ட்மென்ட் வேண்டும்'],
    ['te-IN', 'నాకు రేపు అపాయింట్‌మెంట్ కావాలి'],
    ['kn-IN', 'ನನಗೆ ನಾಳೆ ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್ ಬೇಕು'],
    ['ml-IN', 'എനിക്ക് നാളെ ഒരു അപ്പോയിന്റ്മെന്റ് വേണം'],
    ['bn-IN', 'আমার আগামীকাল একটি অ্যাপয়েন্টমেন্ট দরকার'],
    ['gu-IN', 'મારે કાલે એપોઇન્ટમેન્ટ જોઈએ છે'],
    ['pa-IN', 'ਮੈਨੂੰ ਕੱਲ੍ਹ ਇੱਕ ਅਪਾਇੰਟਮੈਂਟ ਚਾਹੀਦੀ ਹੈ'],
  ]

  for (const [lang, text] of unambiguous) {
    it(`detects ${lang} from its script alone`, () => {
      const r = detectLang(text)
      expect(r.lang).toBe(lang)
      expect(r.confidence).toBeGreaterThan(0.9)
    })
  }

  it('separates Marathi from Hindi despite the shared script', () => {
    const r = detectLang('मला उद्या एक अपॉइंटमेंट हवी आहे')
    expect(r.lang).toBe('mr-IN')
  })

  it('still reads Hindi as Hindi, not Marathi', () => {
    const r = detectLang('मुझे कल एक अपॉइंटमेंट चाहिए, मैं सुबह आ सकता हूँ')
    expect(r.lang).toBe('hi-IN')
  })

  it('falls back to Hindi when Devanagari carries no distinguishing words', () => {
    // Ties go to Hindi: it is the larger population, so it is the cheaper error.
    const r = detectLang('ठीक')
    expect(r.lang).toBe('hi-IN')
  })
})
