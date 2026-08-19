/**
 * Transient-failure retry for provider HTTP calls.
 *
 * A rate limit or a 503 must never end a call. Mid-conversation the caller has
 * no idea a quota was hit — they hear silence, then a hang-up, and the practice
 * loses a booking. Providers publish how long to wait, so waiting is both
 * correct and cheap.
 *
 * Retries are bounded tightly on purpose: past roughly a second of stalling,
 * the pause is more damaging than a graceful failure, and the session's error
 * path can at least say something to the caller.
 */

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504])

export interface RetryOptions {
  attempts?: number
  /** Never stall the caller longer than this in total. */
  maxDelayMs?: number
  signal?: AbortSignal
}

export async function fetchWithRetry(
  input: string,
  init: RequestInit,
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3
  const maxDelay = opts.maxDelayMs ?? 2500
  let spent = 0
  let last: Response | null = null

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (opts.signal?.aborted) throw new Error('aborted')

    const res = await fetch(input, init)
    if (res.ok || !RETRYABLE.has(res.status)) return res

    last = res
    if (attempt === attempts - 1) break

    const wait = retryDelayMs(res, attempt)
    if (spent + wait > maxDelay) break
    spent += wait

    // The body must be drained before the connection can be reused.
    await res.text().catch(() => '')
    await new Promise((r) => setTimeout(r, wait))
  }

  return last as Response
}

/**
 * How long to wait. Providers report it precisely — Groq in `retry-after`,
 * and often to the millisecond in the error body — so honouring the hint beats
 * guessing with a backoff curve.
 */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds)) return Math.min(2000, Math.ceil(seconds * 1000) + 60)
  }
  // Exponential fallback with a little jitter, so concurrent calls do not
  // synchronise and hit the limit together on the retry.
  return Math.min(1500, 220 * 2 ** attempt) + Math.floor(attempt * 40)
}
