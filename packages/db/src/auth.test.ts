import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './testing'
import {
  atLeast,
  createUser,
  hashPassword,
  hashToken,
  purgeExpiredSessions,
  resolveSession,
  signIn,
  signOut,
  verifyPassword,
} from './auth'
import { seedOrganization, SMILE_DENTAL } from './seed'
import { sessions } from './schema'
import { eq } from 'drizzle-orm'

let t: TestDb
let smileId: string
let pearlId: string

beforeEach(async () => {
  t = await createTestDb()
  smileId = (await seedOrganization(t.db, SMILE_DENTAL)).orgId
  pearlId = (
    await seedOrganization(t.db, {
      slug: 'pearl',
      name: 'Pearl Dental',
      branches: [{ key: 'main', name: 'Pearl', area: 'Colaba', city: 'Mumbai' }],
      providers: [{ key: 'k', name: 'Dr. Sara Khan', title: 'General Dentist' }],
      services: [{ key: 'c', name: 'Cleaning', durationMin: 30 }],
    })
  ).orgId
})

afterEach(async () => {
  await t.close()
})

describe('password hashing', () => {
  it('never stores the password itself', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct horse')
    expect(hash.startsWith('scrypt$')).toBe(true)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword('same-password-here')
    const b = await hashPassword('same-password-here')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same-password-here', a)).toBe(true)
    expect(await verifyPassword('same-password-here', b)).toBe(true)
  })

  it('accepts the right password and rejects near misses', async () => {
    const hash = await hashPassword('s3cret-passphrase')
    expect(await verifyPassword('s3cret-passphrase', hash)).toBe(true)
    expect(await verifyPassword('s3cret-passphras', hash)).toBe(false)
    expect(await verifyPassword('S3cret-passphrase', hash)).toBe(false)
    expect(await verifyPassword('', hash)).toBe(false)
  })

  it('rejects a malformed or truncated stored hash instead of throwing', async () => {
    for (const bad of ['', 'garbage', 'scrypt$16384$8$1$onlyfour', 'bcrypt$x$y$z$a$b']) {
      expect(await verifyPassword('anything', bad)).toBe(false)
    }
  })

  it('carries its parameters, so cost can be raised without a reset', async () => {
    const hash = await hashPassword('another-passphrase')
    const [scheme, n, r, p] = hash.split('$')
    expect(scheme).toBe('scrypt')
    expect(Number(n)).toBeGreaterThanOrEqual(16384)
    expect(Number(r)).toBe(8)
    expect(Number(p)).toBe(1)
  })

  it('refuses a password too short to be worth hashing', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/too short/)
  })
})

describe('roles', () => {
  it('is a hierarchy — higher roles satisfy lower requirements', () => {
    expect(atLeast('owner', 'receptionist')).toBe(true)
    expect(atLeast('admin', 'admin')).toBe(true)
    expect(atLeast('receptionist', 'admin')).toBe(false)
    expect(atLeast('viewer', 'receptionist')).toBe(false)
    expect(atLeast('viewer', 'viewer')).toBe(true)
  })
})

describe('sign in', () => {
  beforeEach(async () => {
    await createUser(t.db, {
      orgId: smileId,
      email: 'Owner@Smile.example',
      name: 'Practice Owner',
      password: 'a-long-enough-password',
      role: 'owner',
    })
  })

  it('signs in and issues a session', async () => {
    const out = await signIn(t.db, { email: 'owner@smile.example', password: 'a-long-enough-password' })
    expect(out).not.toBeNull()
    expect(out!.user.role).toBe('owner')
    expect(out!.user.orgId).toBe(smileId)
    expect(out!.token.length).toBeGreaterThan(20)
  })

  it('is case-insensitive about the email, as every login form is', async () => {
    expect(await signIn(t.db, { email: 'OWNER@SMILE.EXAMPLE', password: 'a-long-enough-password' })).not.toBeNull()
  })

  it('refuses a wrong password', async () => {
    expect(await signIn(t.db, { email: 'owner@smile.example', password: 'wrong-password-here' })).toBeNull()
  })

  it('refuses an unknown email without revealing that it is unknown', async () => {
    expect(await signIn(t.db, { email: 'nobody@smile.example', password: 'a-long-enough-password' })).toBeNull()
  })

  it('stores the session token as a hash, never the token itself', async () => {
    const out = await signIn(t.db, { email: 'owner@smile.example', password: 'a-long-enough-password' })
    const rows = await t.db.select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.tokenHash).not.toBe(out!.token)
    expect(rows[0]!.tokenHash).toBe(hashToken(out!.token))
  })

  it('scopes to one practice when asked, so the same address at two clinics stays separate', async () => {
    await createUser(t.db, {
      orgId: pearlId,
      email: 'shared@dentist.example',
      name: 'Locum',
      password: 'pearl-password-here',
      role: 'receptionist',
    })
    await createUser(t.db, {
      orgId: smileId,
      email: 'shared@dentist.example',
      name: 'Locum',
      password: 'smile-password-here',
      role: 'viewer',
    })

    const atPearl = await signIn(t.db, {
      email: 'shared@dentist.example',
      password: 'pearl-password-here',
      orgId: pearlId,
    })
    expect(atPearl!.user.orgId).toBe(pearlId)
    expect(atPearl!.user.role).toBe('receptionist')

    // The Pearl password must not open the Smile account.
    expect(
      await signIn(t.db, {
        email: 'shared@dentist.example',
        password: 'pearl-password-here',
        orgId: smileId,
      }),
    ).toBeNull()
  })
})

describe('sessions', () => {
  let token: string

  beforeEach(async () => {
    await createUser(t.db, {
      orgId: smileId,
      email: 'desk@smile.example',
      name: 'Reception',
      password: 'reception-password',
      role: 'receptionist',
    })
    token = (await signIn(t.db, { email: 'desk@smile.example', password: 'reception-password' }))!.token
  })

  it('resolves a live token to the user and their tenant', async () => {
    const me = await resolveSession(t.db, token)
    expect(me!.orgId).toBe(smileId)
    expect(me!.role).toBe('receptionist')
  })

  it('rejects a token nobody issued', async () => {
    expect(await resolveSession(t.db, 'made-up-token')).toBeNull()
    expect(await resolveSession(t.db, undefined)).toBeNull()
  })

  it('rejects the stored hash used as if it were the token', async () => {
    // Someone who reads the database must not be able to log in with what they find.
    expect(await resolveSession(t.db, hashToken(token))).toBeNull()
  })

  it('rejects an expired session and clears it', async () => {
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.tokenHash, hashToken(token)))

    expect(await resolveSession(t.db, token)).toBeNull()
    expect(await t.db.select().from(sessions)).toHaveLength(0)
  })

  it('sign out invalidates the token immediately', async () => {
    await signOut(t.db, token)
    expect(await resolveSession(t.db, token)).toBeNull()
  })

  it('purges expired rows without touching live ones', async () => {
    const live = (await signIn(t.db, { email: 'desk@smile.example', password: 'reception-password' }))!.token
    await t.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.tokenHash, hashToken(token)))

    await purgeExpiredSessions(t.db)
    expect(await resolveSession(t.db, live)).not.toBeNull()
    expect(await t.db.select().from(sessions)).toHaveLength(1)
  })
})
