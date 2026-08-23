import { outboundPass, streamUrlFromEnv } from '@vaani/session-host'

/**
 * One pass of the outbound queue.
 *
 * On the standalone server this was a loop inside a process that never exited.
 * There is no such process here, so the schedule moved out of the code and into
 * the platform, which is where a schedule belongs anyway — it is visible, and
 * it does not depend on a box staying up.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: Request): Promise<Response> {
  /**
   * Fail closed, like the Twilio webhook next door.
   *
   * This endpoint places real phone calls to real people. An earlier version
   * skipped the check when `CRON_SECRET` was unset, so forgetting to configure
   * it turned the dialler into something anyone could drive — which is a worse
   * failure than the cron simply not running, and a silent one.
   */
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — refusing to run the dialler')
    return new Response('forbidden', { status: 403 })
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('forbidden', { status: 403 })
  }

  if (process.env.OUTBOUND_ENABLED !== 'true') {
    return Response.json({ skipped: 'outbound is off' })
  }

  await outboundPass(streamUrlFromEnv())
  return Response.json({ ok: true })
}
