import { createHmac, timingSafeEqual } from 'node:crypto'
import { assertPublicUrl, BlockedAddressError, safeDispatcher } from '@vaani/shared/net-guard'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from './client'
import { webhooks } from './schema'
import type { WebhookEvent } from './api-keys'

/**
 * Telling a practice's other systems what happened.
 *
 * Three properties, each of which is the difference between a webhook people
 * trust and one they turn off:
 *
 *   **Signed.** A receiver has no way to tell a real delivery from anyone who
 *   learned the URL unless we prove it. HMAC over timestamp + body, with the
 *   timestamp inside the signature so a captured delivery cannot be replayed a
 *   week later.
 *
 *   **Never blocking.** A slow endpoint must not hold up a phone call. Delivery
 *   is fire-and-forget with a short timeout, because the call is the product
 *   and the notification is not.
 *
 *   **Self-disabling.** An endpoint that has failed repeatedly is gone, and
 *   retrying it forever burns the sender's time to no purpose. After enough
 *   consecutive failures it is switched off and the practice is told.
 *
 * And one that is not about usefulness at all: **the destination is checked
 * every time it is used, not only when it was registered.** A webhook URL comes
 * from a user and makes this server issue a request, which is the same SSRF
 * primitive as the website importer. A POST to a cloud metadata endpoint cannot
 * read the response back to the attacker, but it is still a request to an
 * internal service, and DNS for a public-looking name can be repointed at
 * 127.0.0.1 long after the endpoint was saved.
 */

const TIMEOUT_MS = 5_000
const MAX_FAILURES = 10

export function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** For receivers, and for our own tests. Rejects a replayed delivery. */
export function verifySignature(input: {
  secret: string
  signature: string
  timestamp: number
  body: string
  toleranceSec?: number
  now?: number
}): boolean {
  const now = input.now ?? Date.now()
  const tolerance = (input.toleranceSec ?? 300) * 1000
  if (Math.abs(now - input.timestamp * 1000) > tolerance) return false

  const expected = signPayload(input.secret, input.timestamp, input.body)
  const a = Buffer.from(expected)
  const b = Buffer.from(input.signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export type Deliver = (input: {
  url: string
  body: string
  headers: Record<string, string>
}) => Promise<{ ok: boolean; status: number }>

export const httpDeliver: Deliver = async ({ url, body, headers }) => {
  try {
    // Re-resolved at delivery, not trusted from registration.
    await assertPublicUrl(url)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      // Never follow: a public endpoint that 302s to 169.254.169.254 defeats a
      // check done only on the address we were given.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Validated inside the socket's own resolution, so the address approved
      // above is the address actually dialled — no second lookup to poison.
      dispatcher: safeDispatcher(),
    } as RequestInit & { dispatcher: unknown })
    // A redirect is not a success — the receiver should be given a final URL.
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status }
    return { ok: res.ok, status: res.status }
  } catch (err) {
    if (err instanceof BlockedAddressError) {
      console.warn('[webhook] refused to deliver to a non-public address:', url)
    }
    return { ok: false, status: 0 }
  }
}

export interface EmitOptions {
  db: Database
  orgId: string
  event: WebhookEvent
  data: Record<string, unknown>
  deliver?: Deliver
  now?: () => Date
}

export async function emitWebhook(opts: EmitOptions): Promise<{ delivered: number; failed: number }> {
  const deliver = opts.deliver ?? httpDeliver
  const now = opts.now ?? (() => new Date())

  const hooks = await opts.db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.orgId, opts.orgId), isNull(webhooks.disabledAt)))

  const subscribed = hooks.filter((h) => h.events.includes(opts.event))
  if (subscribed.length === 0) return { delivered: 0, failed: 0 }

  const timestamp = Math.floor(now().getTime() / 1000)
  const body = JSON.stringify({
    event: opts.event,
    // The org is in the payload so a receiver handling several practices knows
    // which one this is about without decoding the URL it registered.
    orgId: opts.orgId,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    data: opts.data,
  })

  let delivered = 0
  let failed = 0

  for (const hook of subscribed) {
    const result = await deliver({
      url: hook.url,
      body,
      headers: {
        'x-vaani-event': opts.event,
        'x-vaani-timestamp': String(timestamp),
        'x-vaani-signature': signPayload(hook.secret, timestamp, body),
      },
    })

    if (result.ok) {
      delivered += 1
      // Any success clears the streak — a blip must not accumulate towards
      // disabling an endpoint that mostly works.
      if (hook.failures > 0) {
        await opts.db.update(webhooks).set({ failures: 0 }).where(eq(webhooks.id, hook.id))
      }
      continue
    }

    failed += 1
    const failures = hook.failures + 1
    await opts.db
      .update(webhooks)
      .set({
        failures,
        disabledAt: failures >= MAX_FAILURES ? now() : null,
      })
      .where(eq(webhooks.id, hook.id))
  }

  return { delivered, failed }
}

/**
 * Fire without waiting.
 *
 * Used from the call path, where a slow receiver must never add latency to a
 * conversation. Errors are logged and dropped — a failed notification is worth
 * far less than the call it would otherwise delay.
 */
export function emitWebhookDetached(opts: EmitOptions): void {
  void emitWebhook(opts).catch((err) => {
    console.error('[webhook] delivery failed:', err instanceof Error ? err.message : err)
  })
}

export async function reenableWebhook(db: Database, orgId: string, hookId: string): Promise<void> {
  await db
    .update(webhooks)
    .set({ disabledAt: null, failures: 0 })
    .where(and(eq(webhooks.orgId, orgId), eq(webhooks.id, hookId)))
}
