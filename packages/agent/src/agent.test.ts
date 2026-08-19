import { describe, it, expect, beforeEach } from 'vitest'
import { PracticeStore } from './practice'
import { searchKnowledge } from './knowledge'
import { DentalTools } from './tools'
import { DOCTORS } from './clinic-data'
import type { ServerEvent } from '@vaani/shared'

describe('PracticeStore — seed', () => {
  const practice = new PracticeStore()

  it('seeds the full clinical team and four chairs', () => {
    expect(practice.providers).toHaveLength(6)
    expect(practice.operatories).toHaveLength(4)
  })

  it('can book every doctor it can describe', () => {
    // The two lists had drifted: the knowledge base described six doctors while
    // the scheduler knew three, so a caller asking for Dr. Qureshi got his full
    // credentials and then could never be given an appointment with him.
    const describable = DOCTORS.map((d) => d.id).sort()
    const bookable = practice.providers.map((p) => p.id).sort()
    expect(bookable).toEqual(describable)
  })

  it('offers a specialist for every treatment that names one', () => {
    for (const service of practice.services) {
      for (const id of service.providers) {
        expect(practice.provider(id), `${service.name} names unknown provider ${id}`).toBeDefined()
      }
    }
  })

  it('seeds twelve services, all with a real duration', () => {
    expect(practice.services).toHaveLength(12)
    expect(practice.services.every((s) => s.durationMin > 0)).toBe(true)
  })

  it('seeds patients across all three language preferences', () => {
    expect(practice.patients.length).toBeGreaterThanOrEqual(40)
    expect(new Set(practice.patients.map((p) => p.preferredLanguage)).size).toBe(3)
  })

  it('seeds a calendar that is neither empty nor full', () => {
    // Empty looks fake on stage; full means the live booking fails.
    expect(practice.appointments.length).toBeGreaterThan(20)
  })

  it('is deterministic across instances, so a demo runs the same every time', () => {
    const a = new PracticeStore()
    const b = new PracticeStore()
    expect(a.patients.map((p) => p.name)).toEqual(b.patients.map((p) => p.name))
  })
})

describe('PracticeStore — slot solver', () => {
  let practice: PracticeStore
  beforeEach(() => {
    practice = new PracticeStore()
  })

  it('finds slots for a routine service', () => {
    expect(practice.findSlots({ serviceId: 's2' }).length).toBeGreaterThan(0)
  })

  it('only offers doctors qualified for the treatment', () => {
    // Braces adjustment is Dr. Mehta's alone.
    const slots = practice.findSlots({ serviceId: 's10' })
    expect(slots.every((s) => s.providerId === 'p2')).toBe(true)
  })

  it('never offers a slot in the past', () => {
    const slots = practice.findSlots({ serviceId: 's1' })
    expect(slots.every((s) => new Date(s.start).getTime() > Date.now())).toBe(true)
  })

  it('never double-books a doctor', () => {
    const slots = practice.findSlots({ serviceId: 's1', limit: 5 })
    for (const slot of slots) {
      const from = new Date(slot.start).getTime()
      const to = from + slot.durationMin * 60_000
      const clash = practice.appointments.some((a) => {
        if (a.status !== 'booked' || a.providerId !== slot.providerId) return false
        const s = new Date(a.start).getTime()
        return s < to && from < s + a.durationMin * 60_000
      })
      expect(clash, `doctor double-booked at ${slot.start}`).toBe(false)
    }
  })

  it('never double-books a chair', () => {
    const slots = practice.findSlots({ serviceId: 's1', limit: 5 })
    for (const slot of slots) {
      const from = new Date(slot.start).getTime()
      const to = from + slot.durationMin * 60_000
      const clash = practice.appointments.some((a) => {
        if (a.status !== 'booked' || a.operatoryId !== slot.operatoryId) return false
        const s = new Date(a.start).getTime()
        return s < to && from < s + a.durationMin * 60_000
      })
      expect(clash, `chair double-booked at ${slot.start}`).toBe(false)
    }
  })

  it('respects a morning preference', () => {
    const slots = practice.findSlots({ serviceId: 's1', preferMorning: true })
    expect(slots.every((s) => new Date(s.start).getHours() < 13)).toBe(true)
  })

  it('never schedules on a Sunday', () => {
    const slots = practice.findSlots({ serviceId: 's1', days: 20, limit: 30 })
    expect(slots.every((s) => new Date(s.start).getDay() !== 0)).toBe(true)
  })

  it('books a found slot and then stops offering it', () => {
    const [slot] = practice.findSlots({ serviceId: 's2', limit: 1 })
    expect(slot).toBeDefined()
    practice.book({
      patientId: 'pt1',
      serviceId: 's2',
      start: slot!.start,
      providerId: slot!.providerId,
      operatoryId: slot!.operatoryId,
    })
    const after = practice.findSlots({ serviceId: 's2', limit: 10 })
    const stillOffered = after.some(
      (s) => s.start === slot!.start && s.providerId === slot!.providerId,
    )
    expect(stillOffered).toBe(false)
  })
})

