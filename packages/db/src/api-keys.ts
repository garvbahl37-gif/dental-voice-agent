import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import type { Database } from './client'
import { apiKeys, organizations, webhooks } from './schema'
import { id } from './repo'

/**
 * Machine access to a practice's own data.
 *
 * Same shape as the session tokens, for the same reason: the database stores a
 * SHA-256 of the key, never the key. A dumped table therefore yields nothing
 * usable, and a key is shown exactly once — at creation — because a system that
 * can re-display a secret is a system that stores one.
 *
 * The visible prefix is not decoration. Without it a practice with four keys
 * cannot tell which one to revoke when a laptop goes missing, so they revoke
 * all of them and break three working integrations.
 */

export interface IssuedKey {
  id: string
  /** Shown once. Never recoverable. */
  secret: string
  prefix: string
  name: string
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64')
}

export async function issueApiKey(
  db: Database,
  orgId: string,
  input: { name: string; scope?: 'read' | 'write' },
): Promise<IssuedKey> {
  const raw = randomBytes(24).toString('base64url')
  const prefix = `vk_${raw.slice(0, 6)}`
  const secret = `${prefix}_${raw}`

  const keyId = id('key')
  await db.insert(apiKeys).values({
    id: keyId,
    orgId,
    name: input.name.trim() || 'Untitled key',
    prefix,
    secretHash: hashSecret(secret),
    scope: input.scope ?? 'read',
  })
  return { id: keyId, secret, prefix, name: input.name }
}

export interface ApiCaller {
  orgId: string
  keyId: string
  scope: 'read' | 'write'
}

/**
 * Who is calling.
 *
 * Looked up by the key's own hash rather than by prefix-then-compare, so a
 * wrong key costs one indexed lookup and reveals nothing about which prefixes
 * exist.
 */
export async function resolveApiKey(
  db: Database,
  presented: string | null | undefined,
): Promise<ApiCaller | null> {
  if (!presented) return null
  const token = presented.startsWith('Bearer ') ? presented.slice(7).trim() : presented.trim()
  if (!token.startsWith('vk_')) return null

  const [row] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.secretHash, hashSecret(token)))
    .limit(1)
  if (!row || row.revokedAt) return null

  // Constant-time, even though the lookup already matched — the hash column is
  // indexed and equality there is not a timing-safe comparison of the secret.
  const a = Buffer.from(row.secretHash)
  const b = Buffer.from(hashSecret(token))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id))
  return { orgId: row.orgId, keyId: row.id, scope: row.scope }
}

export async function listApiKeys(db: Database, orgId: string) {
  return db.select().from(apiKeys).where(eq(apiKeys.orgId, orgId))
}

export async function revokeApiKey(db: Database, orgId: string, keyId: string): Promise<boolean> {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, orgId), eq(apiKeys.id, keyId)))
    .returning({ id: apiKeys.id })
  return rows.length > 0
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export type WebhookEvent =
  | 'call.completed'
  | 'appointment.booked'
  | 'appointment.cancelled'
  | 'escalation.raised'

export async function registerWebhook(
  db: Database,
  orgId: string,
  input: { url: string; events: WebhookEvent[] },
): Promise<{ id: string; secret: string }> {
  // Shared secret for signing, so a receiver can verify a delivery really came
  // from us rather than from anyone who learned the endpoint.
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  const hookId = id('hook')
  await db.insert(webhooks).values({
    id: hookId,
    orgId,
    url: input.url,
    events: input.events,
    secret,
  })
  return { id: hookId, secret }
}

export async function listWebhooks(db: Database, orgId: string) {
  return db.select().from(webhooks).where(eq(webhooks.orgId, orgId))
}

export async function removeWebhook(db: Database, orgId: string, hookId: string): Promise<boolean> {
  const rows = await db
    .delete(webhooks)
    .where(and(eq(webhooks.orgId, orgId), eq(webhooks.id, hookId)))
    .returning({ id: webhooks.id })
  return rows.length > 0
}

/**
 * White-label settings.
 *
 * Colour is validated because it is interpolated into a CSS custom property —
 * an unvalidated value there is a stylesheet injection, and a tenant admin is
 * not automatically trusted with that.
 */
export async function updateBranding(
  db: Database,
  orgId: string,
  input: {
    brandName?: string
    brandColor?: string
    brandLogoUrl?: string
    agentPersona?: string
  },
): Promise<void> {
  const patch: Record<string, string | null> = {}
  if (input.brandName !== undefined) patch.brandName = input.brandName.trim().slice(0, 60) || null
  if (input.agentPersona !== undefined) {
    patch.agentPersona = input.agentPersona.trim().slice(0, 2000) || null
  }
  if (input.brandColor !== undefined) {
    const hex = input.brandColor.trim()
    patch.brandColor = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : null
  }
  if (input.brandLogoUrl !== undefined) {
    const url = input.brandLogoUrl.trim()
    // https only: an http logo on an https dashboard is a mixed-content warning
    // in every browser, and a data: URL here is a script vector.
    patch.brandLogoUrl = /^https:\/\/\S+$/.test(url) ? url.slice(0, 500) : null
  }
  if (Object.keys(patch).length === 0) return
  await db.update(organizations).set(patch).where(eq(organizations.id, orgId))
}
