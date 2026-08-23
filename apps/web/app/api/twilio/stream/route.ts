import { experimental_upgradeWebSocket } from '@vercel/functions'
import { handleTwilioStream } from '@vaani/session-host'

/**
 * The call audio, both directions.
 *
 * Twilio opens this after the voice webhook answers, carrying the tenant it
 * resolved as a custom parameter — resolving it again here would mean trusting
 * a value that arrived over a different connection.
 */
export const runtime = 'nodejs'

/**
 * The ceiling on a phone call.
 *
 * 300s is the most the Hobby plan allows, so a call is cut at five minutes —
 * fine for a demo, wrong for a real front desk. Raising it means a paid plan,
 * or running `apps/voice-server`, which has no such limit. This is the one
 * thing serverless genuinely costs here.
 */
export const maxDuration = 300

export function GET(): Promise<Response> {
  return experimental_upgradeWebSocket((ws) => {
    // `TwilioSocket` is already the minimal shape this needs — send, close and
    // two events — so the runtime's socket satisfies it as it stands.
    void handleTwilioStream(ws as never)
  })
}
