import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * The multi-tenant schema.
 *
 * One rule runs through all of it: **every row that belongs to a clinic carries
 * `orgId`, and no query reaches the database without one.** Tenant isolation
 * enforced only by remembering to add a WHERE clause is tenant isolation that
 * fails the first time somebody forgets — so the repository layer takes the org
 * in its constructor and every query it builds is scoped before the caller sees
 * it. There is no method that can read across tenants.
 *
 * For a product handling patient names, phone numbers and the reason someone
 * rang a dentist, that is the difference between a bug and a notifiable breach.
 *
 * Money, durations and counts are integers in their smallest unit (paise,
 * minutes) — floats lose rupees, and a fee that is off by a paisa is a fee the
 * practice has to explain at the counter.
 */

// ── Tenancy ──────────────────────────────────────────────────────────────────

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Subdomain the dashboard is reached on: `smile` → smile.vaani.app */
    slug: text('slug').notNull(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    /** Languages this clinic's agent is allowed to speak. */
    languages: jsonb('languages').$type<string[]>().notNull().default(['en-IN', 'hi-IN', 'hi-Latn-IN']),
    /** Prebuilt Gemini voice. Per-tenant so two clinics do not sound identical. */
    voice: text('voice').notNull().default('Leda'),
    /** Free-text persona and policy overlay, appended to the system prompt. */
    agentPersona: text('agent_persona'),
    plan: text('plan').notNull().default('trial'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organizations_slug_idx').on(t.slug)],
)

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** argon2/scrypt digest. Never a plaintext or reversible value. */
    passwordHash: text('password_hash').notNull(),
    /** owner > admin > receptionist > viewer. Checked on every dashboard route. */
    role: text('role').$type<'owner' | 'admin' | 'receptionist' | 'viewer'>().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Email is unique per tenant, not globally: the same person may work at two
    // practices, and forcing one login across tenants leaks that they do.
    uniqueIndex('users_org_email_idx').on(t.orgId, t.email),
    index('users_org_idx').on(t.orgId),
  ],
)

/**
 * The telephony tenant key.
 *
 * An inbound call arrives knowing only which number was dialled. This table is
 * what turns that into a tenant, so it is the single most security-sensitive
 * mapping in the schema: get it wrong and one clinic's agent answers with
 * another clinic's diary. The number is globally unique for that reason.
 */
export const phoneNumbers = pgTable(
  'phone_numbers',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: text('branch_id'),
    /** E.164. The exact string Twilio puts in the `To` field. */
    e164: text('e164').notNull(),
    provider: text('provider').notNull().default('twilio'),
    label: text('label'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('phone_numbers_e164_idx').on(t.e164),
    index('phone_numbers_org_idx').on(t.orgId),
  ],
)

// ── The practice ─────────────────────────────────────────────────────────────

export const branches = pgTable(
  'branches',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    area: text('area').notNull(),
    city: text('city').notNull(),
    address: text('address'),
    phone: text('phone'),
    /** Emergency line read out when triage escalates outside hours. */
    emergencyPhone: text('emergency_phone'),
    /** [{day:1..7, open:"09:30", close:"19:00"}] in the org's timezone. */
    hours: jsonb('hours').$type<BranchHours[]>().notNull().default([]),
    facilities: jsonb('facilities').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('branches_org_idx').on(t.orgId)],
)

export interface BranchHours {
  day: number
  open: string
  close: string
}

export const providers = pgTable(
  'providers',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    title: text('title').notNull(),
    qualifications: text('qualifications'),
    specialties: jsonb('specialties').$type<string[]>().notNull().default([]),
    languages: jsonb('languages').$type<string[]>().notNull().default([]),
    /** ISO weekday numbers this dentist works. */
    days: jsonb('days').$type<number[]>().notNull().default([]),
    branchIds: jsonb('branch_ids').$type<string[]>().notNull().default([]),
    /** How the name should be said aloud: "Iyer [EYE-yer]". */
    pronunciation: text('pronunciation'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('providers_org_idx').on(t.orgId)],
)

