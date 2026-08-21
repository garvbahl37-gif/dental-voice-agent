import { localParts } from '@vaani/telephony'

/**
 * Whether this person may be called, right now.
 *
 * An outbound dialler is the part of this product that can do real harm. An
 * inbound agent only ever talks to someone who chose to ring; an outbound one
 * rings people who did not, and gets it wrong at scale. So the checks are
 * written as one pure function with an explicit reason for every refusal,
 * separately testable, and applied before a number is ever dialled.
 *
 * Ordered by how much the failure costs:
 *
 *   1. **Do-not-contact.** Someone asked not to be rung. Nothing else on this
 *      list outranks that, including an appointment tomorrow.
 *   2. **Consent for this channel.** Consent to be called is not consent to be
 *      messaged, and neither is implied by having been a patient.
 *   3. **The calling window.** Ringing a stranger at seven in the morning is
 *      illegal in some jurisdictions and rude in all of them.
 *   4. **Attempts.** A third unanswered call is harassment, not persistence.
 *   5. **One call a day.** Two automated calls in an afternoon reads as a
 *      malfunction, which is exactly what it is.
 */

export type RefusalReason =
  | 'do_not_contact'
  | 'no_consent'
  | 'outside_window'
  | 'max_attempts'
  | 'already_called_today'
  | 'no_phone'
  | 'campaign_paused'

export interface DialCheck {
  allowed: boolean
  reason?: RefusalReason
  /** When it would next be allowed, if the only problem is timing. */
  retryAt?: Date
}

export interface DialSubject {
  phone: string | null
  doNotContact: boolean
  consentCall: boolean
}

export interface DialCampaign {
  status: string
  windowStart: string
  windowEnd: string
  maxAttempts: number
}

export interface DialAttemptState {
  attempts: number
  lastCalledAt?: Date | null
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':')
  return Number(h) * 60 + Number(m)
}

export function mayDial(input: {
  subject: DialSubject
  campaign: DialCampaign
  state: DialAttemptState
  timezone: string
  now?: Date
}): DialCheck {
  const { subject, campaign, state, timezone } = input
  const now = input.now ?? new Date()

  if (campaign.status !== 'active') return { allowed: false, reason: 'campaign_paused' }
  if (!subject.phone) return { allowed: false, reason: 'no_phone' }
  if (subject.doNotContact) return { allowed: false, reason: 'do_not_contact' }
  if (!subject.consentCall) return { allowed: false, reason: 'no_consent' }
  if (state.attempts >= campaign.maxAttempts) return { allowed: false, reason: 'max_attempts' }

  const { minutes } = localParts(now, timezone)
  const open = toMinutes(campaign.windowStart)
  const close = toMinutes(campaign.windowEnd)
  if (minutes < open || minutes >= close) {
    return { allowed: false, reason: 'outside_window', retryAt: nextWindowOpen(now, timezone, open) }
  }

  if (state.lastCalledAt) {
    const last = localParts(state.lastCalledAt, timezone)
    const today = localParts(now, timezone)
    if (last.iso === today.iso) {
      return {
        allowed: false,
        reason: 'already_called_today',
        retryAt: nextWindowOpen(now, timezone, open, 1),
      }
    }
  }

  return { allowed: true }
}

/**
 * The next instant the window is open, in the practice's timezone.
 *
 * Computed by walking forward in real time rather than by arithmetic on a local
 * wall clock, so it stays correct across a DST boundary — India has none, but a
 * tenant elsewhere would silently get this wrong otherwise.
 */
export function nextWindowOpen(
  from: Date,
  timezone: string,
  openMinutes: number,
  skipDays = 0,
): Date {
  const cursor = new Date(from.getTime() + skipDays * 24 * 3600_000)
  for (let step = 0; step < 60 * 24 * 8; step += 15) {
    const at = new Date(cursor.getTime() + step * 60_000)
    const { minutes } = localParts(at, timezone)
    if (Math.abs(minutes - openMinutes) < 15 && at.getTime() > from.getTime()) return at
  }
  return new Date(from.getTime() + 24 * 3600_000)
}

/**
 * How long to wait before trying again.
 *
 * Deliberately long. A retry that lands twenty minutes later reads as a system
 * malfunction; the next day reads as a practice following up.
 */
export function backoffFor(attempts: number): number {
  return attempts <= 1 ? 4 * 3600_000 : 24 * 3600_000
}
