import { describe, it, expect } from 'vitest'
import { truncateToPlayed } from './truncation'
import type { WordMark } from '@vaani/shared'

const marks: WordMark[] = [
  { word: 'Doctor', startMs: 0, endMs: 400 },
  { word: 'Sharma', startMs: 400, endMs: 850 },
  { word: 'is', startMs: 850, endMs: 980 },
  { word: 'available', startMs: 980, endMs: 1600 },
  { word: 'Thursday', startMs: 1600, endMs: 2300 },
]

describe('truncateToPlayed', () => {
  it('keeps the whole utterance when playback completed', () => {
    expect(truncateToPlayed(marks, 2300)).toEqual({
      spoken: 'Doctor Sharma is available Thursday',
      unspoken: '',
      wasTruncated: false,
    })
  })

  it('keeps only words that finished before the cut', () => {
    expect(truncateToPlayed(marks, 1000)).toEqual({
      spoken: 'Doctor Sharma is—',
      unspoken: 'available Thursday',
      wasTruncated: true,
    })
  })

  it('drops a word cut mid-articulation', () => {
    // 1200ms lands inside "available" — a half-spoken word is not information
    // the caller received, so it must not enter the agent's history.
    expect(truncateToPlayed(marks, 1200)).toEqual({
      spoken: 'Doctor Sharma is—',
      unspoken: 'available Thursday',
      wasTruncated: true,
    })
  })

  it('returns empty when interrupted before any word completed', () => {
    expect(truncateToPlayed(marks, 100)).toEqual({
      spoken: '',
      unspoken: 'Doctor Sharma is available Thursday',
      wasTruncated: true,
    })
  })

  it('handles an empty mark list', () => {
    expect(truncateToPlayed([], 500)).toEqual({ spoken: '', unspoken: '', wasTruncated: false })
  })

  it('treats playback beyond the end as complete', () => {
    expect(truncateToPlayed(marks, 99_999)).toEqual({
      spoken: 'Doctor Sharma is available Thursday',
      unspoken: '',
      wasTruncated: false,
    })
  })

  it('never reports a word the caller could not have heard', () => {
    // The property that makes barge-in correct: for any cut point, everything
    // in `spoken` finished playing at or before that point.
    for (let cut = 0; cut <= 2400; cut += 37) {
      const { spoken } = truncateToPlayed(marks, cut)
      const words = spoken.replace(/—$/, '').split(' ').filter(Boolean)
      for (const w of words) {
        const mark = marks.find((m) => m.word === w)!
        expect(mark.endMs).toBeLessThanOrEqual(cut)
      }
    }
  })

  it('spoken and unspoken together account for every word', () => {
    for (let cut = 0; cut <= 2400; cut += 91) {
      const { spoken, unspoken } = truncateToPlayed(marks, cut)
      const all = [
        ...spoken.replace(/—$/, '').split(' ').filter(Boolean),
        ...unspoken.split(' ').filter(Boolean),
      ]
      expect(all).toEqual(marks.map((m) => m.word))
    }
  })
})