export const services = pgTable(
  'services',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** What patients call it — "safai", "cap", "RCT". Drives intent matching. */
    alsoCalled: jsonb('also_called').$type<string[]>().notNull().default([]),
    durationMin: integer('duration_min').notNull(),
    /** Paise. Integers, because a fee off by a rounding error is a fee argued at the counter. */
    priceMinPaise: integer('price_min_paise'),
    priceMaxPaise: integer('price_max_paise'),
    /** Specialties a provider must have to perform this. Empty = any dentist. */
    requiresSpecialty: jsonb('requires_specialty').$type<string[]>().notNull().default([]),
    /** Equipment the chair must have — "rotary endo", "digital x-ray". */
    requiresEquipment: jsonb('requires_equipment').$type<string[]>().notNull().default([]),
    /** Recall interval in days: cleaning every 180, for the recall campaign. */
    recallDays: integer('recall_days'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('services_org_idx').on(t.orgId)],
)

export const operatories = pgTable(
  'operatories',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: text('branch_id').notNull(),
    name: text('name').notNull(),
    equipment: jsonb('equipment').$type<string[]>().notNull().default([]),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('operatories_org_idx').on(t.orgId)],
)

// ── People and the diary ─────────────────────────────────────────────────────

export const patients = pgTable(
  'patients',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    preferredLanguage: text('preferred_language'),
    /** Learned, not asked: who they usually see and where. */
    preferredProviderId: text('preferred_provider_id'),
    preferredBranchId: text('preferred_branch_id'),
    notes: text('notes'),
    /** Consent is recorded, not assumed — DPDP and every reminder depends on it. */
    consentCall: boolean('consent_call').notNull().default(true),
    consentSms: boolean('consent_sms').notNull().default(true),
    consentWhatsapp: boolean('consent_whatsapp').notNull().default(false),
    /** Set when a caller asks not to be contacted. Outbound must honour it. */
    doNotContact: boolean('do_not_contact').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Phone is the identity a caller arrives with, so the lookup is by (org, phone).
    index('patients_org_phone_idx').on(t.orgId, t.phone),
    index('patients_org_idx').on(t.orgId),
  ],
)

export const appointments = pgTable(
  'appointments',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: text('branch_id').notNull(),
    patientId: text('patient_id').notNull(),
    providerId: text('provider_id').notNull(),
    operatoryId: text('operatory_id').notNull(),
    serviceId: text('service_id').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'booked' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'>()
      .notNull()
      .default('booked'),
    /** Which channel created it — web, phone, outbound campaign, a human. */
    source: text('source').notNull().default('phone'),
    /** The call that produced it, for attribution and ROI. */
    callId: text('call_id'),
    notes: text('notes'),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('appointments_org_start_idx').on(t.orgId, t.startAt),
    // The double-booking guards read by provider and by chair, separately —
    // one dentist cannot be in two rooms, and one chair cannot hold two patients.
    index('appointments_provider_start_idx').on(t.providerId, t.startAt),
    index('appointments_operatory_start_idx').on(t.operatoryId, t.startAt),
    index('appointments_patient_idx').on(t.patientId),
  ],
)

