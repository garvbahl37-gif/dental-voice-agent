/**
 * What a page looks like while it is still arriving.
 *
 * A box reading "Loading…" tells you nothing, occupies the wrong shape, and is
 * replaced by something a different size — so the page jumps at the exact
 * moment the reader started looking at it. These stand in the shape of what is
 * coming, which makes the wait read as the page assembling rather than as the
 * page being broken.
 *
 * Marked `aria-hidden` with a live region alongside: a screen reader should
 * hear "loading" once, not a description of twelve grey rectangles.
 */

export function Skeleton({ w, h, r }: { w?: string; h?: number; r?: number }) {
  return (
    <span
      className="sk"
      aria-hidden
      style={{ width: w ?? '100%', height: h ?? 14, borderRadius: r ?? 6 }}
    />
  )
}

/** The dashboard: a header, a band of tiles, and the calls table. */
export function DashboardSkeleton() {
  return (
    <>
      <span className="sr-only" role="status">
        Loading the dashboard
      </span>

      <header className="db-head" aria-hidden>
        <div>
          <Skeleton w="90px" h={11} />
          <div style={{ height: 10 }} />
          <Skeleton w="220px" h={30} r={8} />
        </div>
      </header>

      <section className="db-section" aria-hidden>
        <Skeleton w="150px" h={18} r={6} />
        <div className="db-tiles" style={{ marginTop: 18 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="sk-tile">
              <Skeleton w="54px" h={26} r={7} />
              <div style={{ height: 9 }} />
              <Skeleton w="76%" h={10} />
            </div>
          ))}
        </div>
      </section>

      <section className="db-section" aria-hidden>
        <Skeleton w="120px" h={18} r={6} />
        <div className="sk-rows">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="sk-row">
              <Skeleton w="130px" h={12} />
              <Skeleton w="90px" h={12} />
              <Skeleton w="60px" h={12} />
              <Skeleton w="70px" h={12} />
            </div>
          ))}
        </div>
      </section>
    </>
  )
}

/** One call, opening: the facts, then the turns of a conversation. */
export function CallSkeleton() {
  return (
    <>
      <span className="sr-only" role="status">
        Opening the call
      </span>
      <div className="cv-facts" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="sk-fact">
            <Skeleton w="42px" h={9} />
            <div style={{ height: 7 }} />
            <Skeleton w="62px" h={13} />
          </div>
        ))}
      </div>
      <div className="sk-thread" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className={`sk-turn${i % 2 ? ' is-right' : ''}`}>
            <Skeleton w={i % 2 ? '58%' : '72%'} h={38} r={13} />
          </div>
        ))}
      </div>
    </>
  )
}

/** A list of things — imported sources, and anything else shaped like them. */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="sk-rows" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="sk-list-row">
            <Skeleton w="46%" h={15} r={6} />
            <div style={{ height: 8 }} />
            <Skeleton w="72%" h={11} />
          </div>
        ))}
      </div>
    </>
  )
}
