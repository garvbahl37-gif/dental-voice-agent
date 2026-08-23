import { randomUUID } from 'node:crypto'
import { experimental_upgradeWebSocket } from '@vercel/functions'
import { CallLog, PracticeStore } from '@vaani/agent'
import { LIVE_VOICE } from '@vaani/live'
import { runVoiceSession } from '@vaani/session-host'
import { LangSchema, voiceGender } from '@vaani/shared'
import { VercelWsTransport, type VercelSocket } from '@/lib/vercel-transport'

/**
 * A call, hosted next to the console instead of on a separate box.
 *
 * The voice server it replaces slept when idle on a free host, and waking it
 * took the better part of a minute — which the first visitor of the day paid
 * for before hearing anything. Running the call here removes that wait: the
 * console and the call are one deployment, warmed by the same traffic.
 *
 * The call itself is unchanged; `runVoiceSession` is the same module the
 * standalone server runs, so there is one implementation to keep correct.
 */

export const runtime = 'nodejs'
/**
 * A call that runs longer than this is cut off, so it is set well past any
 * demo. Long real calls are the reason the standalone server still exists.
 */
export const maxDuration = 300

/**
 * Per-instance, and deliberately so.
 *
 * `PracticeStore` is seeded the same way every time, so an instance rebuilding
 * it costs nothing. `CallLog` is genuinely per-instance now rather than global,
 * which is fine because nothing reads it: the dashboard's history comes from
 * Postgres. It is kept only to satisfy the session's contract and to bound its
 * own memory.
 */
let practice: PracticeStore | undefined
let callLog: CallLog | undefined

export function GET(req: Request): Promise<Response> {
  practice ??= new PracticeStore()
  callLog ??= new CallLog()
  const store = practice
  const log = callLog

  /**
   * The language rides on the URL, not on a message.
   *
   * `speechConfig.languageCode` is fixed when Live connects, so the greeting is
   * spoken in whatever we connect with — and a message has to win a race
   * against that connect to matter. A query parameter is known at the upgrade,
   * before any of this runs. A bad or absent value falls back to the default
   * rather than failing the call.
   */
  const requested = new URL(req.url).searchParams.get('lang')
  const parsed = LangSchema.safeParse(requested)

  return experimental_upgradeWebSocket((ws) => {
    const socket = ws as unknown as VercelSocket
    const transport = new VercelWsTransport(socket)

    void runVoiceSession({
      // Random, not sequential: the id is also the call record's key.
      sessionId: randomUUID(),
      transport,
      lang: parsed.success ? parsed.data : 'en-IN',
      practice: store,
      callLog: log,
      apiKey: process.env.GEMINI_API_KEY ?? '',
      voice: LIVE_VOICE,
      gender: voiceGender(LIVE_VOICE, process.env.GEMINI_LIVE_VOICE_GENDER),
      close: () => transport.close(),
    })
  })
}
