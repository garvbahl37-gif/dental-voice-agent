import { describe, expect, it } from 'vitest'
import { decideRouting, localParts, nextOpening } from './hours'

/**
 * Every case here is pinned to an absolute UTC instant and read back in
 * Asia/Kolkata. A test that used the machine's local clock would pass in Mumbai
 * and fail in CI, which is the specific failure this whole module exists to
 * prevent — the practice's timezone is the only one that means anything.
 */

const HOURS = [1, 2, 3, 4, 5, 6].map((day) => ({ day, open: '09:30', close: '19:30' }))
const TZ = 'Asia/Kolkata' // UTC+5:30, no DST

// 2026-08-19 is a Wednesday.
const at = (utcIso: string) => new Date(utcIso)

describe('localParts', () => {
  it('reads the practice timezone, not the server', () => {
    // 06:00 UTC is 11:30 in Kolkata, same day.
    const p = localParts(at('2026-08-19T06:00:00Z'), TZ)
    expect(p.day).toBe(3)
    expect(p.minutes).toBe(11 * 60 + 30)
    expect(p.iso).toBe('2026-08-19')
  })

  it('rolls the date when UTC and India fall on different days', () => {
    // 20:00 UTC Wednesday is 01:30 Thursday in Kolkata.
    const p = localParts(at('2026-08-19T20:00:00Z'), TZ)
    expect(p.day).toBe(4)
    expect(p.iso).toBe('2026-08-20')
    expect(p.minutes).toBe(90)
  })
})

describe('decideRouting', () => {
  it('is open mid-morning on a working day', () => {
    const d = decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T06:00:00Z') })
    expect(d.mode).toBe('open')
    expect(d.canBookToday).toBe(true)
  })

  it('is closed before opening', () => {
    // 03:00 UTC = 08:30 IST, half an hour before the doors open.
    const d = decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T03:00:00Z') })
    expect(d.mode).toBe('after_hours')
    expect(d.canBookToday).toBe(false)
  })

  it('is closed after the last appointment', () => {
    // 15:00 UTC = 20:30 IST.
    const d = decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T15:00:00Z') })
    expect(d.mode).toBe('after_hours')
  })

  it('is closed on Sunday', () => {
    // 2026-08-23 is a Sunday. 06:00 UTC = 11:30 IST.
    const d = decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-23T06:00:00Z') })
    expect(d.mode).toBe('after_hours')
  })

  it('still answers after hours — it just cannot book today', () => {
    const d = decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T20:00:00Z') })
    expect(d.canBookToday).toBe(false)
    expect(d.note).toMatch(/still answer questions/i)
    expect(d.note).toMatch(/book appointments for a future day/i)
  })

  it('gives out the emergency number when the practice is shut', () => {
    const d = decideRouting({
      hours: HOURS,
      timezone: TZ,
      now: at('2026-08-19T20:00:00Z'),
      emergencyPhone: '+919820011200',
    })
    expect(d.emergencyPhone).toBe('+919820011200')
    expect(d.note).toContain('+919820011200')
  })

  it('offers no transfer after hours — there is nobody to transfer to', () => {
    const open = decideRouting({
      hours: HOURS,
      timezone: TZ,
      now: at('2026-08-19T06:00:00Z'),
      receptionPhone: '+912226551200',
    })
    const shut = decideRouting({
      hours: HOURS,
      timezone: TZ,
      now: at('2026-08-19T20:00:00Z'),
      receptionPhone: '+912226551200',
    })
    expect(open.transferTo).toBe('+912226551200')
    expect(shut.transferTo).toBeUndefined()
    expect(shut.note).toMatch(/nobody there/i)
  })

  it('treats a holiday as closed even during normal hours', () => {
    const d = decideRouting({
      hours: HOURS,
      timezone: TZ,
      now: at('2026-08-19T06:00:00Z'),
      holidays: ['2026-08-19'],
    })
    expect(d.mode).toBe('holiday')
    expect(d.canBookToday).toBe(false)
  })

  it('closes exactly at closing time, not a minute after', () => {
    // 19:30 IST = 14:00 UTC. Closing time is exclusive.
    expect(decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T13:59:00Z') }).mode).toBe('open')
    expect(decideRouting({ hours: HOURS, timezone: TZ, now: at('2026-08-19T14:00:00Z') }).mode).toBe('after_hours')
  })
})

describe('nextOpening', () => {
  it('finds later today when the call comes before opening', () => {
    const n = nextOpening(HOURS, TZ, at('2026-08-19T03:00:00Z'))
    expect(n).toEqual({ day: 3, open: '09:30', daysAhead: 0 })
  })

  it('skips to tomorrow once today has closed', () => {
    const n = nextOpening(HOURS, TZ, at('2026-08-19T15:00:00Z'))
    expect(n?.daysAhead).toBe(1)
    expect(n?.day).toBe(4)
  })

  it('skips Sunday', () => {
    // Saturday 20:30 IST — next opening is Monday.
    const n = nextOpening(HOURS, TZ, at('2026-08-22T15:00:00Z'))
    expect(n?.day).toBe(1)
    expect(n?.daysAhead).toBe(2)
  })

  it('returns null for a practice that never opens', () => {
    expect(nextOpening([], TZ, at('2026-08-19T06:00:00Z'))).toBeNull()
  })
})
