/**
 * Where Twilio should send a call's audio.
 *
 * This decides where a patient's voice goes, so it is not read from the
 * request. An earlier version took `x-forwarded-host` and trusted it: on the
 * cron path that header is whatever the caller sent, which meant anyone able
 * to reach the dialler could have had live call audio streamed to a host of
 * their choosing.
 *
 * The order is trusted-first. An explicit setting wins; otherwise the
 * platform's own idea of this deployment's hostname, which the runtime sets and
 * a request cannot influence. Request headers are the last resort and only
 * matter where there is no platform to ask — local development, which has no
 * attacker boundary to protect.
 */
export interface StreamUrlSource {
  /** Set deliberately, e.g. a custom domain Twilio is configured against. */
  explicit?: string
  /** The platform's hostname for this deployment. */
  platformHost?: string
  /** Only consulted when there is no platform hostname at all. */
  requestHost?: string
}

export function streamUrl(src: StreamUrlSource): string {
  if (src.explicit) return src.explicit

  const host = src.platformHost ?? src.requestHost
  if (!host) {
    throw new Error(
      'Cannot work out where Twilio should stream to. Set TWILIO_STREAM_URL.',
    )
  }
  return `wss://${host.split(',')[0]!.trim()}/api/twilio/stream`
}

/** The same, reading the environment a Vercel function runs in. */
export function streamUrlFromEnv(requestHost?: string): string {
  return streamUrl({
    explicit: process.env.TWILIO_STREAM_URL,
    // Set by the runtime, not by the caller.
    platformHost:
      process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL ?? undefined,
    requestHost,
  })
}
