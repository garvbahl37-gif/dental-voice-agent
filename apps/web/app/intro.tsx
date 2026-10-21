'use client'

import { useEffect, useState } from 'react'
import { LoadingScreen } from './loading-screen'

/**
 * The opening.
 *
 * The landing page opens on the same screen the rest of the app loads on —
 * the orb, the wordmark, "hello" turning through the scripts — held for two
 * seconds and then opened out of the orb onto the page. One loading screen
 * for the whole product, so the first thing a visitor sees is the thing they
 * will see every time it opens.
 *
 * Three rules it keeps:
 *
 * It never blocks. The page behind it is fully rendered underneath; this is a
 * curtain, not a gate, and it lifts on a timer that cannot hang. A loading
 * screen that can trap someone is worse than none.
 *
 * It plays once. A curtain on every navigation is a toll, so a flag in
 * sessionStorage means a reader who came back from /console does not sit
 * through it again.
 *
 * It respects the request not to move: with reduced motion it never mounts.
 */

/** How long it holds before opening. */
const HOLD = 2100
/** How long the opening runs; matches the loading screen's own exit. */
const OPEN = 850

/**
 * Whether the curtain runs, decided once per page load.
 *
 * Held outside the component so React's development double-mount asks and
 * answers the same question both times — a check that writes state on the
 * first pass and reads it back on the second disagrees with itself, and the
 * curtain never appeared.
 */
let decision: boolean | null = null

function shouldPlay(): boolean {
  if (decision !== null) return decision
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    decision = false
    return decision
  }
  let seen = false
  try {
    seen = sessionStorage.getItem('vaani-intro') === 'seen'
  } catch {
    // Storage disabled. Play it; a second showing beats never showing.
  }
  decision = !seen
  return decision
}

export function Intro() {
  const [on, setOn] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (!shouldPlay()) return
    setOn(true)
    const lift = window.setTimeout(() => setLeaving(true), HOLD)
    const end = window.setTimeout(() => {
      setOn(false)
      // Marked as seen only once it has actually played. Writing the flag up
      // front meant React's development double-mount wrote it on the first
      // pass and then bailed on the second — after the remount had already
      // reset the state — so it never appeared at all.
      try {
        sessionStorage.setItem('vaani-intro', 'seen')
      } catch {
        /* private mode; showing it once more is the smaller failure */
      }
    }, HOLD + OPEN)
    return () => {
      window.clearTimeout(lift)
      window.clearTimeout(end)
    }
  }, [])

  // The page underneath must not scroll while the curtain is down, or a reader
  // arrives already halfway through it. It is free again as the curtain opens.
  useEffect(() => {
    if (!on || leaving) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [on, leaving])

  if (!on) return null
  return <LoadingScreen label="Answering in eleven languages" done={leaving} />
}
