import { connect, resolveApiKey, type ApiCaller } from '@vaani/db'

/**
 * Authenticating a machine.
 *
 * Separate from the dashboard's session auth on purpose: a browser session and
 * an API key are different credentials with different lifetimes and different
 * blast radii, and a single helper that accepted either would eventually let a
 * cookie authorise a server-to-server call.
 */
export async function requireApiKey(
  req: Request,
  need: 'read' | 'write' = 'read',
): Promise<{ caller: ApiCaller } | { error: Response }> {
  const { db } = connect()
  const caller = await resolveApiKey(db, req.headers.get('authorization'))
  if (!caller) {
    return {
      error: Response.json(
        { error: 'Provide an API key as `Authorization: Bearer vk_…`.' },
        { status: 401, headers: { 'www-authenticate': 'Bearer' } },
      ),
    }
  }
  if (need === 'write' && caller.scope !== 'write') {
    return { error: Response.json({ error: 'This key is read-only.' }, { status: 403 }) }
  }
  return { caller }
}
