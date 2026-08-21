import type { IncomingMessage, ServerResponse } from 'node:http'
import { connect, OrgPracticeAdapter, OrgRepo, resolveTenant, normalisePhone } from '@vaani/db'
import {
  TWIML_CONTENT_TYPE,
  connectStream,
  decideRouting,
  parseForm,
  publicUrl,
  readVoiceRequest,
  sayAndHangUp,
  transferFailed,
  transferTo,
  verifyTwilioSignature,
} from '@vaani/telephony'

/**
 * The phone line.
 *
 * Twilio drives three HTTP endpoints and one WebSocket, and the ordering
 * between them is the whole design:
 *
 *   `POST /twilio/voice`   a call arrived. Prove it is really Twilio, work out
 *                          whose number was dialled, open a call record, and
 *                          answer with TwiML that hands the audio to us.
 *   `WS   /twilio/stream`  the audio itself, both directions.
 *   `POST /twilio/status`  the call ended — duration and disposition.
 *   `POST /twilio/transfer` the outcome of a transfer to a human.
 *
 * Tenant resolution happens once, in the voice webhook, and the answer is
 * carried to the stream as a custom parameter. Doing it again on the socket
 * would mean trusting a value that arrives over a different connection.
 */

/**
 * Read at call time, not at import.
 *
 * A rotated Twilio token then takes effect without a restart — and rotating
 * this credential is something a practice may have to do in a hurry.
 */
const authToken = (): string => process.env.TWILIO_AUTH_TOKEN ?? ''

export interface TelephonyDeps {
  /** Public wss:// address Twilio should stream to. */
  streamUrl: string
}

function reply(res: ServerResponse, twiml: string): void {
  res.writeHead(200, { 'content-type': TWIML_CONTENT_TYPE })
  res.end(twiml)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    // A webhook body is a few hundred bytes. Anything larger is not Twilio.
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Verify, then trust.
 *
 * Every field below — including the number that decides which clinic's data
 * gets read out — is attacker-controlled until the signature checks out. The
 * check therefore happens before anything is parsed for meaning, and a failure
 * returns 403 without revealing whether the number was recognised.
 */
async function authenticate(
  req: IncomingMessage,
): Promise<{ ok: true; params: Record<string, string> } | { ok: false }> {
  const token = authToken()
  if (!token) {
    console.error('[twilio] TWILIO_AUTH_TOKEN is not set — refusing every webhook')
    return { ok: false }
  }
  let body: string
  try {
    body = await readBody(req)
  } catch {
    return { ok: false }
  }
  const params = parseForm(body)
  const signature = req.headers['x-twilio-signature']
  const ok = verifyTwilioSignature({
    authToken: token,
    signature: Array.isArray(signature) ? signature[0] : signature,
    url: publicUrl(req as never),
    params,
  })
  return ok ? { ok: true, params } : { ok: false }
}

export async function handleVoice(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TelephonyDeps,
): Promise<void> {
  const auth = await authenticate(req)
  if (!auth.ok) {
    res.writeHead(403).end('forbidden')
    return
  }

  const call = readVoiceRequest(auth.params)
  if (!call) {
    res.writeHead(400).end('bad request')
    return
  }

  const { db } = connect()
  const tenant = await resolveTenant(db, call.To)
  if (!tenant) {
    // A number pointed at us that we do not own. Say something human and hang
    // up rather than leaking that the number is unknown to a specific clinic.
    console.warn(`[twilio] no tenant owns ${call.To}`)
    reply(res, sayAndHangUp('Sorry, this number is not in service. Please check and try again.'))
    return
  }

  const repo = new OrgRepo(db, tenant.orgId)
  const [org, branches] = await Promise.all([repo.org(), repo.branches()])
  if (!org || org.status !== 'active') {
    reply(res, sayAndHangUp('Sorry, this line is temporarily unavailable.'))
    return
  }

  // Caller ID recognition: a known patient is greeted by name rather than being
  // asked who they are for the fourth time this year.
  const patient = await repo.findPatientByPhone(normalisePhone(call.From))

  const row = await repo.startCall({
    channel: 'twilio',
    direction: 'inbound',
    externalId: call.CallSid,
    fromNumber: normalisePhone(call.From),
    toNumber: call.To,
    branchId: tenant.branchId ?? undefined,
    patientId: patient?.id,
  })
  await repo.trace(row.id, 'inbound', 0, { from: call.From, to: call.To, known: Boolean(patient) })

  const branch = branches.find((b) => b.id === tenant.branchId) ?? branches[0]
  const routing = decideRouting({
    hours: branch?.hours ?? [],
    timezone: org.timezone,
    emergencyPhone: branch?.emergencyPhone,
    receptionPhone: branch?.phone,
  })
  await repo.trace(row.id, 'routing', 5, { mode: routing.mode })

  reply(
    res,
    connectStream({
      wsUrl: deps.streamUrl,
      callId: row.id,
      orgId: tenant.orgId,
      branchId: tenant.branchId,
    }),
  )
}

/**
 * The call ended.
 *
 * Twilio is the authority on duration — it knows when the carrier actually
 * released the line, which is not the same as when our socket closed.
 */
export async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(req)
  if (!auth.ok) {
    res.writeHead(403).end('forbidden')
    return
  }
  const p = auth.params
  const { db } = connect()
  const tenant = p.To ? await resolveTenant(db, p.To) : null
  if (!tenant) {
    res.writeHead(204).end()
    return
  }

  const repo = new OrgRepo(db, tenant.orgId)
  const existing = (await repo.recentCalls({ limit: 50 })).find((c) => c.externalId === p.CallSid)
  if (existing) {
    await repo.finishCall(existing.id, {
      durationSec: Number(p.CallDuration ?? 0) || undefined,
      // Only set an outcome the conversation did not already record — a booked
      // call must not be overwritten as merely "answered" by the status hook.
      outcome: existing.outcome ?? (p.CallStatus === 'completed' ? 'answered' : 'failed'),
    })
  }
  res.writeHead(204).end()
}

