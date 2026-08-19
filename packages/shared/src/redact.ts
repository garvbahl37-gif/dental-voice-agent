/**
 * PII redaction for logs.
 *
 * Every string that reaches a log call passes through here. Transcripts of
 * dental calls contain phone numbers, dates of birth, and health complaints —
 * that content belongs in the encrypted call record, never in stdout, and
 * never in a third-party log aggregator.
 */

// Indian mobile numbers, with or without +91, with spaces or hyphens.
const PHONE = /(\+?\d[\d\s-]{8,}\d)/g
const DOB = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g
// Indian health-insurance / policy numbers are commonly 10-16 alphanumerics.
const POLICY = /\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9-]{10,16}\b/g

export function redact(input: string): string {
  return input
    .replace(EMAIL, '[email]')
    .replace(DOB, '[dob]')
    .replace(PHONE, '[phone]')
    .replace(POLICY, '[policy]')
}

/** Redact string values throughout an arbitrary object, for structured logging. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as unknown as T
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out as T
  }
  return value
}

/**
 * Keep the last N characters of an identifier so support staff can correlate a
 * call without the log holding the full number.
 */
export function tail(value: string, keep = 4): string {
  if (value.length <= keep) return '*'.repeat(value.length)
  return `${'*'.repeat(value.length - keep)}${value.slice(-keep)}`
}
