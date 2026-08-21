import { connect } from './client'
import { OrgRepo } from './repo'
import type { CallTurn } from './schema'

/**
 * A week of plausible call history for a demo tenant.
 *
 * Explicitly *not* a flattering week. Roughly a quarter of calls end without a
 * booking, a couple need a human, and one is an emergency — because a dashboard
 * demoed on perfect data teaches nobody what the product looks like on a
 * Tuesday, and the tiles that matter (missed, needs a human) would render empty
 * and untested.
 *
 * Deterministic: the same seed produces the same week, so a screenshot taken
 * today matches one taken next month.
 */

function mulberry(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CALLERS: Array<[string, string, string]> = [
  ['Ravi Menon', '+919820011001', 'en-IN'],
  ['Priya Sharma', '+919820011002', 'hi-Latn-IN'],
  ['Aditya Rao', '+919820011003', 'en-IN'],
  ['Fatima Sheikh', '+919820011004', 'hi-IN'],
  ['Vikram Shetty', '+919820011005', 'hi-Latn-IN'],
  ['Neha Kulkarni', '+919820011006', 'hi-IN'],
  ['Arjun Pillai', '+919820011007', 'en-IN'],
]

const SCRIPTS: Record<string, CallTurn[]> = {
  booked: [
    { speaker: 'agent', text: 'Smile Dental Care, good morning. How can I help?', atMs: 400 },
    { speaker: 'caller', text: 'Mujhe cleaning ke liye appointment chahiye tha.', lang: 'hi-Latn-IN', atMs: 4200 },
    { speaker: 'agent', text: 'Bilkul — scaling and polishing. Bandra, Andheri ya Powai?', atMs: 7100 },
    { speaker: 'caller', text: 'Bandra.', lang: 'hi-Latn-IN', atMs: 11000 },
    { speaker: 'agent', text: 'Thursday at ten fifteen with Dr. Iyer. Shall I book that?', atMs: 15400 },
    { speaker: 'caller', text: 'Yes please.', lang: 'en-IN', atMs: 19000 },
    { speaker: 'agent', text: 'Done. Thursday, ten fifteen, Dr. Iyer at Bandra.', atMs: 22000 },
  ],
  answered: [
    { speaker: 'agent', text: 'Smile Dental Care, good afternoon.', atMs: 400 },
    { speaker: 'caller', text: 'What time do you close today?', lang: 'en-IN', atMs: 3600 },
    { speaker: 'agent', text: 'Bandra is open until half past seven this evening.', atMs: 6200 },
    { speaker: 'caller', text: 'Thanks, I will call back.', lang: 'en-IN', atMs: 9800 },
  ],
  escalated: [
    { speaker: 'agent', text: 'Smile Dental Care, good evening.', atMs: 400 },
    { speaker: 'caller', text: 'Mujhe apne bill ke baare mein baat karni hai.', lang: 'hi-Latn-IN', atMs: 4000 },
    { speaker: 'agent', text: 'Main aapko accounts se connect karti hoon.', atMs: 7600 },
  ],
  emergency: [
    { speaker: 'agent', text: 'Smile Dental Care, good evening.', atMs: 400 },
    { speaker: 'caller', text: 'चेहरा सूज गया है और बुखार भी है।', lang: 'hi-IN', atMs: 3900 },
    { speaker: 'agent', text: 'यह तुरंत दिखाना ज़रूरी है। हमारी इमरजेंसी लाइन नोट कीजिए।', atMs: 7400 },
  ],
}

export async function seedDemoCalls(orgId: string, days = 7): Promise<number> {
  const { db } = connect()
  const repo = new OrgRepo(db, orgId)
  const rnd = mulberry(20260821)

  const services = await repo.services()
  const branches = await repo.branches()
  const consult = services.find((s) => s.name === 'Scaling & Polishing') ?? services[0]!
  let created = 0

  for (let day = days - 1; day >= 0; day--) {
    // Weekends are quieter, and a flat distribution looks synthetic at a glance.
    const at = new Date()
    at.setDate(at.getDate() - day)
    const weekend = at.getDay() === 0 || at.getDay() === 6
    const volume = weekend ? 2 + Math.floor(rnd() * 3) : 6 + Math.floor(rnd() * 6)

    for (let i = 0; i < volume; i++) {
      const [name, phone, lang] = CALLERS[Math.floor(rnd() * CALLERS.length)]!
      const roll = rnd()
      const kind = roll < 0.55 ? 'booked' : roll < 0.82 ? 'answered' : roll < 0.95 ? 'escalated' : 'emergency'

      const started = new Date(at)
      started.setHours(10 + Math.floor(rnd() * 9), Math.floor(rnd() * 60), 0, 0)
      if (started.getTime() > Date.now()) continue

      const patient = await repo.createPatient({ name, phone, preferredLanguage: lang })
      const call = await repo.startCall({
        channel: rnd() < 0.75 ? 'twilio' : 'web',
        direction: 'inbound',
        fromNumber: phone,
        toNumber: branches[0]?.phone ?? undefined,
        branchId: branches[Math.floor(rnd() * branches.length)]?.id,
        patientId: patient.id,
        startedAt: started,
      })

      const transcript = SCRIPTS[kind]!
      const durationSec = 25 + Math.floor(rnd() * 95)
      const firstResponse = 700 + Math.floor(rnd() * 900)

      await repo.trace(call.id, 'inbound', 0, { from: phone })
      await repo.trace(call.id, 'routing', 5, { mode: 'open' })
      if (kind === 'booked') await repo.trace(call.id, 'tool.book_appointment', 14_000, {}, { ok: true })

      await repo.finishCall(call.id, {
        durationSec,
        language: lang,
        outcome: kind === 'emergency' ? 'escalated' : (kind as never),
        triageBand: kind === 'emergency' ? 'RED' : undefined,
        transcript,
        transferred: kind === 'escalated',
        firstResponseMs: firstResponse,
        avgResponseMs: firstResponse + Math.floor(rnd() * 500),
        bargeInCount: Math.floor(rnd() * 3),
        endedAt: new Date(started.getTime() + durationSec * 1000),
        // Roughly what a one-to-two-minute native-audio call costs: ₹5–14.
        costPaise: 500 + Math.floor(rnd() * 900),
      })

      if (kind === 'booked') {
        const slots = await repo.findSlots({ serviceId: consult.id, limit: 1 })
        if (slots[0]) {
          await repo.book({
            patientId: patient.id,
            serviceId: consult.id,
            providerId: slots[0].providerId,
            operatoryId: slots[0].operatoryId,
            branchId: slots[0].branchId,
            startIso: slots[0].start,
            durationMin: consult.durationMin,
            callId: call.id,
          })
        }
      }

      if (kind === 'escalated' || kind === 'emergency') {
        await repo.escalate({
          callId: call.id,
          patientId: patient.id,
          reason: kind === 'emergency' ? 'Facial swelling with fever — seen the same day' : 'Billing question the agent cannot answer',
          urgency: kind === 'emergency' ? 'emergency' : 'normal',
          brief: {
            patientName: name,
            patientPhone: phone,
            language: lang,
            reason: kind === 'emergency' ? 'Facial swelling with fever' : 'Billing question',
            whatHappened:
              kind === 'emergency'
                ? ['Caller described swelling and a fever.', 'Triage returned RED.']
                : ['Caller asked about a charge on their last invoice.'],
            agentActions:
              kind === 'emergency'
                ? ['Gave the branch emergency number.', 'Did not offer a routine appointment.']
                : ['Offered to have accounts call back.'],
            recommendedAction:
              kind === 'emergency'
                ? 'Call this patient now — they were told to expect us.'
                : 'Have accounts return the call today.',
          },
        })
      }
      created += 1
    }
  }
  return created
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const orgId = process.argv[2] ?? 'org_smile'
  seedDemoCalls(orgId)
    .then((n) => {
      console.log(`  created ${n} demo calls for ${orgId}`)
      process.exit(0)
    })
    .catch((err) => {
      console.error('demo seed failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
