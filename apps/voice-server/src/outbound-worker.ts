import { activeOrganizations, connect } from '@vaani/db'
import {
  BUILDERS,
  releaseStuck,
  runDialer,
  type PlaceCall,
  type CampaignKind,
} from '@vaani/outbound'

/**
 * The outbound worker.
 *
 * Runs on a timer inside the voice server rather than as a separate service:
 * an outbound call needs the same Live session, the same tools and the same
 * clinical guard as an inbound one, and a second process would mean a second
 * copy of all of it.
 *
 * Two passes, in order. **Build** decides who should be rung — cheap queries,
 * run often, because the population changes as appointments are cancelled.
 * **Dial** places calls, in small batches. A clinic ringing five people at once
 * is a clinic; fifty at once is a call centre, and nothing about this product
 * should feel like one.
 *
 * Every pass is per-tenant and scoped by `orgId`. Nothing here can reach across
 * practices.
 */

const OUTBOUND_ENABLED = () => process.env.OUTBOUND_ENABLED === 'true'
const TICK_MS = Number(process.env.OUTBOUND_TICK_MS ?? 5 * 60_000)

/**
 * Place a real call through Twilio.
 *
 * The campaign's greeting and prompt travel as custom parameters on the stream,
 * exactly as inbound does — so the media socket needs no special case for
 * outbound, and the two paths cannot drift.
 */
export function twilioPlaceCall(streamUrl: string): PlaceCall {
  return async (input) => {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    if (!sid || !token) throw new Error('Twilio is not configured')

    const params = new URLSearchParams({
      To: input.to,
      From: input.from,
      // The same TwiML shape as an inbound answer, with the campaign context
      // attached so the stream handler knows what this call is about.
      Twiml: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Response><Connect>',
        `<Stream url="${escapeXml(streamUrl)}">`,
        `<Parameter name="callId" value="${escapeXml(input.callId)}"/>`,
        `<Parameter name="orgId" value="${escapeXml(input.orgId)}"/>`,
        `<Parameter name="campaign" value="${escapeXml(input.campaignKind)}"/>`,
        '</Stream></Connect></Response>',
      ].join(''),
      // A machine answering a machine wastes the practice's money; hang up.
      MachineDetection: 'Enable',
      AsyncAmd: 'false',
      Timeout: '25',
    })

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
    })

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string }
      throw new Error(body.message ?? `Twilio refused the call (${res.status})`)
    }
    const body = (await res.json()) as { sid: string }
    return { externalId: body.sid }
  }
}

function escapeXml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const KINDS: CampaignKind[] = ['reminder', 'recall', 'waitlist', 'missed_call', 'followup']

export async function outboundPass(streamUrl: string): Promise<void> {
  const { db } = connect()
  const orgs = await activeOrganizations(db)

  for (const org of orgs) {
    // A practice with no number of its own cannot make outbound calls, and
    // borrowing another tenant's caller ID would be both wrong and confusing.
    if (!org.outboundNumber) continue

    try {
      await releaseStuck(db, org.id)
      for (const kind of KINDS) {
        const built = await BUILDERS[kind](db, org.id, {})
        if (built.queued > 0) console.log(`[outbound] ${org.name}: queued ${built.queued} ${kind}`)
      }

      const out = await runDialer({
        db,
        orgId: org.id,
        placeCall: twilioPlaceCall(streamUrl),
        fromNumber: org.outboundNumber,
      })
      if (out.placed > 0 || out.attempted > 0) {
        console.log(
          `[outbound] ${org.name}: ${out.placed} placed, ${out.attempted - out.placed} held back ` +
            `(${Object.entries(out.skipped).map(([k, n]) => `${k}=${n}`).join(', ') || 'none'})`,
        )
      }
    } catch (err) {
      // One tenant's failure must not stop the others being served.
      console.error(`[outbound] ${org.name} failed:`, err instanceof Error ? err.message : err)
    }
  }
}

export function startOutboundWorker(streamUrl: string): () => void {
  if (!OUTBOUND_ENABLED()) {
    console.log('[outbound] disabled — set OUTBOUND_ENABLED=true to let it ring people')
    return () => undefined
  }
  console.log(`[outbound] worker started, every ${Math.round(TICK_MS / 60_000)} min`)

  let running = false
  const tick = async () => {
    // Never overlap: a slow pass must not have a second one dialling behind it.
    if (running) return
    running = true
    try {
      await outboundPass(streamUrl)
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS)
  return () => clearInterval(timer)
}
