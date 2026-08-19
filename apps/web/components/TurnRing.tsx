'use client'

import { useEffect, useRef } from 'react'
import type { AgentState } from '@vaani/shared'

/**
 * The turn ring — one channel, two parties negotiating it.
 *
 * A phone call is a single shared channel that two people take turns holding.
 * So the instrument is a single circle: the desk's arc sweeps clockwise from
 * twelve, the caller's counter-clockwise, and whoever holds the floor extends
 * and brightens while the other recedes.
 *
 * When the caller cuts in, their arc surges and a cut mark is left at the exact
 * point the desk's speech was truncated — the same position the transcript strikes
 * through. The mechanism is not illustrated; it is displayed.
 */

interface Props {
  state: AgentState
  micLevel: number
  agentLevel: number
  spectrum: (t: 'mic' | 'agent') => Uint8Array
  /** Fraction 0–1 of the agent's utterance that had played when cut off. */
  cutAt: number | null
  live: boolean
}

const CALLER = '#8b93ff'
const AGENT = '#ffb443'
const ALERT = '#ff5c4d'

export function TurnRing({ state, micLevel, agentLevel, spectrum, cutAt, live }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const raf = useRef<number>(0)

  // Read live values inside the render loop without re-subscribing every frame.
  const props = useRef({ state, micLevel, agentLevel, spectrum, cutAt, live })
  props.current = { state, micLevel, agentLevel, spectrum, cutAt, live }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Arcs ease toward their target rather than snapping, so the handover
    // between speakers reads as a physical transfer.
    let callerArc = 0.06
    let agentArc = 0.06
    let flare = 0
    let lastCut: number | null = null
    let t = 0

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
      const radius = size * 0.3

      t += reduced ? 0 : 0.016

      const agentSpeaking = p.state === 'speaking'
      const callerSpeaking = p.state === 'listening'

      // Targets: whoever holds the floor claims most of the circle.
      const callerTarget = callerSpeaking ? 0.34 + p.micLevel * 0.3 : 0.07
      const agentTarget = agentSpeaking ? 0.34 + p.agentLevel * 0.3 : 0.07
      callerArc += (callerTarget - callerArc) * 0.14
      agentArc += (agentTarget - agentArc) * 0.14

      if (p.cutAt !== null && p.cutAt !== lastCut) {
        flare = 1
        lastCut = p.cutAt
      }
      flare *= 0.94

      ctx.clearRect(0, 0, size, size)

      // ── Base channel ────────────────────────────────────────────────────
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = '#1e2531'
      ctx.lineWidth = 1
      ctx.stroke()

      if (!p.live) {
        // At rest, both arcs drift slowly in opposite directions around the
        // shared channel. It says what the instrument means — two parties,
        // one line — before a single word is spoken.
        const drift = t * 0.22
        const rest = 0.13
        drawArc(ctx, cx, cy, radius, drift, drift + rest * Math.PI * 2, AGENT, 1.5)
        drawArc(
          ctx,
          cx,
          cy,
          radius,
          -drift - rest * Math.PI * 2 + Math.PI,
          -drift + Math.PI,
          CALLER,
          1.5,
        )
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.13 * (1 + Math.sin(t * 1.1) * 0.06), 0, Math.PI * 2)
        ctx.fillStyle = '#2a3342'
        ctx.fill()
        raf.current = requestAnimationFrame(draw)
        return
      }

      // ── Spectra ─────────────────────────────────────────────────────────
      // Bars radiate outward from the ring, coloured by their own channel, so
      // both parties' energy is visible even while only one holds the floor.
      drawSpectrum(ctx, cx, cy, radius, p.spectrum('agent'), AGENT, -Math.PI / 2, 1, agentLevelOf(p))
      drawSpectrum(ctx, cx, cy, radius, p.spectrum('mic'), CALLER, -Math.PI / 2, -1, p.micLevel)

      // ── Arcs ────────────────────────────────────────────────────────────
      const top = -Math.PI / 2
      drawArc(ctx, cx, cy, radius, top, top + agentArc * Math.PI * 2, AGENT, agentSpeaking ? 3.5 : 2)
      drawArc(ctx, cx, cy, radius, top - callerArc * Math.PI * 2, top, CALLER, callerSpeaking ? 3.5 : 2)

      // ── Cut mark ────────────────────────────────────────────────────────
      // Where the caller's interruption stopped the desk mid-word. Sits at the
      // same fraction the transcript strikes through.
      if (flare > 0.02 && p.cutAt !== null) {
        const angle = top + p.cutAt * agentArc * Math.PI * 2
        ctx.save()
        ctx.globalAlpha = flare
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(angle) * (radius - 10), cy + Math.sin(angle) * (radius - 10))
        ctx.lineTo(cx + Math.cos(angle) * (radius + 10), cy + Math.sin(angle) * (radius + 10))
        ctx.strokeStyle = ALERT
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.restore()
      }

      // ── Breathing core ──────────────────────────────────────────────────
      const pulse = agentSpeaking
        ? 1 + p.agentLevel * 0.5
        : callerSpeaking
          ? 1 + p.micLevel * 0.3
          : 1 + Math.sin(t * 1.4) * 0.04

      const coreColour = agentSpeaking ? AGENT : callerSpeaking ? CALLER : '#2a3342'
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 0.13 * pulse, 0, Math.PI * 2)
      ctx.fillStyle = coreColour
      ctx.globalAlpha = agentSpeaking || callerSpeaking ? 0.9 : 0.5
      ctx.fill()
      ctx.globalAlpha = 1

      drawCentre(ctx, cx, cy + radius + 34, labelFor(p.state), coreColour)

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

function agentLevelOf(p: { agentLevel: number }): number {
  return p.agentLevel
}

function drawArc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  colour: string,
  width: number,
): void {
  ctx.beginPath()
  ctx.arc(cx, cy, r, from, to)
  ctx.strokeStyle = colour
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.shadowBlur = width > 3 ? 14 : 0
  ctx.shadowColor = colour
  ctx.stroke()
  ctx.shadowBlur = 0
}

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  data: Uint8Array,
  colour: string,
  origin: number,
  direction: 1 | -1,
  level: number,
): void {
  if (data.length === 0 || level < 0.01) return

  const bars = 44
  const step = Math.floor(data.length / bars) || 1
  ctx.save()
  ctx.globalAlpha = Math.min(1, 0.25 + level * 2)

  for (let i = 0; i < bars; i++) {
    const value = (data[i * step] ?? 0) / 255
    if (value < 0.02) continue
    const angle = origin + direction * (i / bars) * Math.PI * 0.92
    const inner = r + 5
    const outer = inner + value * r * 0.55

    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
    ctx.strokeStyle = colour
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  ctx.restore()
}

function drawCentre(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  colour: string,
): void {
  ctx.save()
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = colour
  ctx.textAlign = 'center'
  ctx.letterSpacing = '0.18em'
  ctx.fillText(text.toUpperCase(), cx, cy)
  ctx.restore()
}

function labelFor(state: AgentState): string {
  switch (state) {
    case 'listening':
      return 'caller speaking'
    case 'thinking':
      return 'thinking'
    case 'speaking':
      return 'priya speaking'
    case 'tool_running':
      return 'checking diary'
    default:
      return 'ready'
  }
}
