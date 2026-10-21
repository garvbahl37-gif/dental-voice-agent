'use client'

import { useEffect, useRef } from 'react'
import type { AgentState } from '@vaani/shared'

/**
 * The voice orb.
 *
 * Its motion is Lalit's "Orb AI Motion" for theosm, studied frame by frame:
 * a near-white membrane whose colour moves as soft bands sweeping across the
 * surface, a crisp crease that surfaces now and then and dissolves, a rim
 * whose bright glint travels around the edge, and a silhouette that breathes
 * rather than holding a perfect circle — one slow cycle about every fifteen
 * seconds. The colours are Momo's: mint and green glass with a pale aqua.
 *
 * It is driven by the call, not by a clock alone. The live level swells the
 * bands and the wobble, the spectrum ripples the edge, and the colour rule
 * from the rest of the console holds: the bands lean to the desk's green while
 * she speaks and to the caller's sky blue while they do, so the orb says who
 * has the floor before any label is read.
 */

interface Props {
  state: AgentState
  micLevel: number
  agentLevel: number
  spectrum: (t: 'mic' | 'agent') => Uint8Array
  live: boolean
}

type RGB = { r: number; g: number; b: number }

const AGENT: RGB = { r: 45, g: 189, b: 95 }
const CALLER: RGB = { r: 74, g: 150, b: 196 }
/** Mint at rest, so an idle line still looks lit. */
const RESTING: RGB = { r: 112, g: 196, b: 150 }
/** The second band and the rim's glint: where the reference has amber. */
const GLINT: RGB = { r: 120, g: 212, b: 200 }

/** One full cycle of the reference, in seconds. */
const CYCLE = 15
const TAU = Math.PI * 2

/**
 * The folds. Each is a plane cutting the sphere off-centre: the cap beyond it
 * takes a soft wash of colour, and the curve where it meets the membrane shows
 * as a crisp crease only while the plane is nearly edge-on to the viewer. The
 * planes wander around the sphere and in and out from its centre at their own
 * rates, so one side warms, then another, as in the reference.
 */
const FOLDS = [
  { turn: 1, reach: 2, tilt: 3, phase: 0, band: 1, glint: false },
  { turn: -1, reach: 3, tilt: 2, phase: 2.3, band: 0.85, glint: true },
  { turn: 2, reach: 1, tilt: 5, phase: 4.6, band: 0.45, glint: false },
]
const POINTS = 96

const rgba = (c: RGB, a: number) =>
  `rgba(${c.r | 0}, ${c.g | 0}, ${c.b | 0}, ${Math.max(0, Math.min(1, a))})`

