'use client'

import { useEffect, useRef } from 'react'
import type { AgentState } from '@vaani/shared'

/**
 * The speaking blob.
 *
 * Three translucent lobes, each a closed cardinal spline whose radius is
 * displaced by value noise and by live FFT energy. They counter-rotate at
 * different speeds, so the silhouette never repeats and reads as liquid rather
 * than as a pulsing circle.
 *
 * The colour rule from the rest of the console holds: the lobes take the desk's
 * turmeric while she speaks and the caller's slate blue while they do, so the
 * shape says who has the floor before any label is read.
 */

interface Props {
  state: AgentState
  micLevel: number
  agentLevel: number
  spectrum: (t: 'mic' | 'agent') => Uint8Array
  live: boolean
}

const AGENT = { r: 184, g: 115, b: 10 }
const CALLER = { r: 47, g: 75, b: 124 }
/**
 * Warm even at rest. A grey resting state reads as a device that is switched
 * off; a soft ember reads as someone waiting to speak — which is what she is.
 */
const RESTING = { r: 205, g: 152, b: 72 }

const POINTS = 96
const LOBES = [
  { scale: 1.0, speed: 0.16, wobble: 0.16, alpha: 0.72, phase: 0 },
  { scale: 0.88, speed: -0.22, wobble: 0.2, alpha: 0.55, phase: 2.1 },
  { scale: 0.74, speed: 0.3, wobble: 0.26, alpha: 0.42, phase: 4.3 },
]

/** Cheap deterministic value noise — no dependency, stable across frames. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

function smoothNoise(angle: number, t: number, seed: number): number {
  const a = angle * 1.7 + seed
  return (
    Math.sin(a + t) * 0.5 +
    Math.sin(a * 2.3 - t * 1.3) * 0.28 +
    Math.sin(a * 3.7 + t * 0.7) * 0.14 +
    (noise(Math.floor(a * 2), seed) - 0.5) * 0.1
  )
}

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
    let t = 0
    let energy = 0
    let hue = { ...RESTING }

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

    const draw = () => {
      const p = props.current
      const size = canvas.clientWidth
      const cx = size / 2
      const cy = size / 2
      const base = size * 0.24

      if (!reduced) t += 0.01

      const speaking = p.state === 'speaking'
      const listening = p.state === 'listening'
      const working = p.state === 'thinking' || p.state === 'tool_running'

      // Ease both energy and colour so handovers feel physical, not switched.
      const target = speaking ? p.agentLevel : listening ? p.micLevel : working ? 0.22 : 0.05
      energy += (target - energy) * 0.12

      const want = speaking ? AGENT : listening ? CALLER : RESTING
      hue = {
        r: hue.r + (want.r - hue.r) * 0.06,
        g: hue.g + (want.g - hue.g) * 0.06,
        b: hue.b + (want.b - hue.b) * 0.06,
      }

      const fft = p.live ? p.spectrum(speaking ? 'agent' : 'mic') : new Uint8Array(0)

      ctx.clearRect(0, 0, size, size)

      for (let l = 0; l < LOBES.length; l++) {
        const lobe = LOBES[l]!
        const pts: [number, number][] = []

        for (let i = 0; i < POINTS; i++) {
          const angle = (i / POINTS) * Math.PI * 2
          const wobble = smoothNoise(angle, t * lobe.speed * 6, lobe.phase) * lobe.wobble

          // Map the spectrum around the circumference so the shape responds to
          // timbre, not just loudness — that is what stops it looking like a
          // metronome.
          const bin = fft.length > 0 ? (fft[Math.floor((i / POINTS) * fft.length)] ?? 0) / 255 : 0

          const r = base * lobe.scale * (1 + wobble * (0.5 + energy) + bin * energy * 0.55)
          pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r])
        }

        ctx.beginPath()
        ctx.moveTo(...(pts[0] as [number, number]))
        // Closed Catmull-Rom, rendered as quadratics through midpoints.
        for (let i = 0; i < POINTS; i++) {
          const cur = pts[i]!
          const next = pts[(i + 1) % POINTS]!
          ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2)
        }
        ctx.closePath()

        const grad = ctx.createRadialGradient(cx, cy - base * 0.3, base * 0.1, cx, cy, base * 1.5)
        const a = lobe.alpha * (0.7 + energy * 0.4)
        grad.addColorStop(0, `rgba(${hue.r | 0}, ${hue.g | 0}, ${hue.b | 0}, ${a})`)
        grad.addColorStop(1, `rgba(${hue.r | 0}, ${hue.g | 0}, ${hue.b | 0}, ${a * 0.25})`)
        ctx.fillStyle = grad
        ctx.fill()
      }

      // Radiating spokes — one per spectrum bin, so the corona *is* the voice's
      // timbre rather than decoration around it. Length tracks that band's
      // energy; the whole corona fades out when nobody is speaking.
      const spokes = 72
      const coronaAlpha = Math.min(0.9, 0.34 + energy * 1.5)
      if (coronaAlpha > 0.1) {
        ctx.save()
        ctx.lineCap = 'round'
        for (let i = 0; i < spokes; i++) {
          const angle = (i / spokes) * Math.PI * 2 - Math.PI / 2
          const bin = fft.length > 0 ? (fft[Math.floor((i / spokes) * fft.length)] ?? 0) / 255 : 0
          const drift = smoothNoise(angle, t * 0.9, 7) * 0.5 + 0.5

          const inner = base * 1.06
          const outer = inner + base * (0.2 + bin * 0.95 + drift * 0.16 * (0.3 + energy))
          if (outer - inner < 2) continue

          ctx.beginPath()
          ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
          ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
          ctx.strokeStyle = `rgba(${hue.r | 0}, ${hue.g | 0}, ${hue.b | 0}, ${
            coronaAlpha * (0.35 + bin * 0.65)
          })`
          ctx.lineWidth = 1.6
          ctx.stroke()
        }
        ctx.restore()
      }

      // A soft specular highlight gives the mass a surface rather than leaving
      // it a flat silhouette.
      const spec = ctx.createRadialGradient(
        cx - base * 0.3,
        cy - base * 0.45,
        0,
        cx - base * 0.3,
        cy - base * 0.45,
        base * 0.85,
      )
      spec.addColorStop(0, 'rgba(255,255,255,0.32)')
      spec.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spec
      ctx.beginPath()
      ctx.arc(cx, cy, base * 1.1, 0, Math.PI * 2)
      ctx.fill()

      raf.current = requestAnimationFrame(draw)
    }

    raf.current = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf.current)
      observer.disconnect()
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
