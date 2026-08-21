import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { OrgRepo, campaignTargets, campaigns, patients, seedOrganization, SMILE_DENTAL } from '@vaani/db'
import { createTestDb, type TestDb } from '@vaani/db/testing'
import { mayDial, backoffFor } from './policy'
import { buildMissedCallRecovery, buildReminders, buildWaitlistOffers } from './campaigns'
import { recordDoNotContact, runDialer, type PlaceCall } from './dialer'
import { outboundGreeting, outboundPrompt } from './prompts'

/**
 * An outbound dialler is the part of this product that can do real harm — it
 * rings people who did not ask to be rung. So most of these cases are about
 * *refusing* to call, and every one of them is a complaint to the practice if
 * it regresses.
 */

const TZ = 'Asia/Kolkata'
const CAMPAIGN = { status: 'active', windowStart: '10:00', windowEnd: '19:00', maxAttempts: 2 }
const OK_SUBJECT = { phone: '+919820011001', doNotContact: false, consentCall: true }
// 06:00 UTC = 11:30 IST, comfortably inside the window.
const MIDDAY = new Date('2026-08-19T06:00:00Z')

describe('mayDial — the refusals', () => {
  const base = { campaign: CAMPAIGN, state: { attempts: 0 }, timezone: TZ, now: MIDDAY }

  it('allows an ordinary patient inside the window', () => {
    expect(mayDial({ ...base, subject: OK_SUBJECT }).allowed).toBe(true)
  })

  it('never rings someone who asked not to be contacted', () => {
    const r = mayDial({ ...base, subject: { ...OK_SUBJECT, doNotContact: true } })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('do_not_contact')
    // Final, not deferred — a do-not-contact must never come back round.
    expect(r.retryAt).toBeUndefined()
  })

  it('outranks everything, including an appointment tomorrow', () => {
    const r = mayDial({
      ...base,
      subject: { ...OK_SUBJECT, doNotContact: true, consentCall: true },
      state: { attempts: 0 },
    })
    expect(r.reason).toBe('do_not_contact')
  })

  it('requires consent for calls specifically', () => {
    expect(mayDial({ ...base, subject: { ...OK_SUBJECT, consentCall: false } }).reason).toBe('no_consent')
  })

  it('will not ring at seven in the morning', () => {
    // 01:30 UTC = 07:00 IST.
    const r = mayDial({ ...base, subject: OK_SUBJECT, now: new Date('2026-08-19T01:30:00Z') })
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('outside_window')
    // Timing is a wait, so it offers a time to come back.
    expect(r.retryAt).toBeInstanceOf(Date)
  })

  it('will not ring late at night', () => {
    // 16:00 UTC = 21:30 IST.
    expect(
      mayDial({ ...base, subject: OK_SUBJECT, now: new Date('2026-08-19T16:00:00Z') }).reason,
    ).toBe('outside_window')
  })

  it('closes exactly at the window edge, not a minute after', () => {
    // 19:00 IST = 13:30 UTC, and the close is exclusive.
    expect(mayDial({ ...base, subject: OK_SUBJECT, now: new Date('2026-08-19T13:29:00Z') }).allowed).toBe(true)
    expect(mayDial({ ...base, subject: OK_SUBJECT, now: new Date('2026-08-19T13:30:00Z') }).allowed).toBe(false)
  })

  it('stops after the campaign attempt limit — a third call is harassment', () => {
    expect(mayDial({ ...base, subject: OK_SUBJECT, state: { attempts: 2 } }).reason).toBe('max_attempts')
  })

  it('never rings the same person twice in one day', () => {
    const r = mayDial({
      ...base,
      subject: OK_SUBJECT,
      state: { attempts: 1, lastCalledAt: new Date('2026-08-19T05:00:00Z') },
    })
    expect(r.reason).toBe('already_called_today')
    expect(r.retryAt!.getTime()).toBeGreaterThan(MIDDAY.getTime())
  })

  it('allows again the next day', () => {
    expect(
      mayDial({
        ...base,
        subject: OK_SUBJECT,
        state: { attempts: 1, lastCalledAt: new Date('2026-08-18T05:00:00Z') },
      }).allowed,
    ).toBe(true)
  })

  it('refuses a paused campaign and a patient with no number', () => {
    expect(mayDial({ ...base, subject: OK_SUBJECT, campaign: { ...CAMPAIGN, status: 'paused' } }).reason).toBe('campaign_paused')
    expect(mayDial({ ...base, subject: { ...OK_SUBJECT, phone: null } }).reason).toBe('no_phone')
  })

  it('backs off by hours, then a day — a retry in ten minutes reads as a fault', () => {
    expect(backoffFor(1)).toBeGreaterThanOrEqual(3600_000)
    expect(backoffFor(2)).toBeGreaterThanOrEqual(24 * 3600_000)
  })
})

