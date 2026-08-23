import { handleVoice, runNodeWebhook } from '@vaani/session-host'

import { streamUrlFor } from '@/lib/telephony-config'

export const runtime = 'nodejs'

/** A call arrived. Answer with TwiML that hands the audio to the stream route. */
export async function POST(request: Request): Promise<Response> {
  return runNodeWebhook(request, (req, res) =>
    handleVoice(req, res, { streamUrl: streamUrlFor(request) }),
  )
}
