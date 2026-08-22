import { cookies } from 'next/headers'
import { connect, resolveSession, atLeast, type AuthedUser, type Role } from '@vaani/db'

/**
 * Who is asking, on the server.
 *
 * Every dashboard route calls this before it reads anything. The org comes from
 * the session, never from a query parameter or a header — an endpoint that
 * accepts `?orgId=` is an endpoint that reads any practice's patients for
 * anyone who edits the URL.
 */

export const SESSION_COOKIE = 'vaani_session'

export async function currentUser(): Promise<AuthedUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { db } = connect()
    return await resolveSession(db, token)
  } catch {
    // No database configured. Nobody is signed in, rather than a crash.
    return null
  }
}

/** Returns the user, or a Response to send back. Never throws past the route. */
export async function requireUser(
  minimum: Role = 'viewer',
): Promise<{ user: AuthedUser } | { error: Response }> {
  const user = await currentUser()
  if (!user) {
    return { error: Response.json({ error: 'Not signed in.' }, { status: 401 }) }
  }
  if (!atLeast(user.role, minimum)) {
    return {
      error: Response.json(
        { error: `This needs ${minimum} access. You are signed in as ${user.role}.` },
        { status: 403 },
      ),
    }
  }
  return { user }
}
