import { connect, OrgRepo } from '@vaani/db'
import { requireApiKey } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Open slots, so a practice management system can show the same diary. */
export async function GET(req: Request): Promise<Response> {
  const auth = await requireApiKey(req)
  if ('error' in auth) return auth.error

  const url = new URL(req.url)
  const serviceId = url.searchParams.get('serviceId')
  const { db } = connect()
  const repo = new OrgRepo(db, auth.caller.orgId)

  if (!serviceId) {
    const services = await repo.services()
    return Response.json({
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        durationMin: s.durationMin,
        priceMinPaise: s.priceMinPaise,
        priceMaxPaise: s.priceMaxPaise,
      })),
    })
  }

  const slots = await repo.findSlots({
    serviceId,
    branchId: url.searchParams.get('branchId') ?? undefined,
    limit: Math.min(50, Number(url.searchParams.get('limit') ?? 10)),
  })
  return Response.json({ slots })
}

/**
 * Book on a patient's behalf.
 *
 * Write scope, and the same transactional guard the phone agent uses — an
 * integration racing the agent for the last chair must lose cleanly rather than
 * produce two patients in one room.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await requireApiKey(req, 'write')
  if ('error' in auth) return auth.error

  let body: {
    patientName?: string
    patientPhone?: string
    serviceId?: string
    providerId?: string
    operatoryId?: string
    branchId?: string
    startIso?: string
    durationMin?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }

  const missing = ['patientName', 'patientPhone', 'serviceId', 'providerId', 'operatoryId', 'branchId', 'startIso']
    .filter((k) => !body[k as keyof typeof body])
  if (missing.length > 0) {
    return Response.json({ error: `Missing: ${missing.join(', ')}` }, { status: 400 })
  }

  const { db } = connect()
  const repo = new OrgRepo(db, auth.caller.orgId)
  const service = (await repo.services()).find((s) => s.id === body.serviceId)
  if (!service) return Response.json({ error: 'No such treatment.' }, { status: 404 })

  const patient = await repo.createPatient({ name: body.patientName!, phone: body.patientPhone! })
  const result = await repo.book({
    patientId: patient.id,
    serviceId: service.id,
    providerId: body.providerId!,
    operatoryId: body.operatoryId!,
    branchId: body.branchId!,
    startIso: body.startIso!,
    durationMin: body.durationMin ?? service.durationMin,
    source: 'api',
  })

  if (!result.ok) {
    // 409, because the slot was real and is now taken — a retry with a
    // different time is the correct response, not a bug report.
    return Response.json({ error: result.reason }, { status: 409 })
  }
  return Response.json({ appointment: result.appointment }, { status: 201 })
}
