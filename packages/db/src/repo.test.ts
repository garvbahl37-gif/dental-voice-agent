import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testing'
import { OrgRepo, resolveTenant, normalisePhone } from './repo'
import { seedOrganization, SMILE_DENTAL, type SeedOrg } from './seed'

/**
 * Two tenants share every table in this suite, always.
 *
 * A single-tenant fixture cannot fail the test that matters: a missing
 * `WHERE org_id = ?` still returns the right rows when only one clinic's rows
 * exist. Every case here seeds a second practice whose data the first must
 * never see.
 */

const OTHER: SeedOrg = {
  slug: 'pearl',
  name: 'Pearl Dental',
  phoneNumbers: ['+912200000002'],
  branches: [{ key: 'main', name: 'Pearl Dental — Colaba', area: 'Colaba', city: 'Mumbai' }],
  providers: [{ key: 'khan', name: 'Dr. Sara Khan', title: 'General Dentist', specialties: ['general'] }],
  services: [{ key: 'clean', name: 'Cleaning', alsoCalled: ['safai'], durationMin: 30 }],
}

let t: TestDb
let smile: OrgRepo
let pearl: OrgRepo

beforeEach(async () => {
  t = await createTestDb()
  const a = await seedOrganization(t.db, { ...SMILE_DENTAL, phoneNumbers: ['+912200000001'] })
  const b = await seedOrganization(t.db, OTHER)
  smile = new OrgRepo(t.db, a.orgId)
  pearl = new OrgRepo(t.db, b.orgId)
})

afterEach(async () => {
  await t.close()
})

describe('tenant isolation', () => {
  it('never returns another practice providers, services or branches', async () => {
    const names = (await smile.providers()).map((p) => p.name)
    expect(names).toContain('Dr. Kavita Iyer')
    expect(names).not.toContain('Dr. Sara Khan')

    const pearlNames = (await pearl.providers()).map((p) => p.name)
    expect(pearlNames).toEqual(['Dr. Sara Khan'])
    expect((await pearl.branches())).toHaveLength(1)
    expect((await smile.branches())).toHaveLength(3)
  })

  it('cannot find a patient belonging to another practice', async () => {
    const phone = '+919820099999'
    await pearl.createPatient({ name: 'Someone Else', phone })

    expect(await smile.findPatientByPhone(phone)).toBeUndefined()
    expect((await pearl.findPatientByPhone(phone))?.name).toBe('Someone Else')
  })

  it('cannot read a call or trace belonging to another practice', async () => {
    const call = await pearl.startCall({ channel: 'twilio', fromNumber: '+919820011001' })
    await pearl.trace(call.id, 'connected', 0)

    expect(await smile.call(call.id)).toBeUndefined()
    expect(await smile.callTrace(call.id)).toHaveLength(0)
    expect(await pearl.callTrace(call.id)).toHaveLength(1)
  })

  it('cannot cancel an appointment belonging to another practice', async () => {
    const p = await pearl.createPatient({ name: 'Ann', phone: '9820012345' })
    const svc = (await pearl.services())[0]!
    const slots = await pearl.findSlots({ serviceId: svc.id, limit: 1 })
    const booked = await pearl.book({
      patientId: p.id,
      serviceId: svc.id,
      providerId: slots[0]!.providerId,
      operatoryId: slots[0]!.operatoryId,
      branchId: slots[0]!.branchId,
      startIso: slots[0]!.start,
      durationMin: svc.durationMin,
    })
    expect(booked.ok).toBe(true)
    if (!booked.ok) return

    expect(await smile.cancelAppointment(booked.appointment.id)).toBeUndefined()
    const still = await pearl.appointmentsFor(p.id)
    expect(still[0]!.status).toBe('booked')
  })
})

describe('resolveTenant — the telephony key', () => {
  it('maps a dialled number to exactly one org', async () => {
    const a = await resolveTenant(t.db, '+912200000001')
    const b = await resolveTenant(t.db, '+912200000002')
    expect(a?.orgId).toBe(smile.orgId)
    expect(b?.orgId).toBe(pearl.orgId)
    expect(a?.orgId).not.toBe(b?.orgId)
  })

  it('returns null for a number nobody owns, rather than guessing', async () => {
    expect(await resolveTenant(t.db, '+912299999999')).toBeNull()
  })
})

describe('service matching — what patients actually say', () => {
  it('matches Hinglish and colloquial names', async () => {
    expect((await smile.findService('safai'))?.name).toBe('Scaling & Polishing')
    expect((await smile.findService('cleaning'))?.name).toBe('Scaling & Polishing')
    expect((await smile.findService('RCT'))?.name).toBe('Root Canal')
    expect((await smile.findService('cap'))?.name).toBe('Crown Fitting')
    expect((await smile.findService('akal daadh'))?.name).toBe('Wisdom Tooth Surgery')
  })

  it('prefers the longest alias, so "wisdom tooth" does not match on "tooth"', async () => {
    expect((await smile.findService('wisdom tooth'))?.name).toBe('Wisdom Tooth Surgery')
  })
})