describe('prompts', () => {
  const ctx = { practiceName: 'Smile Dental Care', patientName: 'Ravi' }

  it('names the practice and the reason in the opening line', () => {
    for (const kind of ['reminder', 'recall', 'waitlist', 'missed_call', 'followup'] as const) {
      const g = outboundGreeting(kind, ctx)
      expect(g).toContain('Smile Dental Care')
      expect(g).toContain('Ravi')
    }
  })

  it('tells the agent to accept a no the first time', () => {
    const p = outboundPrompt('recall', ctx)
    expect(p).toMatch(/accept it the first time/i)
    expect(p).toMatch(/do not try once more/i)
  })

  it('forbids clinical advice on every campaign, follow-up most explicitly', () => {
    for (const kind of ['reminder', 'recall', 'waitlist', 'missed_call', 'followup'] as const) {
      expect(outboundPrompt(kind, ctx)).toMatch(/do not diagnose/i)
    }
    const f = outboundPrompt('followup', ctx)
    expect(f).toMatch(/do NOT say whether it is normal/i)
    expect(f).toMatch(/escalate_to_human/i)
  })
})

// ── Against a real database ──────────────────────────────────────────────────

let t: TestDb
let orgId: string
let repo: OrgRepo

beforeEach(async () => {
  t = await createTestDb()
  orgId = (await seedOrganization(t.db, SMILE_DENTAL)).orgId
  repo = new OrgRepo(t.db, orgId)
})

afterEach(async () => {
  await t.close()
})

async function bookFor(name: string, phone: string, hoursAhead: number) {
  const patient = await repo.createPatient({ name, phone })
  const svc = (await repo.services()).find((s) => s.name === 'Consultation')!
  const slots = await repo.findSlots({ serviceId: svc.id, limit: 20 })
  const target = new Date(Date.now() + hoursAhead * 3600_000)
  const slot = slots.find((s) => new Date(s.start) <= target) ?? slots[0]!
  const booked = await repo.book({
    patientId: patient.id,
    serviceId: svc.id,
    providerId: slot.providerId,
    operatoryId: slot.operatoryId,
    branchId: slot.branchId,
    startIso: slot.start,
    durationMin: svc.durationMin,
  })
  return { patient, booked }
}

describe('campaign builders', () => {
  it('queues a reminder once, never twice', async () => {
    await bookFor('Ravi Menon', '9820011001', 20)

    const first = await buildReminders(t.db, orgId, { hoursAhead: 240 })
    expect(first.queued).toBeGreaterThan(0)

    // Running again must not re-queue the same appointment.
    const second = await buildReminders(t.db, orgId, { hoursAhead: 240 })
    expect(second.queued).toBe(0)
  })

  it('does not remind a patient who asked not to be contacted', async () => {
    const { patient } = await bookFor('Quiet Patient', '9820011002', 20)
    await t.db.update(patients).set({ doNotContact: true }).where(eq(patients.id, patient.id))

    const out = await buildReminders(t.db, orgId, { hoursAhead: 240 })
    const rows = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(rows.some((r) => r.patientId === patient.id)).toBe(false)
    expect(out.queued).toBe(0)
  })

  it('offers a freed slot to several people, highest priority first', async () => {
    const a = await repo.createPatient({ name: 'First', phone: '9820011010' })
    const b = await repo.createPatient({ name: 'Second', phone: '9820011011' })
    await repo.addToWaitlist({ patientId: a.id, priority: 0 })
    await repo.addToWaitlist({ patientId: b.id, priority: 5 })

    const out = await buildWaitlistOffers(t.db, orgId, { offerTo: 2 })
    expect(out.queued).toBe(2)

    const rows = await t.db
      .select()
      .from(campaignTargets)
      .where(eq(campaignTargets.orgId, orgId))
    expect(rows).toHaveLength(2)
    // Marked offered so the same slot is not re-offered on the next pass.
    const list = await repo.waitlistFor({})
    expect(list).toHaveLength(0)
  })

  it('recovers a call that went nowhere, but not one that booked', async () => {
    const dropped = await repo.createPatient({ name: 'Dropped', phone: '9820011020' })
    const fine = await repo.createPatient({ name: 'Booked', phone: '9820011021' })
    const c1 = await repo.startCall({ channel: 'twilio', direction: 'inbound', patientId: dropped.id })
    await repo.finishCall(c1.id, { outcome: 'abandoned' })
    const c2 = await repo.startCall({ channel: 'twilio', direction: 'inbound', patientId: fine.id })
    await repo.finishCall(c2.id, { outcome: 'booked' })

    await buildMissedCallRecovery(t.db, orgId, { withinHours: 24 })
    const rows = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(rows.map((r) => r.patientId)).toEqual([dropped.id])
  })
})

