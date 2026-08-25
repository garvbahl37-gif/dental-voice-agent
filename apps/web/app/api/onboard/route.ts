import {
  connect,
  createUser,
  emailInUse,
  seedOrganization,
  signIn,
  slugAvailable,
  type SeedOrg,
} from '@vaani/db'
import { crawlSite, geminiEmbedder } from '@vaani/knowledge'
import { cookies } from 'next/headers'
import { SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The optional website import fetches a dozen pages with a delay between them.
export const maxDuration = 300

/**
 * Signing up a practice.
 *
 * One request creates the whole tenant, because a half-created clinic is worse
 * than none: an organisation with no branch cannot take a call, and a wizard
 * that fails on step four leaves the owner with an account they cannot use and
 * cannot sign up again with.
 *
 * The website import is deliberately *not* part of that guarantee. It is slow,
 * it depends on someone else's server, and a clinic whose site is down should
 * still get a working account — so it runs after the tenant exists and its
 * failure is reported rather than thrown.
 */

interface Body {
  practiceName?: string
  email?: string
  password?: string
  ownerName?: string
  city?: string
  area?: string
  phone?: string
  website?: string
  timezone?: string
}

const SLUG_TAKEN = 'That practice name is already in use. Try adding your area to it.'

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

/** The treatments almost every general practice offers, as a starting point. */
const STARTER_SERVICES: SeedOrg['services'] = [
  { key: 'consult', name: 'Consultation', alsoCalled: ['checkup', 'check-up', 'first visit'], durationMin: 20 },
  { key: 'scaling', name: 'Scaling & Polishing', alsoCalled: ['cleaning', 'safai', 'descaling'], durationMin: 40, recallDays: 180 },
  { key: 'filling', name: 'Composite Filling', alsoCalled: ['filling', 'cavity', 'bharna'], durationMin: 45 },
  { key: 'rct', name: 'Root Canal', alsoCalled: ['RCT', 'root canal treatment'], durationMin: 90 },
  { key: 'extraction', name: 'Tooth Extraction', alsoCalled: ['extraction', 'daant nikalna'], durationMin: 40 },
  { key: 'emergency', name: 'Emergency Visit', alsoCalled: ['emergency', 'urgent', 'pain'], durationMin: 30 },
]

export async function POST(req: Request): Promise<Response> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }

  const practiceName = body.practiceName?.trim()
  const email = body.email?.trim().toLowerCase()
  const password = body.password ?? ''
  const ownerName = body.ownerName?.trim() || 'Practice Owner'
  const city = body.city?.trim() || 'Mumbai'
  const area = body.area?.trim() || city

  if (!practiceName || practiceName.length < 3) {
    return Response.json({ error: 'What is the practice called?' }, { status: 400 })
  }
  if (!email || !email.includes('@')) {
    return Response.json({ error: 'A valid email is needed to sign in.' }, { status: 400 })
  }
  if (password.length < 8) {
    return Response.json({ error: 'Use a password of at least 8 characters.' }, { status: 400 })
  }

  const { db } = connect()
  const slug = toSlug(practiceName)
  if (!slug) return Response.json({ error: 'That practice name cannot be used.' }, { status: 400 })

  if (!(await slugAvailable(db, slug))) {
    return Response.json({ error: SLUG_TAKEN }, { status: 409 })
  }

  /**
   * Checked before anything is written.
   *
   * `signIn` looks an address up by email alone and takes the first match, so
   * one address owning two practices means landing in an arbitrary one with no
   * way to reach the other. Refusing here is also what stops a duplicate from
   * creating the organisation and *then* failing on the user, which would leave
   * a tenant nobody can sign in to.
   */
  if (await emailInUse(db, email)) {
    return Response.json(
      { error: 'That email already has an account. Sign in instead.' },
      { status: 409 },
    )
  }

  let orgId: string
  try {
    const spec: SeedOrg = {
      slug,
      name: practiceName,
      timezone: body.timezone || 'Asia/Kolkata',
      branches: [
        {
          key: 'main',
          name: `${practiceName} — ${area}`,
          area,
          city,
          phone: body.phone?.trim(),
          // Until they set one, escalation falls back to the main line.
          emergencyPhone: body.phone?.trim(),
          chairs: [{ name: 'Chair 1' }, { name: 'Chair 2' }],
        },
      ],
      // A real dentist, named later. Without one the diary has nobody in it and
      // the agent cannot offer a single slot.
      providers: [
        { key: 'lead', name: `Dr. ${ownerName.split(' ').slice(-1)[0]}`, title: 'Dentist', specialties: ['general'] },
      ],
      services: STARTER_SERVICES,
    }
    orgId = (await seedOrganization(db, spec)).orgId
    await createUser(db, { orgId, email, name: ownerName, password, role: 'owner' })
  } catch (err) {
    console.error('[onboard] failed:', err)
    return Response.json(
      { error: 'Could not create the practice. Try again in a moment.' },
      { status: 500 },
    )
  }

  // The account exists and works from here on. Anything below is a bonus.
  let imported: { pages: number; chunks: number } | null = null
  let importError: string | null = null
  if (body.website?.trim()) {
    try {
      const out = await crawlSite(
        { db, orgId, embed: geminiEmbedder() },
        body.website.trim(),
      )
      imported = { pages: out.pages, chunks: out.chunks }
    } catch (err) {
      // Reported, never fatal: a clinic whose site is down still has an account.
      importError =
        err instanceof Error && err.name === 'BlockedAddressError'
          ? err.message
          : 'We could not read that website. You can import it later from Knowledge.'
    }
  }

  // Signed in immediately — asking someone to log in to the account they just
  // made is a step that exists only to serve the implementation.
  const session = await signIn(db, { email, password, orgId })
  if (session) {
    const jar = await cookies()
    jar.set(SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      expires: session.expiresAt,
    })
  }

  return Response.json({ orgId, slug, imported, importError })
}
