export const runtime = 'nodejs'

/**
 * Readable without credentials, deliberately.
 *
 * It reports whether the engine is configured, never what it is configured
 * with, so it is safe to point a monitor at.
 */
export function GET(): Response {
  return Response.json({
    ok: true,
    engine: 'gemini-live',
    keyed: Boolean(process.env.GEMINI_API_KEY),
  })
}
