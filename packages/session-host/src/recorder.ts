import { OrgRepo, connect, resolveSession } from '@vaani/db'
import type { CallRecorder } from './index'

/** The cookie the console's session lives in. */
export const SESSION_COOKIE = 'vaani_session'

/**
 * Files a console call against whichever practice the signed-in user belongs to.
 *
 * A call taken from the console by an owner is one of their practice's calls,
 * and belongs in their dashboard beside the ones the phone line took. Without
 * this the console left no trace and the dashboard stayed empty until a number
 * was wired up — which made every figure on it unverifiable by the person most
 * entitled to check.
 *
 * Everything is resolved lazily, inside the call rather than at the upgrade, so
 * a database that is slow or down delays nothing a caller can hear.
 */
export function recorderForToken(token: string): CallRecorder {
  let repo: OrgRepo | null = null
  let callId: string | null = null

  return {
    async begin() {
      const { db } = connect()
      const user = await resolveSession(db, token)
      // An expired or unknown token is an anonymous visitor, not an error.
      if (!user) return null
      repo = new OrgRepo(db, user.orgId)
      const row = await repo.startCall({ channel: 'web', direction: 'inbound' })
      callId = row.id
      return callId
    },

    async end(input) {
      if (!repo || !callId) return
      await repo.finishCall(callId, {
        transcript: input.transcript as never,
        outcome: input.outcome as never,
        language: input.language,
        durationSec: input.durationSec,
        triageBand: (input.triageBand ?? null) as never,
        firstResponseMs: input.firstResponseMs ?? null,
        avgResponseMs: input.avgResponseMs ?? null,
        bargeInCount: input.bargeInCount,
      })
    },
  }
}

/** One cookie out of a request's own header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k?.trim() === name) return rest.join('=')
  }
  return undefined
}
