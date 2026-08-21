import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { and, eq, lt } from 'drizzle-orm'
import type { Database } from './client'
import { id } from './repo'
import { sessions, users } from './schema'

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/**
 * Passwords and sessions.
 *
 * scrypt from Node's own crypto rather than argon2 or bcrypt: both are native
 * modules, and a native build step is the usual reason a container that works
 * on a laptop fails on a deploy host. scrypt is memory-hard, in the standard
 * library, and entirely adequate here.
 *
 * Two properties are worth stating because they are the ones that get skipped:
 *
 *   **The stored value is not the password and not reversible.** Salt is
 *   per-user and stored alongside; the parameters are stored too, so raising
 *   the cost later does not invalidate everyone's login.
 *
 *   **Session tokens are stored as a hash.** The cookie holds the secret; the
 *   database holds SHA-256 of it. A dumped `sessions` table therefore yields no
 *   usable sessions, which is the difference between a database leak and an
 *   account takeover.
 */

// ~64 MB per hash. Slow enough to make offline cracking expensive, fast enough
// that a login is not perceptibly delayed.
const N = 16384
const R = 8
const P = 1
const KEYLEN = 32
const MAXMEM = 64 * 1024 * 1024

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error('password too short')
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  // Parameters travel with the hash so they can be raised without a reset.
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64!, 'base64')
    const expected = Buffer.from(hashB64!, 'base64')
    const derived = await scrypt(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/** What the browser holds, and what the database holds instead. */
export function newSessionToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64')
}

export type Role = 'owner' | 'admin' | 'receptionist' | 'viewer'

/**
 * Roles, most privileged first.
 *
 * A plain ordering rather than a permission matrix, because the distinctions a
 * dental practice actually needs are hierarchical: the owner can do everything,
 * a receptionist can work the diary but not change billing, a viewer can read.
 * A matrix here would be ceremony for permissions nobody has asked for.
 */
const RANK: Record<Role, number> = { owner: 3, admin: 2, receptionist: 1, viewer: 0 }

export function atLeast(role: Role, required: Role): boolean {
  return RANK[role] >= RANK[required]
}

export interface AuthedUser {
  id: string
  orgId: string
  email: string
  name: string
  role: Role
}

export interface AuthResult {
  user: AuthedUser
  token: string
  expiresAt: Date
}

const SESSION_DAYS = 14

/**
 * Sign in.
 *
 * Returns the same failure for an unknown email and a wrong password, and does
 * the hash comparison either way. Short-circuiting on "no such user" turns the
 * login form into an oracle for which addresses have accounts at which clinic.
 */
export async function signIn(
  db: Database,
  input: { email: string; password: string; orgId?: string },
): Promise<AuthResult | null> {
  const email = input.email.trim().toLowerCase()
  const conds = [eq(users.email, email)]
  if (input.orgId) conds.push(eq(users.orgId, input.orgId))

  const [row] = await db.select().from(users).where(and(...conds)).limit(1)

  // A dummy verify against a real-shaped hash, so a missing account costs the
  // same wall-clock time as a wrong password.
  const stored = row?.passwordHash ?? DUMMY_HASH
  const ok = await verifyPassword(input.password, stored)
  if (!row || !ok) return null

  const { token, hash } = newSessionToken()
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600_000)
  await db.insert(sessions).values({ tokenHash: hash, userId: row.id, orgId: row.orgId, expiresAt })
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id))

  return {
    user: { id: row.id, orgId: row.orgId, email: row.email, name: row.name, role: row.role },
    token,
    expiresAt,
  }
}

/** A valid scrypt hash of a value nobody knows, for the timing-equalising path. */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

export async function resolveSession(db: Database, token: string | undefined): Promise<AuthedUser | null> {
  if (!token) return null
  const [row] = await db
    .select({
      userId: sessions.userId,
      orgId: sessions.orgId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1)

  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    return null
  }
  return { id: row.userId, orgId: row.orgId, email: row.email, name: row.name, role: row.role }
}

export async function signOut(db: Database, token: string | undefined): Promise<void> {
  if (!token) return
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
}

/** Housekeeping — expired rows are dead weight and a needless liability. */
export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()))
}

export async function createUser(
  db: Database,
  input: { orgId: string; email: string; name: string; password: string; role: Role },
): Promise<AuthedUser> {
  const passwordHash = await hashPassword(input.password)
  const [row] = await db
    .insert(users)
    .values({
      id: id('usr'),
      orgId: input.orgId,
      email: input.email.trim().toLowerCase(),
      name: input.name,
      passwordHash,
      role: input.role,
    })
    .returning()
  return { id: row!.id, orgId: row!.orgId, email: row!.email, name: row!.name, role: row!.role }
}