/**
 * A transfer finished, one way or another.
 *
 * The case worth handling is the one where nobody picked up. Without this the
 * call simply ends and the practice never learns a patient asked for a human
 * and got a ringing tone.
 */
export async function handleTransferResult(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const auth = await authenticate(req)
  if (!auth.ok) {
    res.writeHead(403).end('forbidden')
    return
  }
  const p = auth.params
  const status = p.DialCallStatus ?? 'failed'
  if (status === 'completed' || status === 'answered') {
    reply(res, '<?xml version="1.0" encoding="UTF-8"?>\n<Response><Hangup/></Response>')
    return
  }

  const { db } = connect()
  const tenant = p.To ? await resolveTenant(db, p.To) : null
  if (tenant) {
    const repo = new OrgRepo(db, tenant.orgId)
    const call = (await repo.recentCalls({ limit: 50 })).find((c) => c.externalId === p.CallSid)
    if (call) {
      await repo.trace(call.id, 'transfer.failed', Date.now() - call.startedAt.getTime(), { status })
      await repo.escalate({
        callId: call.id,
        patientId: call.patientId ?? undefined,
        reason: 'Asked for a person; the transfer was not answered',
        urgency: 'high',
        brief: {
          patientPhone: call.fromNumber ?? undefined,
          reason: 'Transfer rang out',
          whatHappened: ['The caller asked to speak to someone.', `The transfer ended as "${status}".`],
          agentActions: ['Attempted to connect the call to reception.'],
          recommendedAction: 'Call this patient back — they asked for a human and did not get one.',
        },
      })
    }
  }

  reply(
    res,
    transferFailed(
      "I'm sorry, nobody is free at the moment. I've made a note and someone will call you back shortly.",
    ),
  )
}

/** TwiML that puts a caller through to a human, built for one branch. */
export function transferTwiml(opts: { to: string; callerId?: string; actionUrl: string }): string {
  return transferTo({
    to: opts.to,
    callerId: opts.callerId,
    actionUrl: opts.actionUrl,
    timeoutSec: 25,
    whisper: 'Connecting you now.',
  })
}

/**
 * A call arriving on the media socket.
 *
 * The tenant is read from the custom parameters Twilio echoes back, which were
 * set by the voice webhook after the signature was verified — the socket itself
 * carries no proof of origin, so nothing here may be trusted to name a tenant
 * on its own. A stream whose parameters do not resolve is dropped.
 */
export async function loadStreamContext(custom: Record<string, string>): Promise<{
  repo: OrgRepo
  adapter: OrgPracticeAdapter
  callId: string
  orgId: string
  branchId?: string
} | null> {
  const orgId = custom.orgId
  const callId = custom.callId
  if (!orgId || !callId) return null

  const { db } = connect()
  const repo = new OrgRepo(db, orgId)

  // The call row was created by the webhook under this org. If it is not there,
  // the parameters are not ones we issued.
  const call = await repo.call(callId)
  if (!call) return null

  const adapter = await OrgPracticeAdapter.load(repo, callId)
  return { repo, adapter, callId, orgId, branchId: custom.branchId }
}
