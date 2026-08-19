import { describe, it, expect } from 'vitest'
import { SentenceChunker, estimateDurationMs } from './chunker'

describe('SentenceChunker', () => {
  it('emits a complete sentence at a hard boundary', () => {
    const c = new SentenceChunker()
    expect(c.push('Hello there. How can I help?')).toEqual(['Hello there.'])
    expect(c.flush()).toBe('How can I help?')
  })

  it('withholds a boundary at the very end until more input arrives', () => {
    // A trailing "." might be a decimal point mid-number; splitting on it would
    // hand TTS "the fee is 4." and then "30 rupees".
    const c = new SentenceChunker()
    expect(c.push('Hello there.')).toEqual([])
    expect(c.flush()).toBe('Hello there.')
  })

  it('accumulates across streaming token boundaries', () => {
    const c = new SentenceChunker()
    expect(c.push('Hello the')).toEqual([])
    expect(c.push('re. Bye.')).toEqual(['Hello there.'])
    expect(c.flush()).toBe('Bye.')
  })

  it('splits on the Devanagari danda', () => {
    const c = new SentenceChunker()
    expect(c.push('नमस्ते। मैं आपकी मदद कर सकती हूँ।')).toEqual(['नमस्ते।'])
    expect(c.flush()).toBe('मैं आपकी मदद कर सकती हूँ।')
  })

  it('does not split an abbreviated title from its name', () => {
    const c = new SentenceChunker()
    expect(c.push('Dr. Sharma is free. Book?')).toEqual(['Dr. Sharma is free.'])
  })

  it('splits a sentence boundary even when the model omits the space', () => {
    // Streaming deltas routinely arrive as "right?Great." — run together, this
    // is synthesised as one breathless clause.
    const c = new SentenceChunker()
    const chunks = c.push('You would like a scaling and polishing, right?Great, let me check now. ')
    expect(chunks.some((x) => x.includes('right?Great'))).toBe(false)
  })

  it('does not split a decimal number', () => {
    const c = new SentenceChunker()
    expect(c.push('The fee is 4.30 thousand. Okay?')).toEqual(['The fee is 4.30 thousand.'])
  })

  it('does not split off a short lead-in at a soft boundary', () => {
    // "Haan ji," alone is 350ms of audio with no prosodic link to what follows.
    // Synthesising fragments like this is what makes an agent sound synthetic,
    // and the latency it saves is negligible.
    const c = new SentenceChunker()
    expect(c.push('Haan ji, main aapke liye slot dekh rahi hoon.')).toEqual([])
  })

  it('splits at a soft boundary once the phrase is substantial and more follows', () => {
    const c = new SentenceChunker()
    // Held on the first push, released once the remainder can stand alone.
    c.push('Let me just check the diary for you, ')
    expect(c.push('and I will find you something very soon indeed. ')).toEqual([
      'Let me just check the diary for you,',
      'and I will find you something very soon indeed.',
    ])
  })

  it('never strands a sliver after a soft split', () => {
    // The exact failure seen in a live call: splitting at the comma left
    // "right?" as its own 330ms clip.
    const c = new SentenceChunker()
    const chunks = [
      ...c.push('Sure, just to confirm you would like a teeth cleaning, right?'),
      c.flush(),
    ].filter((x): x is string => Boolean(x))
    for (const chunk of chunks) {
      expect(estimateDurationMs(chunk, 'en-IN'), `"${chunk}"`).toBeGreaterThanOrEqual(400)
    }
    expect(chunks.join(' ')).toContain('right?')
  })

  it('never emits a fragment shorter than a speakable phrase', () => {
    for (const text of [
      'Sure, I can set that up for you.',
      'Okay, let me see.',
      'Right, one moment.',
      'Yes, that works.',
    ]) {
      const c = new SentenceChunker()
      const chunks = [...c.push(`${text} `)].filter(Boolean)
      for (const chunk of chunks) {
        expect(chunk.length, `"${chunk}" from "${text}"`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('does not keep splitting on soft boundaries after the first chunk', () => {
    const c = new SentenceChunker()
    expect(c.push('Haan ji, dekh rahi hoon. ')).toEqual(['Haan ji, dekh rahi hoon.'])
    // Commas no longer split — the caller is already hearing audio, so from here
    // on whole sentences give TTS the context it needs for natural prosody.
    expect(c.push('Thursday, Friday, aur Saturday khaali hai. ')).toEqual([
      'Thursday, Friday, aur Saturday khaali hai.',
    ])
  })

  it('force-emits when a clause runs past the maximum chunk length', () => {
    const c = new SentenceChunker()
    const long = 'word '.repeat(60)
    const out = c.push(long)
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.length).toBeLessThanOrEqual(240)
  })

  it('returns null from flush when nothing remains', () => {
    const c = new SentenceChunker()
    c.push('That is all sorted for you now. ')
    expect(c.flush()).toBeNull()
  })

  it('ignores whitespace-only residue', () => {
    const c = new SentenceChunker()
    c.push('Everything is booked and confirmed.   ')
    expect(c.flush()).toBeNull()
  })

  it('merges a sliver of a sentence into the next chunk', () => {
    // "right?" alone is ~330ms of audio — too short to carry an intonation
    // contour, and it is what makes stitched speech sound synthetic.
    const c = new SentenceChunker()
    const chunks = c.push('You would like a scaling and polishing appointment, right? Let me check. ')
    for (const chunk of chunks) {
      expect(estimateDurationMs(chunk, 'en-IN'), `"${chunk}"`).toBeGreaterThanOrEqual(400)
    }
  })

  it('preserves every word across all chunks', () => {
    const c = new SentenceChunker()
    const text = 'Haan ji, Dr. Sharma Thursday ko free hain. Kya main book kar doon? Bataiye.'
    const chunks = [...c.push(text), c.flush()].filter((x): x is string => Boolean(x))
    const rejoined = chunks.join(' ').replace(/\s+/g, ' ').trim()
    expect(rejoined).toBe(text.replace(/\s+/g, ' ').trim())
  })
})

describe('estimateDurationMs', () => {
  it('scales with text length', () => {
    expect(estimateDurationMs('a short one', 'en-IN')).toBeLessThan(
      estimateDurationMs('a considerably longer utterance than the other one', 'en-IN'),
    )
  })

  it('returns a positive duration for a single word', () => {
    expect(estimateDurationMs('haan', 'en-IN')).toBeGreaterThan(0)
  })

  it('returns zero for empty text', () => {
    expect(estimateDurationMs('', 'en-IN')).toBe(0)
  })

  it('allows more time for Devanagari, where one glyph carries more sound', () => {
    expect(estimateDurationMs('नमस्ते जी', 'hi-IN')).toBeGreaterThan(
      estimateDurationMs('namaste ji', 'en-IN'),
    )
  })
})
