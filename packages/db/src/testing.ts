import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { sql } from 'drizzle-orm'
import type { Database } from './client'
import { schema } from './schema'

/**
 * A real Postgres, in-process, per test.
 *
 * Multi-tenant isolation is the property most worth testing here, and it is
 * exactly the property a mocked repository cannot check: a fake that returns
 * whatever it was told proves nothing about whether the WHERE clause was
 * present. pglite is Postgres compiled to WASM, so the tests run the same SQL
 * the production database will, with no container and no external service.
 */

export interface TestDb {
  db: Database
  close: () => Promise<void>
}

export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite()
  await client.waitReady
  // pglite's own exec runs a multi-statement script; drizzle's execute takes
  // one statement at a time and chokes on the whole DDL.
  await client.exec(DDL)
  const db = drizzle(client, { schema }) as unknown as Database
  return { db, close: () => client.close() }
}

/**
 * The schema, as DDL.
 *
 * Deliberately hand-written next to `schema.ts` rather than generated at test
 * time: drizzle-kit needs a filesystem and a subprocess, and a test harness
 * that shells out is a test harness that fails in CI for reasons unrelated to
 * the code. The `schema.test.ts` case asserts the two stay in step, so drift
 * fails a test rather than surfacing in production.
 */
export async function createTables(db: Database): Promise<void> {
  for (const statement of DDL.split(';').map((x) => x.trim()).filter(Boolean)) {
    await db.execute(sql.raw(statement))
  }
}

