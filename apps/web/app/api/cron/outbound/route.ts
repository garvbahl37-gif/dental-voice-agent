import { outboundPass } from '@vaani/session-host'
import { streamUrlFor } from '@/lib/telephony-config'

/**
 * One pass of the outbound queue.
 *
 * On the standalone server this was a loop inside a process that never exited.
 * There is no such process here, so the schedule moved out of the code and into
 * the platform, which is where a schedule belongs anyway — it is visible,
 * and it does not depend on a box staying up.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  /**
   * Vercel signs its own cron invocations with this secret. Without the check
   * anyone could drive the dialler by hitting the URL.
   */
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 })
  }
  if (process.env.OUTBOUND_ENABLED !== 'true') {
    return Response.json({ skipped: 'outbound is off' })
  }

  await outboundPass(streamUrlFor(request))
  return Response.json({ ok: true })
}
