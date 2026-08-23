import { handleStatus, runNodeWebhook } from '@vaani/session-host'

export const runtime = 'nodejs'

/** The call ended — duration and disposition. */
export async function POST(request: Request): Promise<Response> {
  return runNodeWebhook(request, handleStatus)
}