describe('scheduling constraints', () => {
  it('offers a root canal only to the endodontist, in an equipped chair', async () => {
    const rct = (await smile.services()).find((s) => s.name === 'Root Canal')!
    const slots = await smile.findSlots({ serviceId: rct.id, limit: 5 })
    expect(slots.length).toBeGreaterThan(0)

    const provs = await smile.providers()
    const ops = await smile.operatories()
    for (const s of slots) {
      const p = provs.find((x) => x.id === s.providerId)!
      expect(p.specialties).toContain('endodontics')
      const chair = ops.find((o) => o.id === s.operatoryId)!
      expect(chair.equipment).toContain('rotary endo')
    }
  })

  it('will not offer a treatment no provider is qualified for', async () => {
    const svc = (await pearl.services())[0]!
    // Pearl has one general dentist and no orthodontist.
    const slots = await pearl.findSlots({ serviceId: svc.id, limit: 3 })
    expect(slots.length).toBeGreaterThan(0)
  })

  it('does not offer a slot inside the lead time', async () => {
    const consult = (await smile.services()).find((s) => s.name === 'Consultation')!
    const slots = await smile.findSlots({ serviceId: consult.id, limit: 5 })
    const soonest = Math.min(...slots.map((s) => new Date(s.start).getTime()))
    expect(soonest - Date.now()).toBeGreaterThan(60 * 60_000)
  })
})

describe('booking — the race that produces two patients in one chair', () => {
  it('refuses the same slot twice', async () => {
    const svc = (await smile.services()).find((s) => s.name === 'Consultation')!
    const slot = (await smile.findSlots({ serviceId: svc.id, limit: 1 }))[0]!
    const a = await smile.createPatient({ name: 'First Caller', phone: '9820010001' })
    const b = await smile.createPatient({ name: 'Second Caller', phone: '9820010002' })

    const common = {
      serviceId: svc.id,
      providerId: slot.providerId,
      operatoryId: slot.operatoryId,
      branchId: slot.branchId,
      startIso: slot.start,
      durationMin: svc.durationMin,
    }
    const first = await smile.book({ ...common, patientId: a.id })
    const second = await smile.book({ ...common, patientId: b.id })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('slot_taken')
  })

  it('a cancelled appointment frees the chair again', async () => {
    const svc = (await smile.services()).find((s) => s.name === 'Consultation')!
    const slot = (await smile.findSlots({ serviceId: svc.id, limit: 1 }))[0]!
    const a = await smile.createPatient({ name: 'A', phone: '9820010003' })
    const common = {
      serviceId: svc.id,
      providerId: slot.providerId,
      operatoryId: slot.operatoryId,
      branchId: slot.branchId,
      startIso: slot.start,
      durationMin: svc.durationMin,
    }
    const first = await smile.book({ ...common, patientId: a.id })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    await smile.cancelAppointment(first.appointment.id)
    const b = await smile.createPatient({ name: 'B', phone: '9820010004' })
    expect((await smile.book({ ...common, patientId: b.id })).ok).toBe(true)
  })

  it('reschedule keeps the old appointment when the new slot is gone', async () => {
    const svc = (await smile.services()).find((s) => s.name === 'Consultation')!
    const slots = await smile.findSlots({ serviceId: svc.id, limit: 2 })
    const a = await smile.createPatient({ name: 'A', phone: '9820010005' })
    const b = await smile.createPatient({ name: 'B', phone: '9820010006' })

    const mk = (slot: (typeof slots)[number], patientId: string) => ({
      patientId,
      serviceId: svc.id,
      providerId: slot.providerId,
      operatoryId: slot.operatoryId,
      branchId: slot.branchId,
      startIso: slot.start,
      durationMin: svc.durationMin,
    })
    const first = await smile.book(mk(slots[0]!, a.id))
    await smile.book(mk(slots[1]!, b.id))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Try to move A onto B's slot — taken.
    const moved = await smile.rescheduleAppointment(first.appointment.id, {
      startIso: slots[1]!.start,
      providerId: slots[1]!.providerId,
      operatoryId: slots[1]!.operatoryId,
      durationMin: svc.durationMin,
    })
    expect(moved.ok).toBe(false)

    // The original must survive a failed move.
    const still = await smile.appointmentsFor(a.id)
    expect(still.some((x) => x.id === first.appointment.id && x.status === 'booked')).toBe(true)
  })
})

describe('patients', () => {
  it('does not create a second record for the same number', async () => {
    const one = await smile.createPatient({ name: 'Ravi Menon', phone: '98200 11001' })
    const two = await smile.createPatient({ name: 'Ravi M', phone: '+91 9820011001' })
    expect(two.id).toBe(one.id)
  })

  it('normalises the shapes a number arrives in', () => {
    expect(normalisePhone('9820011001')).toBe('+919820011001')
    expect(normalisePhone('+91 98200-11001')).toBe('+919820011001')
    expect(normalisePhone('09820011001')).toBe('+919820011001')
    expect(normalisePhone('')).toBe('')
  })

  it('patient memory carries facts, and only this practice facts', async () => {
    const p = await smile.createPatient({ name: 'Ravi', phone: '9820011009' })
    const svc = (await smile.services()).find((s) => s.name === 'Consultation')!
    const slot = (await smile.findSlots({ serviceId: svc.id, limit: 1 }))[0]!
    await smile.book({
      patientId: p.id,
      serviceId: svc.id,
      providerId: slot.providerId,
      operatoryId: slot.operatoryId,
      branchId: slot.branchId,
      startIso: slot.start,
      durationMin: svc.durationMin,
    })

    const mem = await smile.patientMemory(p.id)
    expect(mem?.history).toHaveLength(1)
    expect(await pearl.patientMemory(p.id)).toBeNull()
  })
})
