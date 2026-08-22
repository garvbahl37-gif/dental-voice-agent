import {
  connect,
  issueApiKey,
  listApiKeys,
  listWebhooks,
  OrgRepo,
  registerWebhook,
  removeWebhook,
  revokeApiKey,
  updateBranding,
} from '@vaani/db'
import { assertPublicUrl, BlockedAddressError } from '@vaani/shared/net-guard'
import { requireUser } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error
  const { db } = connect()
  const org = await new OrgRepo(db, auth.user.orgId).org()

  return Response.json({
    branding: {
      brandName: org?.brandName ?? null,
      brandColor: org?.brandColor ?? null,
      brandLogoUrl: org?.brandLogoUrl ?? null,
      agentPersona: org?.agentPersona ?? null,
      voice: org?.voice ?? null,
    },
    // Only ever the prefix. The key itself was shown once, at creation.
    keys: (await listApiKeys(db, auth.user.orgId)).map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scope: k.scope,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
    })),
    webhooks: (await listWebhooks(db, auth.user.orgId)).map((w) => ({
      id: w.id,
      url: w.url,
      events: w.events,
      failures: w.failures,
      disabledAt: w.disabledAt,
    })),
  })
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser('admin')
  if ('error' in auth) return auth.error

  let body: {
    action?: 'issue_key' | 'revoke_key' | 'add_webhook' | 'remove_webhook' | 'branding'
    name?: string
    scope?: 'read' | 'write'
    keyId?: string
    url?: string
    events?: string[]
    hookId?: string
    brandName?: string
    brandColor?: string
    brandLogoUrl?: string
    agentPersona?: string
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }

  const { db } = connect()
  const orgId = auth.user.orgId

  switch (body.action) {
    case 'issue_key': {
      const key = await issueApiKey(db, orgId, {
        name: body.name ?? 'Untitled key',
        scope: body.scope === 'write' ? 'write' : 'read',
      })
      // The only time the secret exists outside a hash. Said plainly, because
      // an interface that can show it again is one that stored it.
      return Response.json({
        key: { id: key.id, name: key.name, prefix: key.prefix, secret: key.secret },
        notice: 'Copy this now. It cannot be shown again.',
      })
    }

    case 'revoke_key':
      if (!body.keyId) return Response.json({ error: 'Which key?' }, { status: 400 })
      return Response.json({ ok: await revokeApiKey(db, orgId, body.keyId) })

    case 'add_webhook': {
      if (!body.url?.startsWith('https://')) {
        return Response.json({ error: 'Webhook endpoints must be https.' }, { status: 400 })
      }
      /**
       * Checked here as well as at delivery.
       *
       * Delivery is the control — DNS can be repointed after this — but
       * refusing at registration turns a hostile or mistyped address into a
       * clear error now, rather than an endpoint that silently never fires.
       */
      try {
        await assertPublicUrl(body.url)
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof BlockedAddressError
                ? err.message
                : 'That endpoint address cannot be used.',
          },
          { status: 400 },
        )
      }
      const events = (body.events ?? []).filter((e) =>
        ['call.completed', 'appointment.booked', 'appointment.cancelled', 'escalation.raised'].includes(e),
      )
      if (events.length === 0) {
        return Response.json({ error: 'Choose at least one event.' }, { status: 400 })
      }
      const hook = await registerWebhook(db, orgId, { url: body.url, events: events as never })
      return Response.json({
        webhook: { id: hook.id, secret: hook.secret },
        notice: 'Use this secret to verify the x-vaani-signature header.',
      })
    }

    case 'remove_webhook':
      if (!body.hookId) return Response.json({ error: 'Which webhook?' }, { status: 400 })
      return Response.json({ ok: await removeWebhook(db, orgId, body.hookId) })

    case 'branding':
      await updateBranding(db, orgId, {
        brandName: body.brandName,
        brandColor: body.brandColor,
        brandLogoUrl: body.brandLogoUrl,
        agentPersona: body.agentPersona,
      })
      return Response.json({ ok: true })

    default:
      return Response.json({ error: 'Unknown action.' }, { status: 400 })
  }
}
