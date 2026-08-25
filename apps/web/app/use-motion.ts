'use client'

import { useEffect } from 'react'

/**
 * The page's motion layer.
 *
 * Two rules shape this. Nothing is hidden until JavaScript says it can be:
 * the hiding styles hang off a `lp-motion` class this sets on the document, so
 * a reader without JS — or a crawler — gets the finished page rather than a
 * blank one. And nothing moves for someone who asked it not to; the query is
 * checked here as well as in CSS, because an observer that never fires is
 * cheaper than one that fires into a disabled transition.
 */
export function useMotion(): void {
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const root = document.documentElement
    if (still.matches) return

    root.classList.add('lp-motion')

    const show = (el: Element) => {
      el.classList.add('is-in')
      io.unobserve(el)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          /**
           * Intersecting, or already gone past.
           *
           * A reader who flings the scrollbar — or lands on an anchor — moves
           * whole sections between frames, and an observer never sees those
           * intersect. Without the second test they stayed hidden for the rest
           * of the visit, which is a worse page than one with no motion at all.
           */
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) show(entry.target)
        }
      },
      // Slightly inside the fold, so a section is already settled by the time
      // it is properly in view rather than animating under the reader's eye.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
    )

    const watch = () => {
      for (const el of document.querySelectorAll('[data-reveal]:not(.is-in)')) io.observe(el)
    }
    watch()

    /**
     * The backstop.
     *
     * Anything at or above the top of the viewport has been read past and must
     * be visible, whatever the observer did or did not see. Runs on a frame so
     * a fast scroll costs one pass, not one per event.
     */
    let queued = false
    const sweep = () => {
      queued = false
      for (const el of document.querySelectorAll('[data-reveal]:not(.is-in)')) {
        if (el.getBoundingClientRect().top < 0) show(el)
      }
    }
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(sweep)
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    // Sections mount as the hero call plays out, so the set is not fixed.
    const mo = new MutationObserver(watch)
    mo.observe(document.body, { childList: true, subtree: true })

    return () => {
      window.removeEventListener('scroll', onScroll)
      io.disconnect()
      mo.disconnect()
      root.classList.remove('lp-motion')
    }
  }, [])
}

/**
 * Count up to a number when it comes into view.
 *
 * The ledger's figures are the page's one place where a number is the claim,
 * so they arrive by counting rather than by appearing — the same reason a
 * scoreboard rolls. Returns nothing and writes to the node directly: this runs
 * per frame, and putting it through React state would re-render the page sixty
 * times a second to change four characters.
 */
export function useCountUp(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          io.unobserve(el)

          const target = Number(el.dataset.count ?? el.textContent ?? 0)
          if (!Number.isFinite(target) || target === 0) continue

          const started = performance.now()
          const run = (now: number) => {
            const t = Math.min(1, (now - started) / 900)
            // Ease out: fast to nearly-there, then settles — a number that
            // decelerates reads as counting, one that is linear reads as a timer.
            const eased = 1 - Math.pow(1 - t, 3)
            el.textContent = String(Math.round(target * eased))
            if (t < 1) requestAnimationFrame(run)
          }
          el.textContent = '0'
          requestAnimationFrame(run)
        }
      },
      { threshold: 0.6 },
    )

    for (const el of document.querySelectorAll('[data-count]')) io.observe(el)
    return () => io.disconnect()
  }, [])
}
