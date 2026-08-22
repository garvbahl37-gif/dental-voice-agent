import { z } from 'zod'
import { LangSchema } from './lang'

/**
 * The wire protocol between any client and the voice server.
 *
 * This file is the contract. Both sides validate against it at the boundary,
 * so a malformed frame fails loudly here rather than as a mystery three layers
 * deep in the pipeline.
 *
 * Audio travels as binary frames alongside this channel — never inside JSON.
 * Base64-in-JSON would add ~33% bandwidth and a serialisation hop to the one
 * path where latency is measured in single milliseconds.
 */

export const PROTOCOL_VERSION = 1

// ─── Shared shapes ───────────────────────────────────────────────────────────

/**
 * A word and the window during which it was audible.
 *
 * These are the backbone of correct barge-in: given how much audio actually
 * reached the caller, marks tell us exactly which words they heard, so the
 * agent's own history can be rewritten to match reality.
 */
export const WordMarkSchema = z.object({
  word: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
})
export type WordMark = z.infer<typeof WordMarkSchema>

export const ChannelSchema = z.enum(['web', 'twilio', 'whatsapp'])
export type Channel = z.infer<typeof ChannelSchema>

export const TierSchema = z.enum(['local', 'cloud'])

export const TierConfigSchema = z.object({
  stt: TierSchema,
  llm: TierSchema,
  tts: TierSchema,
})
export type TierConfig = z.infer<typeof TierConfigSchema>

export const AgentStateSchema = z.enum([
  'idle',
  'listening',
  'thinking',
  'speaking',
  'tool_running',
])
export type AgentState = z.infer<typeof AgentStateSchema>

// ─── Client → Server ─────────────────────────────────────────────────────────

const SessionStart = z.object({
  type: z.literal('session.start'),
  channel: ChannelSchema.default('web'),
  lang: LangSchema.optional(),
  tier: TierConfigSchema.partial().optional(),
  /** Phone number or patient id, when the channel already knows who is calling. */
  patientHint: z.string().optional(),
})

const AudioMeta = z.object({
  type: z.literal('audio.meta'),
  sampleRate: z.number().int().positive(),
})

const VadSpeechStart = z.object({
  type: z.literal('vad.speech_start'),
  t: z.number().nonnegative(),
})

const VadSpeechEnd = z.object({
  type: z.literal('vad.speech_end'),
  t: z.number().nonnegative(),
})

/**
 * How much of an agent utterance has actually left the speaker.
 *
 * The single most important client→server message. Without it the server can
 * only guess what the caller heard, and every interruption desynchronises the
 * conversation.
 */
const PlaybackProgress = z.object({
  type: z.literal('playback.progress'),
  utteranceId: z.string(),
  playedMs: z.number().int().nonnegative(),
})

const PlaybackComplete = z.object({
  type: z.literal('playback.complete'),
  utteranceId: z.string(),
})

const ControlInterrupt = z.object({ type: z.literal('control.interrupt') })

const ControlDtmf = z.object({
  type: z.literal('control.dtmf'),
  digit: z.string().length(1),
})

const ControlSetTier = z.object({
  type: z.literal('control.set_tier'),
  tier: TierConfigSchema.partial(),
})

const ControlSetLang = z.object({
  type: z.literal('control.set_lang'),
  lang: LangSchema,
})

const SessionEnd = z.object({ type: z.literal('session.end') })

export const ClientEventSchema = z.discriminatedUnion('type', [
  SessionStart,
  AudioMeta,
  VadSpeechStart,
  VadSpeechEnd,
  PlaybackProgress,
  PlaybackComplete,
  ControlInterrupt,
  ControlDtmf,
  ControlSetTier,
  ControlSetLang,
  SessionEnd,
])
export type ClientEvent = z.infer<typeof ClientEventSchema>

// ─── Server → Client ─────────────────────────────────────────────────────────

const SessionReady = z.object({
  type: z.literal('session.ready'),
  sessionId: z.string(),
  agentName: z.string(),
  practiceName: z.string(),
  voiceId: z.string(),
  tier: TierConfigSchema,
  /** Components that fell back to local because a cloud key was absent. */
  downgraded: z.array(z.enum(['stt', 'llm', 'tts'])),
})

