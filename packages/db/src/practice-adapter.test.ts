import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testing'
import { OrgRepo } from './repo'
import { seedOrganization, SMILE_DENTAL } from './seed'
import { OrgPracticeAdapter } from './practice-adapter'

/**
 * The adapter the phone line books through.
 *
 * The agent's tools were written against the in-memory store, which knows each
 * treatment's length, so they never passed one. The adapter needed it, and
 * worked out the end of every phone booking as NaN: the booking failed, and
 * the caller had already been told it was done. These pin the adapter to doing
 * the sum itself.
 */

let t: TestDb
let repo: OrgRepo
let adapter: OrgPracticeAdapter

beforeEach(async () => {
  t = await createTestDb()
  const org = await seedOrganization(t.db, { ...SMILE_DENTAL, phoneNumbers: ['+912200000001'] })
  repo = new OrgRepo(t.db, org.orgId)
  adapter = await OrgPracticeAdapter.load(repo)
})

afterEach(async () => {
  await t.close()
})

const minutes = (a: { startAt: Date; endAt: Date }) => (a.endAt.getTime() - a.startAt.getTime()) / 60_000

describe('booking through the adapter, as the agent calls it', () => {
  it('books without being told the length, taking the treatment’s own', async () => {
    const svc = adapter.services.find((s) => s.name === 'Consultation')!
    const [slot] = await adapter.findSlots({ serviceId: svc.id, limit: 1 })
    const patient = await adapter.createPatient({ name: 'Ravi Menon', phone: '9820011002' })

    // Exactly the fields the tool passes — no `durationMin`, no branch.
    const out = await adapter.bookAtomic({
      patientId: patient.id,
      serviceId: svc.id,
      start: slot!.start,
      providerId: slot!.providerId,
      operatoryId: slot!.operatoryId,
    })

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.appointment.durationMin).toBe(svc.durationMin)
    const [row] = await repo.appointmentsFor(patient.id)
    expect(row && minutes(row)).toBe(svc.durationMin)
  })

  it('refuses a treatment it does not know rather than writing a broken row', async () => {
    const [slot] = await adapter.findSlots({ serviceId: adapter.services[0]!.id, limit: 1 })
    const patient = await adapter.createPatient({ name: 'Ravi Menon', phone: '9820011003' })
    const out = await adapter.bookAtomic({
      patientId: patient.id,
      serviceId: 'no-such-service',
      start: slot!.start,
      providerId: slot!.providerId,
      operatoryId: slot!.operatoryId,
    })
    expect(out.ok).toBe(false)
  })

  it('moves an appointment without being told the length, keeping its own', async () => {
    const svc = adapter.services.find((s) => s.name === 'Consultation')!
    // The second slot must not overlap the first: a move books the new time
    // before letting go of the old one, so an overlapping one is refused.
    const slots = await adapter.findSlots({ serviceId: svc.id, limit: 20 })
    const first = slots[0]
    const second = slots.find(
      (x) => new Date(x.start).getTime() >= new Date(first!.start).getTime() + svc.durationMin * 60_000,
    )
    const patient = await adapter.createPatient({ name: 'Ravi Menon', phone: '9820011004' })
    const booked = await adapter.bookAtomic({
      patientId: patient.id,
      serviceId: svc.id,
      start: first!.start,
      providerId: first!.providerId,
      operatoryId: first!.operatoryId,
    })
    expect(booked.ok).toBe(true)
    if (!booked.ok) return

    const moved = await adapter.reschedule({
      appointmentId: booked.appointment.id,
      start: second!.start,
      providerId: second!.providerId,
      operatoryId: second!.operatoryId,
    })

    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.appointment.durationMin).toBe(svc.durationMin)
    expect(moved.appointment.start).toBe(new Date(second!.start).toISOString())
  })
})