describe('knowledge base', () => {
  it('answers an hours question', () => {
    expect(searchKnowledge('what time do you close', 'en-IN')?.text).toMatch(/nine|ten|evening/i)
  })

  it('answers an insurance question', () => {
    expect(searchKnowledge('do you take Star Health insurance', 'en-IN')?.text).toMatch(/Star Health/)
  })

  it('answers a directions question', () => {
    expect(searchKnowledge('where is the clinic located', 'en-IN')?.text).toMatch(/Linking Road|Bandra/)
  })

  it('flags generated facts so the agent renders them in the caller language', () => {
    // These pages carry facts, not phrasing. Reading them verbatim would send
    // English to a Hindi caller.
    expect(searchKnowledge('do you do EMI', 'hi-IN')?.needsRendering).toBe(true)
  })

  it('answers a Hinglish question about hours', () => {
    expect(searchKnowledge('clinic kab khula rehta hai', 'hi-Latn-IN')).not.toBeNull()
  })

  it('returns nothing rather than guessing on an unrelated question', () => {
    // The whole point of the threshold: silence beats a fabricated answer.
    expect(searchKnowledge('what is the capital of France', 'en-IN')).toBeNull()
  })

  it('returns nothing when the practice has no such information', () => {
    // Prognosis is blocked by the safety guard, not by retrieval — the guard is
    // the layer nothing routes around. What the knowledge base must refuse is
    // anything the practice simply has no page about.
    expect(searchKnowledge('do you sell electric toothbrushes', 'en-IN')).toBeNull()
    expect(searchKnowledge('what is the capital of France', 'en-IN')).toBeNull()
    expect(searchKnowledge('can I park my motorcycle overnight', 'en-IN')).toBeNull()
  })
})

describe('DentalTools', () => {
  let practice: PracticeStore
  let events: ServerEvent[]
  let patientId: string | null
  let tools: DentalTools

  beforeEach(() => {
    practice = new PracticeStore()
    events = []
    patientId = null
    tools = new DentalTools({
      practice,
      lang: () => 'en-IN',
      emit: (e) => events.push(e),
      patientId: () => patientId,
      setPatient: (id) => {
        patientId = id
      },
    })
  })

  it('identifies an existing patient by phone', async () => {
    const known = practice.patients[0]!
    const r = await tools.run({ id: 'c1', name: 'lookup_patient', args: { phone: known.phone } })
    expect((r.result as { found: boolean }).found).toBe(true)
    expect(events.some((e) => e.type === 'ui.event' && e.event === 'patient.identified')).toBe(true)
  })

  it('reports no record for an unknown number without inventing one', async () => {
    const r = await tools.run({ id: 'c1', name: 'lookup_patient', args: { phone: '9000000001' } })
    expect((r.result as { found: boolean }).found).toBe(false)
  })

  it('refuses to book before a patient is identified', async () => {
    const r = await tools.run({
      id: 'c1',
      name: 'book_appointment',
      args: { slotStart: new Date().toISOString(), service: 'Consultation', providerId: 'p1', operatoryId: 'o1' },
    })
    expect(r.ok).toBe(false)
  })

  it('books and emits a UI event that drives the live calendar', async () => {
    await tools.run({ id: 'c0', name: 'create_patient', args: { name: 'Test Caller', phone: '9000000002' } })
    const avail = await tools.run({ id: 'c1', name: 'check_availability', args: { service: 'scaling' } })
    const slot = (avail.result as { slots: { slotStart: string; providerId: string; operatoryId: string }[] }).slots[0]!

    const booked = await tools.run({
      id: 'c2',
      name: 'book_appointment',
      args: {
        slotStart: slot.slotStart,
        service: 'Scaling & Polishing',
        providerId: slot.providerId,
        operatoryId: slot.operatoryId,
      },
    })

    expect(booked.ok).toBe(true)
    expect(events.some((e) => e.type === 'ui.event' && e.event === 'appointment.booked')).toBe(true)
  })

  it('phrases availability as speech, not as a data dump', async () => {
    const r = await tools.run({ id: 'c1', name: 'check_availability', args: { service: 'cleaning' } })
    const slots = (r.result as { slots: { when: string }[] }).slots
    expect(slots[0]!.when).toMatch(/at \d/)
    expect(slots[0]!.when).toMatch(/morning|afternoon|evening/)
  })

  it('instructs the agent not to read the whole slot list aloud', async () => {
    const r = await tools.run({ id: 'c1', name: 'check_availability', args: { service: 'cleaning' } })
    expect((r.result as { say: string }).say).toMatch(/at most two|not read/i)
  })

  it('escalates a red-band symptom and creates a practice task', async () => {
    const r = await tools.run({
      id: 'c1',
      name: 'triage_symptoms',
      args: { symptoms: 'my face is swollen and I have difficulty breathing' },
    })
    expect((r.result as { band: string }).band).toBe('red')
    expect((r.result as { say: string }).say).toMatch(/verbatim/i)
    expect(practice.tasks.some((t) => t.urgency === 'high')).toBe(true)
    expect(events.some((e) => e.type === 'ui.event' && e.event === 'triage.escalated')).toBe(true)
  })

  it('creates a callback task when it cannot answer a question', async () => {
    const r = await tools.run({
      id: 'c1',
      name: 'search_knowledge',
      args: { query: 'do you sell electric toothbrushes from Oral B' },
    })
    expect((r.result as { found: boolean }).found).toBe(false)
    expect((r.result as { say: string }).say).toMatch(/do not invent/i)
    expect(practice.tasks.some((t) => t.kind === 'callback')).toBe(true)
  })

  it('rejects a treatment the practice does not offer', async () => {
    const r = await tools.run({ id: 'c1', name: 'check_availability', args: { service: 'hair transplant' } })
    expect(r.ok).toBe(false)
  })
})