export const DDL = `
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  languages jsonb NOT NULL DEFAULT '["en-IN","hi-IN","hi-Latn-IN"]',
  voice text NOT NULL DEFAULT 'Leda',
  agent_persona text,
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_org_email_idx ON users (org_id, email);
CREATE INDEX IF NOT EXISTS users_org_idx ON users (org_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  org_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS phone_numbers (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id text,
  e164 text NOT NULL,
  provider text NOT NULL DEFAULT 'twilio',
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS phone_numbers_e164_idx ON phone_numbers (e164);
CREATE INDEX IF NOT EXISTS phone_numbers_org_idx ON phone_numbers (org_id);

CREATE TABLE IF NOT EXISTS branches (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  area text NOT NULL,
  city text NOT NULL,
  address text,
  phone text,
  emergency_phone text,
  hours jsonb NOT NULL DEFAULT '[]',
  facilities jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS branches_org_idx ON branches (org_id);

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text NOT NULL,
  qualifications text,
  specialties jsonb NOT NULL DEFAULT '[]',
  languages jsonb NOT NULL DEFAULT '[]',
  days jsonb NOT NULL DEFAULT '[]',
  branch_ids jsonb NOT NULL DEFAULT '[]',
  pronunciation text,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS providers_org_idx ON providers (org_id);

CREATE TABLE IF NOT EXISTS services (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  also_called jsonb NOT NULL DEFAULT '[]',
  duration_min integer NOT NULL,
  price_min_paise integer,
  price_max_paise integer,
  requires_specialty jsonb NOT NULL DEFAULT '[]',
  requires_equipment jsonb NOT NULL DEFAULT '[]',
  recall_days integer,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS services_org_idx ON services (org_id);

CREATE TABLE IF NOT EXISTS operatories (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id text NOT NULL,
  name text NOT NULL,
  equipment jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS operatories_org_idx ON operatories (org_id);

CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  email text,
  preferred_language text,
  preferred_provider_id text,
  preferred_branch_id text,
  notes text,
  consent_call boolean NOT NULL DEFAULT true,
  consent_sms boolean NOT NULL DEFAULT true,
  consent_whatsapp boolean NOT NULL DEFAULT false,
  do_not_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patients_org_phone_idx ON patients (org_id, phone);
CREATE INDEX IF NOT EXISTS patients_org_idx ON patients (org_id);

CREATE TABLE IF NOT EXISTS appointments (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id text NOT NULL,
  patient_id text NOT NULL,
  provider_id text NOT NULL,
  operatory_id text NOT NULL,
  service_id text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'booked',
  source text NOT NULL DEFAULT 'phone',
  call_id text,
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_org_start_idx ON appointments (org_id, start_at);
CREATE INDEX IF NOT EXISTS appointments_provider_start_idx ON appointments (provider_id, start_at);
CREATE INDEX IF NOT EXISTS appointments_operatory_start_idx ON appointments (operatory_id, start_at);
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id);

CREATE TABLE IF NOT EXISTS waitlist (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  patient_id text NOT NULL,
  service_id text,
  branch_id text,
  provider_id text,
  preference text,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'waiting',
  last_offered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_org_status_idx ON waitlist (org_id, status);

CREATE TABLE IF NOT EXISTS calls (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id text,
  channel text NOT NULL,
  direction text NOT NULL DEFAULT 'inbound',
  external_id text,
  from_number text,
  to_number text,
  patient_id text,
  language text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_sec integer,
  outcome text,
  triage_band text,
  transferred boolean NOT NULL DEFAULT false,
  transcript jsonb NOT NULL DEFAULT '[]',
  summary text,
  sentiment text,
  first_response_ms integer,
  avg_response_ms integer,
  barge_in_count integer NOT NULL DEFAULT 0,
  input_tokens integer,
  output_tokens integer,
  cost_paise integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calls_org_started_idx ON calls (org_id, started_at);
CREATE INDEX IF NOT EXISTS calls_org_outcome_idx ON calls (org_id, outcome);
CREATE INDEX IF NOT EXISTS calls_patient_idx ON calls (patient_id);

CREATE TABLE IF NOT EXISTS call_events (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  at_ms integer NOT NULL,
  kind text NOT NULL,
  detail jsonb,
  duration_ms integer,
  ok boolean
);
CREATE INDEX IF NOT EXISTS call_events_call_idx ON call_events (call_id, at_ms);

CREATE TABLE IF NOT EXISTS escalations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  patient_id text,
  reason text NOT NULL,
  urgency text NOT NULL,
  brief jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  assigned_to text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS escalations_org_status_idx ON escalations (org_id, status);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  chunk_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_documents_org_idx ON knowledge_documents (org_id);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id text NOT NULL,
  ordinal integer NOT NULL,
  content text NOT NULL,
  embedding real[],
  tokens integer
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_org_doc_idx ON knowledge_chunks (org_id, document_id);

CREATE TABLE IF NOT EXISTS campaigns (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  window_start text NOT NULL DEFAULT '10:00',
  window_end text NOT NULL DEFAULT '19:00',
  max_attempts integer NOT NULL DEFAULT 2,
  config jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_org_idx ON campaigns (org_id);

CREATE TABLE IF NOT EXISTS campaign_targets (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id text NOT NULL,
  patient_id text NOT NULL,
  appointment_id text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  last_call_id text,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_targets_due_idx ON campaign_targets (org_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS campaign_targets_campaign_idx ON campaign_targets (campaign_id);

CREATE TABLE IF NOT EXISTS eval_runs (
  id text PRIMARY KEY,
  org_id text,
  suite text NOT NULL,
  git_sha text,
  model text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  passed integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  scores jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS eval_runs_suite_idx ON eval_runs (suite, started_at);

CREATE TABLE IF NOT EXISTS eval_cases (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  scenario text NOT NULL,
  passed boolean NOT NULL,
  scores jsonb NOT NULL DEFAULT '{}',
  transcript jsonb NOT NULL DEFAULT '[]',
  failures jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS eval_cases_run_idx ON eval_cases (run_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  actor_id text,
  action text NOT NULL,
  target text,
  detail jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_at_idx ON audit_log (org_id, at);

CREATE TABLE IF NOT EXISTS usage_daily (
  org_id text NOT NULL,
  day text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  call_seconds integer NOT NULL DEFAULT 0,
  bookings integer NOT NULL DEFAULT 0,
  escalations integer NOT NULL DEFAULT 0,
  model_cost_paise integer NOT NULL DEFAULT 0,
  telephony_cost_paise integer NOT NULL DEFAULT 0,
  revenue_paise integer NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day)
);

-- ── Additive migrations ─────────────────────────────────────────────────────
--
-- CREATE TABLE IF NOT EXISTS skips a table that already exists, columns and
-- all, so a new field added above never reaches a database that predates it.
-- Postgres has an idempotent ADD COLUMN, which covers the common case safely
-- and can be re-run on every deploy. A rename or a retype still needs a real
-- migration; this only closes the gap for additions.
ALTER TABLE campaign_targets ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS cost_paise integer;
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS model_cost_paise integer NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS telephony_cost_paise integer NOT NULL DEFAULT 0;
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS revenue_paise integer NOT NULL DEFAULT 0;
`
