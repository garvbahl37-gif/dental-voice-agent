'use client'

import type { TurnMetrics } from '@vaani/shared'
import { BUDGETS } from '@vaani/shared'

/**
 * The latency rail.
 *
 * Mouth-to-ear time is the number that decides whether a caller believes they
 * are talking to a person, so it belongs on screen permanently rather than in
 * a debug panel. Each stage is shown against its budget: over budget turns
 * amber, well over turns red. The bar is proportional, so a slow stage is
 * visible before the number is read.
 */

interface Props {
  metrics: TurnMetrics[]
}

export function LatencyRail({ metrics }: Props) {
  const latest = metrics.at(-1)
  const budget = latest ? BUDGETS[latest.tier] : BUDGETS.cloud

  const stages = latest
    ? [
        { name: 'stt', ms: latest.sttMs, limit: budget.sttFinalMs },
        { name: 'llm', ms: latest.llmTtftMs, limit: budget.llmTtftMs },
        { name: 'tts', ms: latest.ttsTtfbMs, limit: budget.ttsTtfbMs },
      ]
    : []

  const e2e = latest?.e2eMs ?? 0
  const e2eLimit = budget.e2eP50Ms

  return (
    <div style={styles.rail}>
      <span className="label">latency</span>

      {latest ? (
        <>
          {stages.map((s) => (
            <Stage key={s.name} {...s} />
          ))}

          <div style={styles.divider} />

          <div style={styles.stage}>
            <span className="label" style={{ color: 'var(--text-muted)' }}>
              mouth to ear
            </span>
            <span className="mono" style={{ ...styles.value, color: colourFor(e2e, e2eLimit) }}>
              {Math.round(e2e)}
              <span style={styles.unit}>ms</span>
            </span>
          </div>

          {latest.cached && <span style={styles.badge}>cached</span>}
          <span style={{ ...styles.badge, borderColor: 'var(--hairline-bright)' }}>
            {latest.tier}
          </span>
        </>
      ) : (
        <span style={styles.waiting}>waiting for the first turn</span>
      )}

      <div style={{ flex: 1 }} />

      {metrics.length > 1 && (
        <div style={styles.spark} title="mouth-to-ear, recent turns">
          {metrics.slice(-24).map((m, i) => (
            <span
              key={i}
              style={{
                ...styles.sparkBar,
                height: `${Math.min(100, (m.e2eMs / (e2eLimit * 1.6)) * 100)}%`,
                background: colourFor(m.e2eMs, e2eLimit),
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Stage({ name, ms, limit }: { name: string; ms: number; limit: number }) {
  return (
    <div style={styles.stage}>
      <span className="label">{name}</span>
      <span className="mono" style={{ ...styles.value, color: colourFor(ms, limit) }}>
        {Math.round(ms)}
        <span style={styles.unit}>ms</span>
      </span>
      <span style={styles.track}>
        <span
          style={{
            ...styles.fill,
            width: `${Math.min(100, (ms / limit) * 100)}%`,
            background: colourFor(ms, limit),
          }}
        />
      </span>
    </div>
  )
}

function colourFor(ms: number, limit: number): string {
  if (ms <= limit) return 'var(--confirm)'
  if (ms <= limit * 1.5) return 'var(--agent)'
  return 'var(--alert)'
}

const styles: Record<string, React.CSSProperties> = {
  rail: {
    display: 'flex',
    alignItems: 'center',
    gap: 22,
    padding: '0 22px',
    height: 46,
    borderTop: '1px solid var(--hairline)',
    background: 'var(--surface)',
  },
  stage: { display: 'flex', alignItems: 'center', gap: 8 },
  value: { fontSize: 12, minWidth: 44, textAlign: 'right' },
  unit: { fontSize: 9, color: 'var(--text-faint)', marginLeft: 2 },
  track: {
    display: 'block',
    width: 46,
    height: 2,
    background: 'var(--hairline-bright)',
    borderRadius: 99,
    overflow: 'hidden',
  },
  fill: { display: 'block', height: '100%', transition: 'width 240ms ease' },
  divider: { width: 1, height: 18, background: 'var(--hairline-bright)' },
  badge: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    border: '1px solid var(--confirm)',
    color: 'var(--confirm)',
    borderRadius: 3,
    padding: '2px 6px',
  },
  waiting: { fontSize: 11, color: 'var(--text-faint)' },
  spark: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 20 },
  sparkBar: { width: 3, borderRadius: 1, minHeight: 2, opacity: 0.8 },
}
