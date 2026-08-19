import { describe, it, expect } from 'vitest'
import { CallLog, buildCallRecord } from './crm'
import { PracticeStore } from './practice'
import { learn, markConfirmed, newConversation } from './conversation-state'

const base = () => ({
  sessionId: 's1',
  startedAt: Date.now() - 90_000,
  practice: new PracticeStore(),
  bookedIds: [] as string[],
  toolsUsed: [] as string[],
  transcript: [] as { speaker: 'caller' | 'priya'; text: string; at: number }[],
})

describe('call record — outcome', () => {
  it('is no-speech when the caller never spoke', () => {
    const r = buildCallRecord({ ...base(), state: newConversation() })
    expect(r.outcome).toBe('no-speech')
  })

  it('is booked when something reached the diary', () => {
    const practice = new PracticeStore()
    const [slot] = practice.findSlots({ serviceId: 's2', limit: 1 })
    const booked = practice.bookAtomic({
      patientId: 'pt1', serviceId: 's2', start: slot!.start,
      providerId: slot!.providerId, operatoryId: slot!.operatoryId,
    })
    if (!booked.ok) throw new Error('setup failed')
    const r = buildCallRecord({
      ...base(), practice, bookedIds: [booked.appointment.id], state: newConversation(),
      transcript: [{ speaker: 'caller', text: 'book me a cleaning', at: Date.now() }],
    })
    expect(r.outcome).toBe('booked')
    expect(r.appointments[0]!.doctor).toMatch(/^Dr\./)
    expect(r.appointments[0]!.when).toMatch(/\d/)
  })

  it('is escalated when triage fired', () => {
    const r = buildCallRecord({
      ...base(), state: newConversation(),
      triage: { band: 'red', reason: 'Possible airway compromise' },
      transcript: [{ speaker: 'caller', text: 'my face is swollen', at: Date.now() }],
    })
    expect(r.outcome).toBe('escalated')
  })
})

describe('call record — follow-ups are what a human must do', () => {
  it('leads with an emergency', () => {
    const r = buildCallRecord({
      ...base(), state: newConversation(),
      triage: { band: 'red', reason: 'difficulty breathing' },
      transcript: [{ speaker: 'caller', text: 'x', at: Date.now() }],
    })
    expect(r.followUps[0]).toMatch(/EMERGENCY/)
  })

  it('flags a number that was never read back', () => {
    // A wrong number is a patient who never gets their reminder.
    let s = newConversation()
    s = learn(s, 'phone', '9876543210', 'caller')
    const r = buildCallRecord({
      ...base(), state: s,
      transcript: [{ speaker: 'caller', text: 'x', at: Date.now() }],
    })
    expect(r.followUps.join(' ')).toMatch(/never read back/i)
    expect(r.caller.phoneConfirmed).toBe(false)
  })

  it('does not flag a confirmed number', () => {
    let s = newConversation()
    s = markConfirmed(learn(s, 'phone', '9876543210', 'caller'), 'phone')
    const r = buildCallRecord({
      ...base(), state: s,
      transcript: [{ speaker: 'caller', text: 'x', at: Date.now() }],
    })
    expect(r.followUps.join(' ')).not.toMatch(/never read back/i)
  })

  it('flags a caller who cannot be followed up', () => {
    const r = buildCallRecord({
      ...base(), state: newConversation(),
      transcript: [{ speaker: 'caller', text: 'how much is a cleaning', at: Date.now() }],
    })
    expect(r.followUps.join(' ')).toMatch(/cannot be followed up/i)
  })

  it('flags a field the agent kept mishearing', () => {
    let s = newConversation()
    s = learn(s, 'phone', '1111111111')
    s = learn(s, 'phone', '2222222222')
    s = learn(s, 'phone', '9876543210')
    const r = buildCallRecord({
      ...base(), state: s,
      transcript: [{ speaker: 'caller', text: 'x', at: Date.now() }],
    })
    expect(r.followUps.join(' ')).toMatch(/corrected 2 times/)
  })

  it('has nothing outstanding on a clean booking', () => {
    const practice = new PracticeStore()
    const [slot] = practice.findSlots({ serviceId: 's2', limit: 1 })
    const booked = practice.bookAtomic({
      patientId: 'pt1', serviceId: 's2', start: slot!.start,
      providerId: slot!.providerId, operatoryId: slot!.operatoryId,
    })
    if (!booked.ok) throw new Error('setup failed')
    let s = newConversation()
    s = markConfirmed(learn(s, 'name', 'Rahul Verma', 'caller'), 'name')
    s = markConfirmed(learn(s, 'phone', '9876543210', 'caller'), 'phone')
    const r = buildCallRecord({
      ...base(), practice, bookedIds: [booked.appointment.id], state: s,
      transcript: [{ speaker: 'caller', text: 'book me a cleaning', at: Date.now() }],
    })
    expect(r.followUps).toEqual([])
  })
})

describe('call log', () => {
  it('keeps newest first', () => {
    const log = new CallLog()
    log.add(buildCallRecord({ ...base(), sessionId: 'a', state: newConversation() }))
    log.add(buildCallRecord({ ...base(), sessionId: 'b', state: newConversation() }))
    expect(log.all().map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('surfaces only calls needing a human', () => {
    const log = new CallLog()
    log.add(buildCallRecord({ ...base(), sessionId: 'clean', state: newConversation() }))
    log.add(buildCallRecord({
      ...base(), sessionId: 'urgent', state: newConversation(),
      triage: { band: 'red', reason: 'bleeding' },
      transcript: [{ speaker: 'caller', text: 'x', at: Date.now() }],
    }))
    expect(log.outstanding().map((o) => o.record.id)).toEqual(['urgent'])
  })

  it('reports what the practice would want on a dashboard', () => {
    const log = new CallLog()
    log.add(buildCallRecord({ ...base(), state: newConversation() }))
    const s = log.stats()
    expect(s.total).toBe(1)
    expect(s.byLanguage['en-IN']).toBe(1)
    expect(s.avgDurationSec).toBeGreaterThan(0)
  })
})
