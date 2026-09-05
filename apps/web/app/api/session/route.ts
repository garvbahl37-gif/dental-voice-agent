import { randomUUID } from 'node:crypto'
import { experimental_upgradeWebSocket, waitUntil } from '@vercel/functions'
import { CallLog, PracticeStore } from '@vaani/agent'
import { LIVE_VOICE } from '@vaani/live'
import {
  readCookie,
  recorderForToken,
  runVoiceSession,
  SESSION_COOKIE,
  WsUpgradeTransport,
  type CallRecorder,
  type UpgradedSocket,
} from '@vaani/session-host'
import { LangSchema, voiceGender } from '@vaani/shared'

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

  /**
   * Whose practice this call belongs to.
   *
   * Read from the session cookie on the upgrade, because a WebSocket carries
   * no cookies of its own afterwards. A signed-in owner taking a call from the
   * console is taking one of their practice's calls, and it should be in their
   * dashboard alongside the ones the phone line took. An anonymous visitor has
   * no practice to file against and nothing is written — the demo still works,
   * it just leaves no trace, which is correct for a stranger.
   */
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE)

  return experimental_upgradeWebSocket((ws) => {
    const socket = ws as unknown as UpgradedSocket
    const transport = new WsUpgradeTransport(socket)

    void runVoiceSession({
      record: token ? keptAlive(recorderForToken(token)) : undefined,
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

/**
 * Holds the function open until the call has been written down.
 *
 * The write is fire-and-forget by design — a slow database must never keep a
 * caller on the line — but on a serverless host "later" can be after the
 * function has been torn down. It was: the call row appeared, and the
 * transcript and timings, written when the socket closed, never did. `waitUntil`
 * is how the platform is told the work outlives the response.
 */
function keptAlive(inner: CallRecorder): CallRecorder {
  return {
    begin: () => inner.begin(),
    end: (input) => {
      const done = inner.end(input)
      waitUntil(done)
      return done
    },
  }
}