export const waitlist = pgTable(
  'waitlist',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    patientId: text('patient_id').notNull(),
    serviceId: text('service_id'),
    branchId: text('branch_id'),
    providerId: text('provider_id'),
    /** Free text as the patient said it: "any evening this week". */
    preference: text('preference'),
    /** Higher first when a cancellation frees a slot. */
    priority: integer('priority').notNull().default(0),
    status: text('status').$type<'waiting' | 'offered' | 'booked' | 'expired'>().notNull().default('waiting'),
    lastOfferedAt: timestamp('last_offered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('waitlist_org_status_idx').on(t.orgId, t.status)],
)

// ── Calls, traces and escalations ────────────────────────────────────────────

export const calls = pgTable(
  'calls',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    branchId: text('branch_id'),
    channel: text('channel').$type<'web' | 'twilio' | 'whatsapp'>().notNull(),
    direction: text('direction').$type<'inbound' | 'outbound'>().notNull().default('inbound'),
    /** Provider's own id, so a call can be reconciled against their billing. */
    externalId: text('external_id'),
    fromNumber: text('from_number'),
    toNumber: text('to_number'),
    patientId: text('patient_id'),
    language: text('language'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSec: integer('duration_sec'),
    outcome: text('outcome')
      .$type<'booked' | 'rescheduled' | 'cancelled' | 'answered' | 'escalated' | 'abandoned' | 'no_speech' | 'failed'>(),
    /** Rules-based triage band, never a model's opinion. */
    triageBand: text('triage_band'),
    transferred: boolean('transferred').notNull().default(false),
    /** Cheap enough to store, and the only way to audit what was actually said. */
    transcript: jsonb('transcript').$type<CallTurn[]>().notNull().default([]),
    summary: text('summary'),
    sentiment: text('sentiment'),
    /** Latency and cost, so per-call economics are measurable rather than guessed. */
    firstResponseMs: integer('first_response_ms'),
    avgResponseMs: integer('avg_response_ms'),
    bargeInCount: integer('barge_in_count').notNull().default(0),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Paise, like every other amount here. Micro-rupees overflowed int32. */
    costPaise: integer('cost_paise'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('calls_org_started_idx').on(t.orgId, t.startedAt),
    index('calls_org_outcome_idx').on(t.orgId, t.outcome),
    index('calls_patient_idx').on(t.patientId),
  ],
)

export interface CallTurn {
  speaker: 'caller' | 'agent'
  text: string
  lang?: string
  atMs: number
}

/**
 * The per-call trace.
 *
 * One row per thing that happened, with the millisecond it happened at. This is
 * what makes "why did that call go wrong" answerable after the fact instead of
 * a guess reconstructed from a transcript.
 */
export const callEvents = pgTable(
  'call_events',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    callId: text('call_id').notNull(),
    atMs: integer('at_ms').notNull(),
    kind: text('kind').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    durationMs: integer('duration_ms'),
    ok: boolean('ok'),
  },
  (t) => [index('call_events_call_idx').on(t.callId, t.atMs)],
)

/**
 * A handoff brief.
 *
 * Deliberately not "read the transcript". A receptionist picking this up needs
 * to know what was tried and what to do next, in the seconds before they speak.
 */
export const escalations = pgTable(
  'escalations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    callId: text('call_id').notNull(),
    patientId: text('patient_id'),
    reason: text('reason').notNull(),
    urgency: text('urgency').$type<'low' | 'normal' | 'high' | 'emergency'>().notNull(),
    /** What happened, what the agent tried, what a human should do now. */
    brief: jsonb('brief').$type<HandoffBrief>().notNull(),
    status: text('status').$type<'open' | 'acknowledged' | 'resolved'>().notNull().default('open'),
    assignedTo: text('assigned_to'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('escalations_org_status_idx').on(t.orgId, t.status)],
)

export interface HandoffBrief {
  patientName?: string
  patientPhone?: string
  language?: string
  reason: string
  whatHappened: string[]
  agentActions: string[]
  recommendedAction: string
}

// ── Knowledge ────────────────────────────────────────────────────────────────

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Where it came from, so an answer can be traced to a source. */
    sourceType: text('source_type').$type<'pdf' | 'url' | 'docx' | 'text' | 'crawl'>().notNull(),
    sourceRef: text('source_ref'),
    status: text('status').$type<'pending' | 'indexed' | 'failed'>().notNull().default('pending'),
    error: text('error'),
    chunkCount: integer('chunk_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('knowledge_documents_org_idx').on(t.orgId)],
)

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    documentId: text('document_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    content: text('content').notNull(),
    /**
     * gemini-embedding-001 at 768 dims, as a plain float array.
     *
     * Not pgvector. A clinic's whole corpus — price list, policies, FAQs, a few
     * brochures — is hundreds to low thousands of chunks, where exact cosine
     * over an array is both fast and precise; pgvector earns its keep at
     * millions of rows, and requiring an extension here would mean the
     * retrieval path could not be tested in-process at all. Untested retrieval
     * is a worse trade than an unindexed scan. Move to pgvector when a single
     * tenant's corpus makes exact search measurably slow.
     */
    embedding: real('embedding').array(),
    /** Kept alongside the vector so retrieval can be hybrid rather than purely semantic. */
    tokens: integer('tokens'),
  },
  (t) => [index('knowledge_chunks_org_doc_idx').on(t.orgId, t.documentId)],
)

