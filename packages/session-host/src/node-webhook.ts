import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Run a Node-style webhook handler from a route handler.
 *
 * The Twilio handlers verify a signature over the exact bytes Twilio sent and
 * the exact URL it signed. That check is the security boundary for the whole
 * phone line, and it has tests around it, so it is adapted rather than
 * rewritten: this builds the request shape those handlers already read, and
 * collects what they write.
 */
export async function runNodeWebhook(
  request: Request,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<Response> {
  const body = await request.text()

  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })

  const url = new URL(request.url)
  /**
   * The path only.
   *
   * `publicUrl` rebuilds the address Twilio signed from `x-forwarded-proto` and
   * `x-forwarded-host`, which is what a request behind a proxy must be checked
   * against — the internal URL this function receives is not what was signed.
   */
  const req = Object.assign(Readable.from([Buffer.from(body, 'utf8')]), {
    headers,
    method: request.method,
    url: url.pathname + url.search,
  }) as unknown as IncomingMessage

  let status = 200
  let responseHeaders: Record<string, string> = {}
  const chunks: string[] = []
  let finished: () => void
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })

  const res = {
    writeHead(code: number, hdrs?: Record<string, string>) {
      status = code
      if (hdrs) responseHeaders = { ...responseHeaders, ...hdrs }
      return res
    },
    setHeader(name: string, value: string) {
      responseHeaders[name.toLowerCase()] = value
      return res
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk)
      finished()
      return res
    },
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
  } as unknown as ServerResponse

  await handler(req, res)
  // A handler that returns without ending has already failed; do not hang.
  await Promise.race([done, Promise.resolve()])

  return new Response(chunks.join('') || null, { status, headers: responseHeaders })
}