const SttPartial = z.object({
  type: z.literal('stt.partial'),
  /**
   * The id this utterance will settle under.
   *
   * Without it the console had to guess which bubble a partial belonged to by
   * looking at whichever one happened to be last, so two things the caller said
   * before the agent answered ran together into a single bubble.
   */
  turnId: z.string(),
  text: z.string(),
  lang: LangSchema,
  confidence: z.number().min(0).max(1),
})

const SttFinal = z.object({
  type: z.literal('stt.final'),
  turnId: z.string(),
  text: z.string(),
  lang: LangSchema,
  codeSwitched: z.boolean(),
})

const AgentStateEvent = z.object({
  type: z.literal('agent.state'),
  state: AgentStateSchema,
})

const AgentToken = z.object({
  type: z.literal('agent.token'),
  turnId: z.string(),
  text: z.string(),
})

const TtsBegin = z.object({
  type: z.literal('tts.begin'),
  utteranceId: z.string(),
  turnId: z.string(),
  text: z.string(),
  lang: LangSchema,
  marks: z.array(WordMarkSchema),
  cached: z.boolean(),
})

/**
 * Sent when the caller interrupted. `truncateAtMs` is where playback actually
 * stopped; the client strikes through everything after it in the transcript,
 * making the correct handling visible rather than merely correct.
 */
const TtsCancel = z.object({
  type: z.literal('tts.cancel'),
  utteranceId: z.string(),
  truncateAtMs: z.number().int().nonnegative(),
  spokenPrefix: z.string(),
})

const ToolCall = z.object({
  type: z.literal('tool.call'),
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
})

const ToolResult = z.object({
  type: z.literal('tool.result'),
  id: z.string(),
  name: z.string(),
  ok: z.boolean(),
  result: z.unknown(),
  ms: z.number().nonnegative(),
})

const MetricsTurn = z.object({
  type: z.literal('metrics.turn'),
  turnId: z.string(),
  sttMs: z.number().nonnegative(),
  llmTtftMs: z.number().nonnegative(),
  ttsTtfbMs: z.number().nonnegative(),
  e2eMs: z.number().nonnegative(),
  tier: TierSchema,
  cached: z.boolean(),
})

/**
 * Domain events that drive the live practice panel — the calendar fills the
 * instant a booking commits, the patient card populates as details are
 * extracted. This is what makes the console feel like a running system rather
 * than a chat log.
 */
const UiEvent = z.object({
  type: z.literal('ui.event'),
  event: z.enum([
    'patient.identified',
    'patient.updated',
    'appointment.held',
    'appointment.booked',
    'appointment.cancelled',
    'appointment.rescheduled',
    'waitlist.joined',
    'triage.escalated',
    'handoff.requested',
    'knowledge.cited',
  ]),
  payload: z.record(z.unknown()),
})

const LangDetected = z.object({
  type: z.literal('lang.detected'),
  lang: LangSchema,
  confidence: z.number().min(0).max(1),
  codeSwitched: z.boolean(),
})

const ErrorEvent = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean(),
})

export const ServerEventSchema = z.discriminatedUnion('type', [
  SessionReady,
  SttPartial,
  SttFinal,
  AgentStateEvent,
  AgentToken,
  TtsBegin,
  TtsCancel,
  ToolCall,
  ToolResult,
  MetricsTurn,
  UiEvent,
  LangDetected,
  ErrorEvent,
])
export type ServerEvent = z.infer<typeof ServerEventSchema>

// ─── Parsing ─────────────────────────────────────────────────────────────────

export function parseClientEvent(raw: unknown): ClientEvent {
  return ClientEventSchema.parse(raw)
}

export function parseServerEvent(raw: unknown): ServerEvent {
  return ServerEventSchema.parse(raw)
}

/**
 * Non-throwing variant for the socket read path. A single malformed frame from
 * a flaky client must never take down a live call.
 */
export function safeParseClientEvent(
  raw: unknown,
): { ok: true; event: ClientEvent } | { ok: false; error: string } {
  const r = ClientEventSchema.safeParse(raw)
  return r.success ? { ok: true, event: r.data } : { ok: false, error: r.error.message }
}