// ── Outbound ─────────────────────────────────────────────────────────────────

export const campaigns = pgTable(
  'campaigns',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind')
      .$type<'reminder' | 'recall' | 'waitlist' | 'missed_call' | 'followup'>()
      .notNull(),
    status: text('status').$type<'draft' | 'active' | 'paused' | 'done'>().notNull().default('draft'),
    /** Calling outside these hours is illegal in some jurisdictions and rude in all. */
    windowStart: text('window_start').notNull().default('10:00'),
    windowEnd: text('window_end').notNull().default('19:00'),
    maxAttempts: integer('max_attempts').notNull().default(2),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('campaigns_org_idx').on(t.orgId)],
)

export const campaignTargets = pgTable(
  'campaign_targets',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').notNull(),
    patientId: text('patient_id').notNull(),
    appointmentId: text('appointment_id'),
    status: text('status')
      .$type<'queued' | 'calling' | 'done' | 'failed' | 'skipped'>()
      .notNull()
      .default('queued'),
    attempts: integer('attempts').notNull().default(0),
    /** Earliest this may be dialled — respects the window and any backoff. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /**
     * When it was last actually dialled.
     *
     * Distinct from nextAttemptAt, which is a plan rather than a record. The
     * once-a-day rule needs the record; reading the plan instead made every
     * freshly queued target look as though it had already been rung today.
     */
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastCallId: text('last_call_id'),
    result: text('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('campaign_targets_due_idx').on(t.orgId, t.status, t.nextAttemptAt),
    index('campaign_targets_campaign_idx').on(t.campaignId),
  ],
)

// ── Evaluation ───────────────────────────────────────────────────────────────

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id'),
    suite: text('suite').notNull(),
    gitSha: text('git_sha'),
    model: text('model'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [index('eval_runs_suite_idx').on(t.suite, t.startedAt)],
)

export const evalCases = pgTable(
  'eval_cases',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    scenario: text('scenario').notNull(),
    passed: boolean('passed').notNull(),
    scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
    transcript: jsonb('transcript').$type<CallTurn[]>().notNull().default([]),
    failures: jsonb('failures').$type<string[]>().notNull().default([]),
  },
  (t) => [index('eval_cases_run_idx').on(t.runId)],
)

// ── Sessions ─────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the cookie value. A stolen database must not yield live sessions. */
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id').notNull(),
    orgId: text('org_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** Every privileged action, so an access question has an answer. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    target: text('target'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_at_idx').on(t.orgId, t.at)],
)

export const usageDaily = pgTable(
  'usage_daily',
  {
    orgId: text('org_id').notNull(),
    day: text('day').notNull(),
    calls: integer('calls').notNull().default(0),
    callSeconds: integer('call_seconds').notNull().default(0),
    bookings: integer('bookings').notNull().default(0),
    escalations: integer('escalations').notNull().default(0),
    modelCostPaise: integer('model_cost_paise').notNull().default(0),
    telephonyCostPaise: integer('telephony_cost_paise').notNull().default(0),
    revenuePaise: integer('revenue_paise').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.day] })],
)

export const schema = {
  organizations,
  users,
  sessions,
  phoneNumbers,
  branches,
  providers,
  services,
  operatories,
  patients,
  appointments,
  waitlist,
  calls,
  callEvents,
  escalations,
  knowledgeDocuments,
  knowledgeChunks,
  campaigns,
  campaignTargets,
  evalRuns,
  evalCases,
  auditLog,
  usageDaily,
}
