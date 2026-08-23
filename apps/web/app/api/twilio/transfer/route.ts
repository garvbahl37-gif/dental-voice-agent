import { handleTransferResult, runNodeWebhook } from '@vaani/session-host'

export const runtime = 'nodejs'

/** How a transfer to a human turned out. */
export async function POST(request: Request): Promise<Response> {
  return runNodeWebhook(request, handleTransferResult)
}