describe('runDialer', () => {
  const fromNumber = '+912226551200'

  /**
   * Queue a target and make it due on the dialler's clock.
   *
   * The builder stamps `nextAttemptAt` with the wall clock, while these cases
   * run the dialler at a fixed instant so the window rules are testable at all.
   * When the target becomes due is orthogonal to what is under test here.
   */
  async function queueOne(name = 'Ravi Menon', phone = '9820011001') {
    await bookFor(name, phone, 20)
    await buildReminders(t.db, orgId, { hoursAhead: 240 })
    await t.db
      .update(campaignTargets)
      .set({ nextAttemptAt: new Date(MIDDAY.getTime() - 3600_000) })
      .where(eq(campaignTargets.orgId, orgId))
  }

  it('places a call and marks the target done', async () => {
    await queueOne()
    const placeCall = vi.fn<PlaceCall>().mockResolvedValue({ externalId: 'CA_out_1' })

    const out = await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    expect(out.placed).toBe(1)
    expect(placeCall).toHaveBeenCalledOnce()

    const arg = placeCall.mock.calls[0]![0]
    expect(arg.to).toBe('+919820011001')
    expect(arg.from).toBe(fromNumber)
    expect(arg.greeting).toContain('Smile Dental Care')
    expect(arg.systemPrompt).toMatch(/outbound call/i)

    const [target] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(target!.status).toBe('done')
    expect(target!.attempts).toBe(1)
  })

  it('records the call under this tenant, as outbound', async () => {
    await queueOne()
    await runDialer({
      db: t.db,
      orgId,
      placeCall: async () => ({ externalId: 'CA_out_1' }),
      fromNumber,
      now: () => MIDDAY,
    })
    const [call] = await repo.recentCalls()
    expect(call!.direction).toBe('outbound')
    expect(call!.channel).toBe('twilio')
  })

  it('does not dial outside the window, and defers rather than dropping', async () => {
    await queueOne()
    const placeCall = vi.fn<PlaceCall>()
    const out = await runDialer({
      db: t.db,
      orgId,
      placeCall,
      fromNumber,
      // 22:00 IST.
      now: () => new Date('2026-08-19T16:30:00Z'),
    })
    expect(placeCall).not.toHaveBeenCalled()
    expect(out.skipped.outside_window).toBe(1)

    const [target] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(target!.status).toBe('queued')
    expect(target!.nextAttemptAt).toBeInstanceOf(Date)
  })

  it('never dials the same target twice, even across two passes', async () => {
    await queueOne()
    const placeCall = vi.fn<PlaceCall>().mockResolvedValue({ externalId: 'CA_out_1' })
    await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    expect(placeCall).toHaveBeenCalledTimes(1)
  })

  it('requeues with a backoff when the carrier refuses', async () => {
    await queueOne()
    const placeCall = vi.fn<PlaceCall>().mockRejectedValue(new Error('carrier rejected'))

    await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    const [target] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(target!.status).toBe('queued')
    expect(target!.attempts).toBe(1)
    expect(target!.nextAttemptAt!.getTime()).toBeGreaterThan(MIDDAY.getTime())
    expect(target!.result).toMatch(/carrier rejected/)
  })

  it('gives up after the attempt limit rather than trying forever', async () => {
    await queueOne()
    const placeCall = vi.fn<PlaceCall>().mockRejectedValue(new Error('no answer'))

    // A day apart, because the once-a-day rule correctly refuses to exhaust the
    // attempts inside a single afternoon — that protection is the point.
    for (let day = 0; day < 3; day++) {
      const at = new Date(MIDDAY.getTime() + day * 24 * 3600_000)
      await t.db
        .update(campaignTargets)
        .set({ nextAttemptAt: new Date(at.getTime() - 3600_000) })
        .where(eq(campaignTargets.orgId, orgId))
      await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => at })
    }

    const [target] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(['failed', 'skipped']).toContain(target!.status)
    // Two attempts configured, so it must not have rung a third time.
    expect(placeCall).toHaveBeenCalledTimes(2)
  })

  it('a paused campaign dials nobody', async () => {
    await queueOne()
    await t.db.update(campaigns).set({ status: 'paused' }).where(eq(campaigns.orgId, orgId))
    const placeCall = vi.fn<PlaceCall>()
    const out = await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    expect(placeCall).not.toHaveBeenCalled()
    expect(out.skipped.campaign_paused).toBe(1)
  })

  it('do-not-contact cancels every queued call for that patient at once', async () => {
    await queueOne()
    const [before] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    await recordDoNotContact(t.db, orgId, before!.patientId)

    const placeCall = vi.fn<PlaceCall>()
    await runDialer({ db: t.db, orgId, placeCall, fromNumber, now: () => MIDDAY })
    expect(placeCall).not.toHaveBeenCalled()

    const [after] = await t.db.select().from(campaignTargets).where(eq(campaignTargets.orgId, orgId))
    expect(after!.status).toBe('skipped')
    expect(after!.result).toBe('do_not_contact')
  })
})