describe('service resolution — what callers actually say', () => {
  const practice = new PracticeStore()
  const cases: [string, string][] = [
    ['cleaning', 'Scaling & Polishing'],
    ['teeth cleaning', 'Scaling & Polishing'],
    ['safai', 'Scaling & Polishing'],
    ['checkup', 'Consultation'],
    ['check up', 'Consultation'],
    ['rct', 'Root Canal'],
    ['root canal', 'Root Canal'],
    ['cap', 'Crown Fitting'],
    ['cavity', 'Composite Filling'],
    ['wisdom tooth', 'Wisdom Tooth Surgery'],
    ['wisdom teeth removal', 'Wisdom Tooth Surgery'],
    ['braces', 'Braces Consultation'],
    ['invisalign', 'Braces Consultation'],
    ['whitening', 'Teeth Whitening'],
    ['daant nikalwana hai', 'Tooth Extraction'],
    ['I want my teeth whitened', 'Teeth Whitening'],
  ]

  it.each(cases)('resolves "%s" to %s', (said, expected) => {
    expect(practice.findService(said)?.name).toBe(expected)
  })

  it('does not resolve a treatment the practice does not offer', () => {
    expect(practice.findService('hair transplant')).toBeUndefined()
  })
})

describe('booking integrity (spec §12, §14)', () => {
  it('refuses to book a slot taken since it was offered', () => {
    // The lost-update race: two callers offered the same time, both accept.
    const practice = new PracticeStore()
    const [slot] = practice.findSlots({ serviceId: 's2', limit: 1 })
    expect(slot).toBeDefined()

    const first = practice.bookAtomic({
      patientId: 'pt1', serviceId: 's2', start: slot!.start,
      providerId: slot!.providerId, operatoryId: slot!.operatoryId,
    })
    const second = practice.bookAtomic({
      patientId: 'pt2', serviceId: 's2', start: slot!.start,
      providerId: slot!.providerId, operatoryId: slot!.operatoryId,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('taken')
  })

  it('keeps the original appointment when a reschedule target is gone', () => {
    // Cancel-then-book would leave the patient with nothing at all.
    const practice = new PracticeStore()
    const [a, b] = practice.findSlots({ serviceId: 's2', limit: 2 })
    const booked = practice.bookAtomic({
      patientId: 'pt1', serviceId: 's2', start: a!.start,
      providerId: a!.providerId, operatoryId: a!.operatoryId,
    })
    expect(booked.ok).toBe(true)
    if (!booked.ok) return

    // Someone else takes the target slot first.
    practice.bookAtomic({
      patientId: 'pt2', serviceId: 's2', start: b!.start,
      providerId: b!.providerId, operatoryId: b!.operatoryId,
    })

    const moved = practice.reschedule({
      appointmentId: booked.appointment.id, start: b!.start,
      providerId: b!.providerId, operatoryId: b!.operatoryId,
    })
    expect(moved.ok).toBe(false)
    expect(booked.appointment.status).toBe('booked')
    expect(booked.appointment.start).toBe(a!.start)
  })

  it('moves an appointment when the target is free', () => {
    const practice = new PracticeStore()
    const [a, b] = practice.findSlots({ serviceId: 's2', limit: 2 })
    const booked = practice.bookAtomic({
      patientId: 'pt1', serviceId: 's2', start: a!.start,
      providerId: a!.providerId, operatoryId: a!.operatoryId,
    })
    if (!booked.ok) throw new Error('setup failed')

    const moved = practice.reschedule({
      appointmentId: booked.appointment.id, start: b!.start,
      providerId: b!.providerId, operatoryId: b!.operatoryId,
    })
    expect(moved.ok).toBe(true)
    expect(booked.appointment.start).toBe(b!.start)
    // Still exactly one appointment — moved, not duplicated.
    expect(practice.appointments.filter((x) => x.id === booked.appointment.id)).toHaveLength(1)
  })
})
