'use client'

const CHANNELS = [
  {
    id: 'browser',
    name: 'Browser',
    state: 'Live',
    live: true,
    copy: 'Speak to it now from this page. Same engine that runs the phone line.',
  },
  {
    id: 'phone',
    name: 'Phone line',
    state: 'Next',
    live: false,
    copy: 'Your existing number, forwarded. Answers on the first ring, hands off to reception when asked.',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    state: 'Next',
    live: false,
    copy: 'The same booking flow in text, for patients who would rather type than talk.',
  },
]

/**
 * One desk, three pipes.
 *
 * Three cards side by side said the channels existed and nothing about their
 * relationship — which is the actual claim in the heading above them. Drawing
 * the fan-out says it: one core, three lines, and only one of them carrying
 * anything today.
 *
 * The lines are the honest part. The live one flows; the two that are not built
 * yet are dashed and still, so the section cannot be mistaken for claiming
 * three working channels.
 */
export function Channels() {
  return (
    <div className="lp-ch">
      <div className="lp-ch-core" data-reveal>
        <span className="lp-ch-core-k">One conversation</span>
        <span className="lp-ch-core-v">the same diary, the same knowledge, the same rules</span>
      </div>

      {/* Decorative: the same relationship is carried by the copy and the
          Live/Next chips, so nothing here needs announcing. */}
      <svg className="lp-ch-fan" viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden>
        {[50, 150, 250].map((x, i) => (
          <path
            key={x}
            d={`M150 0 C150 34 ${x} 26 ${x} 60`}
            className={`lp-ch-path${CHANNELS[i]!.live ? ' is-live' : ''}`}
          />
        ))}
      </svg>

      <div className="lp-channels">
        {CHANNELS.map((c, i) => (
          <div
            key={c.id}
            className={`lp-channel${c.live ? ' is-live' : ''}`}
            data-reveal
            style={{ '--i': i } as React.CSSProperties}
          >
            <span className={`lp-channel-state ${c.live ? 'lp-state-live' : 'lp-state-next'}`}>
              {c.state}
            </span>
            <h4>{c.name}</h4>
            <p>{c.copy}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
