import 'dotenv/config'
import { createServer, type IncomingMessage } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import { LIVE_VOICE } from '@vaani/live'
import { CallLog, PracticeStore } from '@vaani/agent'
import { LangSchema, voiceGender } from '@vaani/shared'

/**
 * Whether the agent speaks of herself as a woman.
 *
 * Follows the configured voice, because the two have to agree: Hindi, Marathi,
 * Punjabi and Gujarati inflect first-person verbs for the speaker's gender, and
 * a female voice using masculine verbs is wrong in a way every native speaker
 * hears at once.
 */
const AGENT_GENDER = voiceGender(LIVE_VOICE, process.env.GEMINI_LIVE_VOICE_GENDER)
import { WsTransport } from './ws-transport'
import { runVoiceSession } from '@vaani/session-host'
import { handleStatus, handleTransferResult, handleVoice } from './telephony'
import { handleTwilioStream } from './twilio-stream'
import { startOutboundWorker } from './outbound-worker'

/**
 * The voice server.
 *
 * Now a bridge rather than a pipeline. The browser holds one WebSocket to us;
 * we hold one Live session to Gemini. Audio passes through in both directions,
 * tools run here where the practice data lives, and Live's server messages are
 * translated into the `ServerEvent` protocol the console already speaks.
 *
 * The browser is deliberately not connected straight to Gemini. It could be —
 * the reference implementation mints an ephemeral token and does exactly that —
 * but our tools own the diary, the patient records and the call summary, and
 * those belong on the server.
 */

// Managed hosts inject PORT and expect the process to take it; ignoring it is
// the usual reason a container passes its build and then fails its health check.
const PORT = Number(process.env.PORT ?? process.env.VOICE_SERVER_PORT ?? 8787)
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''

const practice = new PracticeStore()

/** Call history. Survives between calls; not yet between restarts. */
const callLog = new CallLog()

/**
 * Who may read caller data.
 *
 * `/crm` and `/practice` return patient names, mobile numbers and the reason
 * someone called a dentist. That is health-adjacent personal data, so these
 * endpoints fail closed: with no token configured they answer only to loopback,
 * which is exactly the local-development case and nothing else. Setting
 * VAANI_ADMIN_TOKEN is what allows a real CRM to read them from off-box.
 *
 * The previous version sent `access-control-allow-origin: *` on every response
 * and required no credential at all, so any page in any browser could read the
 * whole call log off a reachable server.
 */
