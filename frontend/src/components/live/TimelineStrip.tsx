import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { formatDay, formatHour, formatInt } from '@/lib/format'
import { ACTION_LABELS, ACTION_NAMES, readPalette } from '@/lib/palette'
import {
  binColumns,
  bucketAtX,
  bucketOfIndex,
  dayTicks,
  hourActionCounts,
  N_ACTIONS,
  timeToX,
  type HourBuckets,
} from '@/lib/timeline'
import { useRunStore } from '@/state/runStore'
import { useTheme } from '@/state/theme'
import { useViewStore } from '@/state/viewStore'
import { Swatch } from './ActionChip'

export interface TimeWindow {
  start: number
  end: number
  label: string
}

interface Props {
  buckets: HourBuckets
  bursts: TimeWindow[]
  /** ISO timestamps of rating change points (ruptures) */
  changePoints: string[]
}

const HOUR_MS = 3_600_000
const AXIS_PX = 16
/** top band for the peak and burst labels, so text never sits on bars */
const LABEL_PX = 14
const HEIGHT_CSS = 96
/** stacking order, bottom to top: settled actions first, pending on top */
const STACK = [1, 2, 3, 4, 0] as const

export function TimelineStrip({ buckets, bursts, changePoints }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const perHourRef = useRef<Uint32Array | undefined>(undefined)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<{ x: number; bucket: number; counts: Uint32Array | null } | null>(null)
  const theme = useTheme((s) => s.theme)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => setWidth(Math.floor(wrap.getBoundingClientRect().width)))
    ro.observe(wrap)
    setWidth(Math.floor(wrap.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || width <= 0) return
    const dpr = window.devicePixelRatio || 1
    const W = Math.floor(width * dpr)
    const H = Math.floor(HEIGHT_CSS * dpr)
    canvas.width = W
    canvas.height = H
    canvas.style.width = `${width}px`
    canvas.style.height = `${HEIGHT_CSS}px`
    const palette = readPalette()
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--instrument-ink').trim() || '#8d97a5'
    const line = css.getPropertyValue('--instrument-line').trim() || '#232a33'
    let frame: number | null = null

    const draw = () => {
      frame = null
      const grid = useRunStore.getState().grid
      perHourRef.current = hourActionCounts(buckets, grid.actions, perHourRef.current)
      const { columns, max } = binColumns(buckets, perHourRef.current, W)
      const plotH = H - AXIS_PX * dpr
      const top = LABEL_PX * dpr
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = palette.surfaceHex
      ctx.fillRect(0, 0, W, H)

      // Burst windows behind the bars.
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      for (const b of bursts) {
        const x0 = timeToX(buckets, b.start, W)
        const x1 = Math.max(x0 + dpr, timeToX(buckets, b.end, W))
        ctx.fillRect(x0, top, x1 - x0, plotH - top)
        ctx.fillStyle = ink
        ctx.fillRect(x0, top, x1 - x0, Math.max(1, dpr))
        ctx.fillStyle = 'rgba(255,255,255,0.07)'
      }

      // Stacked bars, one per device-pixel column.
      if (max > 0) {
        const scale = (plotH - top - 2 * dpr) / max
        for (let c = 0; c < W; c++) {
          let y = plotH
          for (const a of STACK) {
            const v = columns[c * N_ACTIONS + a]
            if (!v) continue
            const h = v * scale
            ctx.fillStyle = palette.hex[a]
            ctx.fillRect(c, y - h, 1, h)
            y -= h
          }
        }
      }

      // Change points: dashed rules.
      ctx.strokeStyle = ink
      ctx.lineWidth = dpr
      ctx.setLineDash([3 * dpr, 3 * dpr])
      for (const cp of changePoints) {
        const x = Math.round(timeToX(buckets, Date.parse(cp), W)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, plotH)
        ctx.stroke()
      }
      ctx.setLineDash([])

      // Baseline + day ticks.
      ctx.fillStyle = line
      ctx.fillRect(0, plotH, W, dpr)
      ctx.fillStyle = ink
      ctx.font = `${10 * dpr}px "Geist Variable", sans-serif`
      ctx.textBaseline = 'top'
      const ticks = dayTicks(buckets, Math.max(2, Math.floor(width / 90)))
      for (const t of ticks) {
        const x = timeToX(buckets, t, W)
        ctx.fillRect(Math.round(x), plotH, dpr, 3 * dpr)
        const label = formatDay(new Date(t))
        const tw = ctx.measureText(label).width
        ctx.fillText(label, Math.min(Math.max(0, x - tw / 2), W - tw), plotH + 4 * dpr)
      }

      // Peak label (reviews per hour), and burst captions.
      const hoursPerCol = Math.max(1, (buckets.t1 - buckets.t0) / HOUR_MS / W)
      ctx.textBaseline = 'top'
      ctx.fillText(`peak ${formatInt(max / hoursPerCol)}/h`, 4 * dpr, 2 * dpr)
      // Adjacent bursts would overprint each other's label; label the first of each group.
      let labelEnd = ctx.measureText(`peak ${formatInt(max / hoursPerCol)}/h`).width + 12 * dpr
      for (const b of [...bursts].sort((p, q) => p.start - q.start)) {
        const w = ctx.measureText(b.label).width
        const x = Math.min(timeToX(buckets, b.start, W), W - w)
        if (x < labelEnd) continue
        ctx.fillText(b.label, x, 2 * dpr)
        labelEnd = x + w + 8 * dpr
      }

      // The hour of the hovered / selected grid cell.
      const v = useViewStore.getState()
      for (const [i, alpha] of [
        [v.selected, 1],
        [v.hovered, 0.7],
      ] as const) {
        if (i == null) continue
        const h = bucketOfIndex(buckets, i)
        if (h < 0) continue
        const x = Math.round(timeToX(buckets, buckets.ms[h] + HOUR_MS / 2, W))
        ctx.fillStyle = `rgba(255,255,255,${alpha})`
        ctx.fillRect(x - dpr, top, 2 * dpr, plotH - top)
      }
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(draw)
    }
    const unsubRun = useRunStore.subscribe((s, p) => {
      if (s.gridVersion !== p.gridVersion) schedule()
    })
    const unsubView = useViewStore.subscribe((s, p) => {
      if (s.hovered !== p.hovered || s.selected !== p.selected) schedule()
    })
    schedule()
    return () => {
      unsubRun()
      unsubView()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [buckets, bursts, changePoints, width, theme])

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left
    const bucket = bucketAtX(buckets, x, width)
    const per = perHourRef.current
    const counts = bucket >= 0 && per ? per.slice(bucket * N_ACTIONS, (bucket + 1) * N_ACTIONS) : null
    setHover(bucket >= 0 ? { x, bucket, counts } : null)
    useViewStore
      .getState()
      .setHoverRange(bucket >= 0 ? { start: buckets.starts[bucket], end: buckets.starts[bucket] + buckets.counts[bucket] } : null)
  }
  const onLeave = () => {
    setHover(null)
    useViewStore.getState().setHoverRange(null)
  }

  const counts = hover?.counts ?? null

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Hourly review volume stacked by action${bursts.length ? `, ${bursts.length} burst window${bursts.length > 1 ? 's' : ''} shaded` : ''}`}
        className="block cursor-crosshair rounded-md"
        onPointerMove={onMove}
        onPointerLeave={onLeave}
      />
      {hover && counts && (
        <div
          className="pointer-events-none absolute bottom-full z-20 mb-2 w-52 rounded-md border border-border bg-popover p-2.5 text-popover-foreground shadow-lg"
          style={{ left: Math.min(Math.max(0, hover.x - 104), Math.max(0, width - 208)) }}
        >
          <div className="num text-[11px] text-muted-foreground">{formatHour(new Date(buckets.ms[hover.bucket]))}</div>
          <div className="num mt-1 text-sm font-semibold">{formatInt(buckets.counts[hover.bucket])} reviews</div>
          <ul className="mt-1.5 space-y-0.5">
            {STACK.map((a) =>
              counts[a] ? (
                <li key={a} className="num flex items-center gap-1.5 text-[12px]">
                  <Swatch action={ACTION_NAMES[a]} />
                  <span className="text-muted-foreground">{ACTION_LABELS[ACTION_NAMES[a]]}</span>
                  <span className="ml-auto">{formatInt(counts[a])}</span>
                </li>
              ) : null,
            )}
          </ul>
          <div className="mt-1.5 text-[11px] text-muted-foreground">Lit up in the grid</div>
        </div>
      )}
    </div>
  )
}
