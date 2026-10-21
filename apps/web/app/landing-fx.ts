'use client'

import { useEffect } from 'react'

/**
 * The landing page's pointer and scroll motion.
 *
 * Three effects, each written as CSS custom properties so the stylesheet
 * decides what moves and by how much:
 *
 * - `--mx`, `--my` on the hero: where the pointer is, from -1 to 1, so each
 *   layer of the painted scene can drift by its own depth.
 * - `--hero` on the hero and `--drop` on the product panel: how far each has
 *   been scrolled through, from 0 to 1, so the scene sinks, the call card
 *   lifts and the line to the record draws as the reader moves.
 * - `rotate` on anything marked `data-tilt`: a small turn toward the pointer.
 *   The individual `rotate` property composes with the cards' own `transform`
 *   animations instead of overwriting them. `--gx`, `--gy` on the same card
 *   say where on it the pointer is, for a light that follows it.
 *
 * Pointer effects run only for a fine pointer — a finger has no hover, and a
 * card that tilts under a scrolling thumb is a card that wobbles. Nothing runs
 * for anyone who asked for less motion. One animation frame per burst of
 * events, however many arrive.
 */
export function useLandingFx(): void {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fine = window.matchMedia('(pointer: fine)').matches

    const hero = document.querySelector<HTMLElement>('.mo-hero')
    const panel = document.querySelector<HTMLElement>('.mo-panel-wrap')
    const nav = document.querySelector<HTMLElement>('.mo-nav')

    /**
     * Loops pause where nobody can see them.
     *
     * Clouds drift, cards float, pills bob and the marquee runs — a hundred or
     * so animations, every one of them costing frames while scrolled out of
     * view. Each section's loops run only while the section is on screen.
     */
    const sections = [
      ...document.querySelectorAll<HTMLElement>(
        '.mo-hero, .mo-langs, .hw-stage, .mo-needs, .mo-voices, .mo-close, .mo-word',
      ),
    ]
    const live = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.classList.toggle('is-paused', !e.isIntersecting)
      },
      { rootMargin: '120px 0px' },
    )
    for (const s of sections) live.observe(s)

    let frame = 0
    let px = 0
    let py = 0

    const update = () => {
      frame = 0
      const vh = window.innerHeight
      if (hero) {
        const r = hero.getBoundingClientRect()
        const scrolled = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height)))
        hero.style.setProperty('--hero', scrolled.toFixed(3))
        if (fine) {
          hero.style.setProperty('--mx', px.toFixed(3))
          hero.style.setProperty('--my', py.toFixed(3))
        }
      }
      if (panel) {
        // Starts drawing as the panel's top enters the lower third of the
        // screen, finishes by the time it reaches the middle.
        const r = panel.getBoundingClientRect()
        const t = Math.min(1, Math.max(0, (vh * 0.95 - r.top) / (vh * 0.45)))
        panel.style.setProperty('--drop', t.toFixed(3))
      }
      if (nav) {
        // How far down the page the reader is, for the line under the bar.
        const max = document.documentElement.scrollHeight - vh
        nav.style.setProperty('--progress', max > 0 ? (window.scrollY / max).toFixed(4) : '0')
      }
    }

    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const onPointer = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth) * 2 - 1
      py = (e.clientY / window.innerHeight) * 2 - 1
      queue()
    }

    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', queue)
    if (fine) window.addEventListener('pointermove', onPointer, { passive: true })
    update()

    // Tilt: each marked card turns a few degrees toward the pointer.
    const cards = fine ? [...document.querySelectorAll<HTMLElement>('[data-tilt]')] : []
    const leave = new Map<HTMLElement, () => void>()
    const move = new Map<HTMLElement, (e: PointerEvent) => void>()
    for (const el of cards) {
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const dx = ((e.clientX - r.left) / r.width) * 2 - 1
        const dy = ((e.clientY - r.top) / r.height) * 2 - 1
        const angle = Math.min(1, Math.hypot(dx, dy)) * 6
        el.style.rotate = `${(-dy).toFixed(3)} ${dx.toFixed(3)} 0 ${angle.toFixed(2)}deg`
        // Where the pointer is on the card, for the light that follows it.
        el.style.setProperty('--gx', `${(((dx + 1) / 2) * 100).toFixed(1)}%`)
        el.style.setProperty('--gy', `${(((dy + 1) / 2) * 100).toFixed(1)}%`)
      }
      const onLeave = () => {
        el.style.rotate = ''
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerleave', onLeave)
      move.set(el, onMove)
      leave.set(el, onLeave)
    }

    return () => {
      live.disconnect()
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', queue)
      window.removeEventListener('resize', queue)
      window.removeEventListener('pointermove', onPointer)
      for (const el of cards) {
        el.removeEventListener('pointermove', move.get(el)!)
        el.removeEventListener('pointerleave', leave.get(el)!)
      }
    }
  }, [])
}
