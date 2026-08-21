import { connect, signIn, signOut } from '@vaani/db'
import { SESSION_COOKIE } from '@/lib/session'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sign in.
 *
 * The session cookie is httpOnly and sameSite=lax: httpOnly so a script on the
 * page cannot read it, lax so it survives a normal navigation but is not sent
 * on a cross-site form post. Secure in production only, because a local dev
 * server is plain HTTP and a Secure cookie would silently never be set.
 */
export async function POST(req: Request): Promise<Response> {
  let body: { email?: string; password?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 })
  }
  if (!body.email || !body.password) {
    return Response.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  const { db } = connect()
  const result = await signIn(db, { email: body.email, password: body.password })
  if (!result) {
    // Deliberately the same message for an unknown address and a wrong
    // password — otherwise the form tells you which emails have accounts.
    return Response.json({ error: 'Those details do not match an account.' }, { status: 401 })
  }

  const jar = await cookies()
  jar.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: result.expiresAt,
  })
  return Response.json({ user: result.user })
}

export async function DELETE(): Promise<Response> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const { db } = connect()
  await signOut(db, token)
  jar.delete(SESSION_COOKIE)
  return Response.json({ ok: true })
}