export function VoiceBlob({ state, micLevel, agentLevel, spectrum, live }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)
  const props = useRef({ state, micLevel, agentLevel, spectrum, live })
  props.current = { state, micLevel, agentLevel, spectrum, live }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let energy = 0
    let hue: RGB = { ...RESTING }
    // Time runs a little faster when there is a voice; accumulated rather than
    // read from the clock so a change of pace never jumps the shape.
    let clock = Math.random() * CYCLE
    let last = performance.now()

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const size = canvas.clientWidth
      canvas.width = size * dpr
      canvas.height = size * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    /**
     * Only drawn while it can be seen.
     *
     * A landing page carries three of these and the console one; drawing them
     * all every frame, scrolled out of view or in a background tab, is the
     * work that turned scrolling ragged on a slower phone. The loop stops and
     * starts again from where the clock left off.
     */
    let visible = true
    let running = false
    const start = () => {
      if (running || !visible || document.hidden) return
      running = true
      last = performance.now()
      raf.current = requestAnimationFrame(draw)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf.current)
    }
    const seen = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting)
      if (visible) start()
      else stop()
    })
    seen.observe(canvas)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)

    const draw = (now: number) => {
      if (!running) return
      const p = props.current
      const size = canvas.clientWidth
      const cx = size / 2
      const cy = size / 2
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now

      const speaking = p.state === 'speaking'
      const listening = p.state === 'listening'
      const working = p.state === 'thinking' || p.state === 'tool_running'

      // Ease energy and colour so a handover feels physical, not switched.
      const target = speaking ? p.agentLevel : listening ? p.micLevel : working ? 0.2 : 0.04
      energy += (target - energy) * 0.12

      const want = speaking ? AGENT : listening ? CALLER : RESTING
      hue = {
        r: hue.r + (want.r - hue.r) * 0.05,
        g: hue.g + (want.g - hue.g) * 0.05,
        b: hue.b + (want.b - hue.b) * 0.05,
      }

      if (!reduced) clock += dt * (1 + energy * 1.6 + (working ? 0.5 : 0))
      const ph = (clock / CYCLE) * TAU

      const fft = p.live ? p.spectrum(speaking ? 'agent' : 'mic') : new Uint8Array(0)
      const R = size * 0.32

      /** The membrane's edge at angle a: breathing slowly, rippling with a voice. */
      const edge = (a: number) => {
        const bin = fft.length > 0 ? (fft[Math.floor(((a / TAU + 1) % 1) * fft.length)] ?? 0) / 255 : 0
        const breathe = 0.011 * Math.sin(3 * a + ph * 2) + 0.007 * Math.sin(5 * a - ph * 3)
        return R * (1 + breathe * (1 + energy * 3) + bin * energy * 0.05)
      }

      const membrane = new Path2D()
      for (let i = 0; i <= POINTS; i++) {
        const a = (i / POINTS) * TAU
        const r = edge(a)
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) membrane.moveTo(x, y)
        else membrane.lineTo(x, y)
      }
      membrane.closePath()

      ctx.clearRect(0, 0, size, size)

      // ── The halo: the light the sphere throws on the page.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.55)
      halo.addColorStop(0, rgba(hue, 0.14 + energy * 0.35))
      halo.addColorStop(1, rgba(hue, 0))
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, size, size)

      // ── The body: near-white, faintly tinted toward the edge.
      const body = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.05, cx, cy, R * 1.02)
      body.addColorStop(0, 'rgba(255, 255, 255, 1)')
      body.addColorStop(0.6, 'rgba(250, 255, 252, 0.98)')
      body.addColorStop(0.9, rgba({ r: 226, g: 246, b: 234 }, 0.97))
      body.addColorStop(1, rgba({ r: 205, g: 236, b: 218 }, 0.97))
      ctx.fillStyle = body
      ctx.fill(membrane)

      ctx.save()
      ctx.clip(membrane)

      for (let k = 0; k < FOLDS.length; k++) {
        const f = FOLDS[k]!
        // Which way the cut faces, and how far from the centre it sits.
        const theta = ph * f.turn + f.phase
        const ux = Math.cos(theta)
        const uy = Math.sin(theta)
        const d = R * (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(ph * f.reach + f.phase * 1.7)))
        const tint = f.glint ? GLINT : hue

        // The cap's wash: clear on the near side of the cut, strongest just
        // past it, easing toward the membrane — a soft side of colour.
        const strength = (0.4 + energy * 0.3) * f.band
        const wash = ctx.createLinearGradient(
          cx + ux * (d - R * 0.42),
          cy + uy * (d - R * 0.42),
          cx + ux * R,
          cy + uy * R,
        )
        wash.addColorStop(0, rgba(tint, 0))
        wash.addColorStop(0.45, rgba(tint, strength * 0.55))
        wash.addColorStop(0.7, rgba(tint, strength))
        wash.addColorStop(1, rgba(tint, strength * 0.6))
        ctx.fillStyle = wash
        ctx.fill(membrane)

        // The crease: the circle where the plane meets the sphere, seen at a
        // tilt, so an ellipse whose far half curves along the cap. It shows
        // only while the plane is nearly edge-on, then dissolves.
        const open = Math.sin(ph * f.tilt + f.phase)
        const crease = Math.pow(Math.max(0, 1 - Math.abs(open) * 2.6), 2)
        if (crease > 0.02) {
          const rc = Math.sqrt(Math.max(0, R * R - d * d))
          const ex = cx + ux * d
          const ey = cy + uy * d
          ctx.beginPath()
          // Never quite edge-on: the reference's creases are always curved,
          // a lens rather than a ruled line.
          ctx.ellipse(ex, ey, rc * (0.22 + 0.3 * Math.abs(open)), rc * 1.02, theta, -Math.PI / 2, Math.PI / 2)
          ctx.lineWidth = 1.4
          ctx.strokeStyle = rgba(tint, crease * (0.6 + energy * 0.35))
          ctx.stroke()
        }
      }

      // The inner edge: colour gathering where the membrane turns away.
      const inner = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R * 1.04)
      inner.addColorStop(0, 'rgba(255,255,255,0)')
      inner.addColorStop(1, rgba(hue, 0.22 + energy * 0.25))
      ctx.fillStyle = inner
      ctx.fill(membrane)
      ctx.restore()

      // ── The rim, with a glint that travels around it.
      const glintAt = ph * 1.5
      const rim =
        'createConicGradient' in ctx
          ? ctx.createConicGradient(glintAt, cx, cy)
          : (ctx as CanvasRenderingContext2D).createLinearGradient(cx - R, cy - R, cx + R, cy + R)
      rim.addColorStop(0, rgba(GLINT, 0.95))
      rim.addColorStop(0.12, rgba(hue, 0.85))
      rim.addColorStop(0.35, rgba(hue, 0.35))
      rim.addColorStop(0.6, rgba({ r: 225, g: 245, b: 234 }, 0.3))
      rim.addColorStop(0.85, rgba(hue, 0.5))
      rim.addColorStop(1, rgba(GLINT, 0.95))
      ctx.strokeStyle = rim
      ctx.lineWidth = 1.6 + energy * 2.4
      ctx.stroke(membrane)

      // ── A soft highlight, top left, so the glass has a surface.
      const spec = ctx.createRadialGradient(cx - R * 0.36, cy - R * 0.42, 0, cx - R * 0.36, cy - R * 0.42, R * 0.62)
      spec.addColorStop(0, 'rgba(255,255,255,0.7)')
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spec
      ctx.fill(membrane)

      raf.current = requestAnimationFrame(draw)
    }

    start()
    return () => {
      stop()
      observer.disconnect()
      seen.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', aspectRatio: '1', display: 'block' }}
      aria-hidden="true"
    />
  )
}
