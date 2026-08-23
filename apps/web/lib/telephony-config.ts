/**
 * Where Twilio should stream a call's audio.
 *
 * Derived from the request rather than configured, so a preview deployment
 * points at itself instead of at production. The forwarded headers are what a
 * request behind a proxy actually arrived with.
 */
export function streamUrlFor(request: Request): string {
  const explicit = process.env.TWILIO_STREAM_URL
  if (explicit) return explicit

  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    new URL(request.url).host
  return `wss://${host.split(',')[0]!.trim()}/api/twilio/stream`
}
