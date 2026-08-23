import { handleVoice, runNodeWebhook, streamUrlFromEnv } from '@vaani/session-host'

export const runtime = 'nodejs'

/** A call arrived. Answer with TwiML that hands the audio to the stream route. */
export async function POST(request: Request): Promise<Response> {
  return runNodeWebhook(request, (req, res) =>
    handleVoice(req, res, { streamUrl: streamUrlFromEnv(new URL(request.url).host) }),
  )
}