const ADMIN_TOKEN = process.env.VAANI_ADMIN_TOKEN ?? ''
const ALLOWED_ORIGINS = (process.env.VAANI_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

/** True once this server has been given any deployment configuration. */
const CONFIGURED = ADMIN_TOKEN.length > 0 || ALLOWED_ORIGINS.length > 0

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false
  const a = addr.replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

/** Constant-time, and length-safe — comparing different lengths throws. */
function tokenMatches(given: string): boolean {
  if (!ADMIN_TOKEN || given.length !== ADMIN_TOKEN.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(ADMIN_TOKEN))
}

function mayReadCallerData(req: import('node:http').IncomingMessage): boolean {
  if (ADMIN_TOKEN) {
    const header = req.headers.authorization ?? ''
    return header.startsWith('Bearer ') && tokenMatches(header.slice(7))
  }
  return !CONFIGURED && isLoopback(req.socket.remoteAddress)
}

const http = createServer(async (req, res) => {
  const origin = req.headers.origin
  // Reflect only configured origins. A wildcard here is what let any site read
  // the call log; `*` also cannot carry credentials, so it bought nothing.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('access-control-allow-credentials', 'true')
    res.setHeader('vary', 'Origin')
  }
  res.setHeader('access-control-allow-headers', 'authorization, content-type')

  const url = req.url ?? '/'

  /**
   * Telephony first.
   *
   * These carry their own authentication — a Twilio signature — rather than the
   * origin and token rules the dashboard endpoints use, because they are called
   * by Twilio's servers and not by a browser. Routing them before the CORS
   * gate keeps the two authentication schemes from being confused for one.
   */
  if (req.method === 'POST' && url.startsWith('/twilio/')) {
    const streamUrl =
      process.env.TWILIO_STREAM_URL ?? `wss://${req.headers.host ?? 'localhost'}/twilio/stream`
    try {
      if (url === '/twilio/voice') return await handleVoice(req, res, { streamUrl })
      if (url === '/twilio/status') return await handleStatus(req, res)
      if (url === '/twilio/transfer') return await handleTransferResult(req, res)
    } catch (err) {
      console.error('[twilio] webhook failed:', err)
      res.writeHead(500).end('error')
      return
    }
    res.writeHead(404).end()
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (url === '/health') {
    /**
     * Readable by anyone, deliberately.
     *
     * It carries no caller data, and the console probes it before opening a
     * socket so a sleeping server wakes rather than failing the handshake.
     * Restricting it to configured origins meant local development — which has
     * no configured origins — could not start a call at all.
     */
    res.setHeader('access-control-allow-origin', '*')
    return json(res, { ok: true, practice: practice.name, engine: 'gemini-live', voice: LIVE_VOICE })
  }
  if (url === '/providers') {
    const ready = GEMINI_KEY.length > 0
    return json(res, {
      stt: [{ id: 'gemini-live (native)', tier: 'cloud', available: ready }],
      llm: [{ id: process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview', tier: 'cloud', available: ready }],
      tts: [{ id: `gemini-live voice: ${LIVE_VOICE}`, tier: 'cloud', available: ready }],
    })
  }
  // Everything below returns caller data. One gate, checked before any of it.
  if (url === '/crm' || url.startsWith('/crm/') || url === '/practice') {
    if (!mayReadCallerData(req)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' })
      res.end(
        JSON.stringify({
          error: ADMIN_TOKEN
            ? 'A bearer token is required to read caller data.'
            : 'Caller data is served to localhost only. Set VAANI_ADMIN_TOKEN to read it from elsewhere.',
        }),
      )
      return
    }
  }

  if (url === '/crm') {
    return json(res, { stats: callLog.stats(), calls: callLog.all() })
  }
  if (url === '/crm/outstanding') {
    return json(res, callLog.outstanding())
  }
  if (url.startsWith('/crm/call/')) {
    const record = callLog.get(url.slice('/crm/call/'.length))
    if (!record) {
      res.writeHead(404)
      res.end()
      return
    }
    return json(res, record)
  }

  if (url === '/practice') {
    return json(res, {
      name: practice.name,
      providers: practice.providers,
      operatories: practice.operatories,
      services: practice.services,
      appointments: practice.appointments,
      waitlist: practice.waitlist,
      tasks: practice.tasks,
      patientCount: practice.patients.length,
    })
  }
  res.writeHead(404)
  res.end()
})

function json(res: import('node:http').ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/**
 * Who may open a call.
 *
 * A session spends the practice's Gemini quota and can drive every booking
 * tool, so an open socket is not a neutral thing to leave listening. Same
 * posture as the data endpoints: loopback by default, token or configured
 * origin to reach it from anywhere else.
 */
const twilioWss = new WebSocketServer({
  noServer: true,
  /**
   * No origin or token check here, deliberately.
   *
   * Twilio's media socket carries no signature and comes from Twilio's own
   * infrastructure, so authentication is the custom parameters it echoes —
   * issued by the voice webhook only after that request's signature verified,
   * and re-checked against the call row before any audio is processed.
   */
  verifyClient: (_info, done) => done(true),
})

twilioWss.on('connection', (socket) => {
  void handleTwilioStream(socket).catch((err) => {
    console.error('[twilio] stream failed:', err)
    try {
      socket.close()
    } catch {
      /* already gone */
    }
  })
})

const wss = new WebSocketServer({ noServer: true })

/**
 * Who may open a console call.
 *
 * The same rules the WebSocketServer used to enforce via verifyClient, lifted
 * out so the single upgrade router can apply them — behaviour unchanged.
 */
function consoleUpgradeAllowed(req: import('node:http').IncomingMessage): boolean {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.length > 0 && origin && ALLOWED_ORIGINS.includes(origin)) return true
  if (ADMIN_TOKEN) {
    const header = req.headers.authorization ?? ''
    if (header.startsWith('Bearer ') && tokenMatches(header.slice(7))) return true
  }
  // Loopback is a free pass only in local development — see CONFIGURED.
  return !CONFIGURED && isLoopback(req.socket.remoteAddress)
}

wss.on('connection', async (socket, req: IncomingMessage) => {
  /**
   * The language rides on the URL, not on a message.
   *
   * `speechConfig.languageCode` is fixed when the Live session connects, so the
   * greeting is spoken in whatever we connect with — and a message has to win a
   * race against that connect to matter. A query parameter is known at the
   * upgrade, before any of this runs, so there is no race to lose. A bad or
   * absent value simply falls back to the default rather than failing the call.
   */
  const requested = new URL(req.url ?? '/', 'http://localhost').searchParams.get('lang')
  const parsedLang = LangSchema.safeParse(requested)

  await runVoiceSession({
    // Random, not sequential. The id is also the CRM record key, and `s1_`,
    // `s2_`, … made every past call's record trivially guessable at /crm/call/:id.
    sessionId: randomUUID(),
    transport: new WsTransport(socket),
    lang: parsedLang.success ? parsedLang.data : 'en-IN',
    practice,
    callLog,
    apiKey: GEMINI_KEY,
    voice: LIVE_VOICE,
    gender: AGENT_GENDER,
    close: () => socket.close(),
  })
})

/**
 * One upgrade handler, routing by path.
 *
 * `new WebSocketServer({ server })` attaches its own `upgrade` listener and
 * destroys any socket whose path it does not recognise. With two of them on one
 * HTTP server, whichever fires first kills the other's connections — which is
 * exactly what happened when telephony was added: every console call started
 * failing its handshake with a 400 that never reached the auth gate.
 */
http.on('upgrade', (req, socket, head) => {
  const path = (req.url ?? '').split('?')[0]

  if (path === '/twilio/stream') {
    twilioWss.handleUpgrade(req, socket, head, (ws) => twilioWss.emit('connection', ws, req))
    return
  }

  if (path === '/session') {
    if (!consoleUpgradeAllowed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    return
  }

  socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
  socket.destroy()
})

// 0.0.0.0, not the default: inside a container, binding loopback makes the
// server unreachable from outside it.
http.listen(PORT, '0.0.0.0', () => {
  startOutboundWorker(
    process.env.TWILIO_STREAM_URL ?? `wss://localhost:${PORT}/twilio/stream`,
  )
  console.log('')
  console.log('  ▚ Vaani — AI front desk')
  console.log(`    ${practice.name}`)
  console.log(`    engine  gemini live · ${process.env.GEMINI_LIVE_MODEL ?? 'gemini-3.1-flash-live-preview'}`)
  console.log(`    voice   ${LIVE_VOICE}`)
  console.log(`    ws://localhost:${PORT}/session`)
  console.log('')
})
