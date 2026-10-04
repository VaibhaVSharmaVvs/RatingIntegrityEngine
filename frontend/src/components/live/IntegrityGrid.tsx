import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cellOrigin, fitGrid, indexAt, rangeRects, stepIndex, type GridLayout } from '@/lib/gridLayout'
import { FADE_MS, paintAll, paintCells, type PaintContext } from '@/lib/gridPaint'
import { buildPalette, readPalette } from '@/lib/palette'
import { steamHex } from '@/lib/steamLens'
import type { HourBuckets } from '@/lib/timeline'
import { useRunStore } from '@/state/runStore'
import { useTheme } from '@/state/theme'
import { useViewStore, type GridLens } from '@/state/viewStore'
import { GridTooltip } from './GridTooltip'

interface Props {
  n: number
  runId: string
  ratingScale: string
  buckets: HourBuckets | null
  /** dev instrumentation: called with the paint+composite time of each frame (ms) */
  onFrame?: (ms: number) => void
}

interface Surface {
  layout: GridLayout
  bitmap: HTMLCanvasElement
  bitmapCtx: CanvasRenderingContext2D
  image: ImageData
  paint: PaintContext
  gaps: HTMLCanvasElement | null
  animating: number[]
  full: boolean
}

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function makeGapOverlay(l: GridLayout, colour: string): HTMLCanvasElement | null {
  if (l.gapPx === 0) return null
  const c = document.createElement('canvas')
  c.width = l.width
  c.height = l.height
  const g = c.getContext('2d')!
  g.fillStyle = colour
  for (let x = l.cellPx - l.gapPx; x < l.width; x += l.cellPx) g.fillRect(x, 0, l.gapPx, l.height)
  for (let y = l.cellPx - l.gapPx; y < l.height; y += l.cellPx) g.fillRect(0, y, l.width, l.gapPx)
  return c
}

export function IntegrityGrid({ n, runId, ratingScale, buckets, onFrame }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<Surface | null>(null)
  const frameRef = useRef<number | null>(null)
  const onFrameRef = useRef(onFrame)
  const [layout, setLayout] = useState<GridLayout | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const theme = useTheme((s) => s.theme)
  const steamView = useViewStore((s) => s.lens === 'steam' && s.steam !== null)

  useLayoutEffect(() => {
    onFrameRef.current = onFrame
  })

  // Fit the grid to its box.
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || n <= 0) return
    const measure = () => {
      const { width, height } = wrap.getBoundingClientRect()
      if (width < 4 || height < 4) return
      const next = fitGrid(n, width, height, window.devicePixelRatio || 1)
      setLayout((prev) =>
        prev && prev.cols === next.cols && prev.cellPx === next.cellPx && prev.n === next.n && prev.dpr === next.dpr
          ? prev
          : next,
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [n])

  // Build the drawing surface for a layout, then drive the paint loop from store subscriptions.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !layout) return
    canvas.width = layout.width
    canvas.height = layout.height
    canvas.style.width = `${layout.width / layout.dpr}px`
    canvas.style.height = `${layout.height / layout.dpr}px`

    const palette = readPalette()
    const steamPalette = buildPalette(steamHex(palette.hex), palette.surfaceHex)
    const bitmap = document.createElement('canvas')
    bitmap.width = layout.cols
    bitmap.height = layout.rows
    const bitmapCtx = bitmap.getContext('2d')!
    const image = bitmapCtx.createImageData(layout.cols, layout.rows)
    const s: Surface = {
      layout,
      bitmap,
      bitmapCtx,
      image,
      paint: {
        pixels: new Uint32Array(image.data.buffer),
        palette,
        mask: useViewStore.getState().brush?.mask ?? null,
        fadeMs: prefersReducedMotion() ? 0 : FADE_MS,
      },
      gaps: makeGapOverlay(layout, palette.surfaceHex),
      animating: [],
      full: true,
    }
    surfaceRef.current = s
    const applyLens = (lens: GridLens, steam: Uint8Array | null) => {
      const on = lens === 'steam' && steam !== null
      s.paint.classes = on ? steam : null
      s.paint.palette = on ? steamPalette : palette
      s.full = true
    }
    applyLens(useViewStore.getState().lens, useViewStore.getState().steam)

    const draw = () => {
      frameRef.current = null
      const t0 = performance.now()
      const grid = useRunStore.getState().grid
      const now = performance.now()
      let painted = false
      if (s.full || grid.fullDirty) {
        grid.fullDirty = false
        grid.drainDirty()
        s.animating = paintAll(s.paint, grid, layout.n, now)
        s.full = false
        painted = true
      } else {
        const dirty = grid.drainDirty()
        if (dirty.length || s.animating.length) {
          s.animating = paintCells(s.paint, grid, s.animating.length ? [...s.animating, ...dirty] : dirty, now)
          painted = true
        }
      }
      if (painted) s.bitmapCtx.putImageData(s.image, 0, 0)

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(s.bitmap, 0, 0, layout.cols, layout.rows, 0, 0, layout.width, layout.height)
      if (s.gaps) ctx.drawImage(s.gaps, 0, 0)
      drawHighlights(ctx, layout)
      onFrameRef.current?.(performance.now() - t0)
      if (s.animating.length) schedule()
    }
    const schedule = () => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw)
    }

    const unsubRun = useRunStore.subscribe((st, prev) => {
      if (st.gridVersion !== prev.gridVersion) schedule()
    })
    const unsubView = useViewStore.subscribe((st, prev) => {
      if (st.brush !== prev.brush) {
        s.paint.mask = st.brush?.mask ?? null
        s.full = true
      }
      if (st.lens !== prev.lens || st.steam !== prev.steam) applyLens(st.lens, st.steam)
      if (
        st.lens !== prev.lens ||
        st.steam !== prev.steam ||
        st.hovered !== prev.hovered ||
        st.selected !== prev.selected ||
        st.hoverRange !== prev.hoverRange ||
        st.brush !== prev.brush
      )
        schedule()
    })
    schedule()
    return () => {
      unsubRun()
      unsubView()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      surfaceRef.current = null
    }
  }, [layout, theme])

  const locate = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!layout) return null
    const r = e.currentTarget.getBoundingClientRect()
    return { i: indexAt(layout, e.clientX - r.left, e.clientY - r.top), x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const hit = locate(e)
    useViewStore.getState().setHovered(hit?.i ?? null)
    setPointer(hit && hit.i != null ? { x: hit.x, y: hit.y } : null)
  }

  const onPointerLeave = () => {
    useViewStore.getState().setHovered(null)
    setPointer(null)
  }

  const onClick = (e: PointerEvent<HTMLCanvasElement>) => {
    const hit = locate(e)
    if (hit?.i == null) return
    const v = useViewStore.getState()
    v.select(v.selected === hit.i ? null : hit.i)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!layout) return
    const v = useViewStore.getState()
    if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      const from = v.hovered ?? v.selected ?? 0
      const i = v.hovered == null && v.selected == null ? 0 : stepIndex(layout, from, e.key)
      v.setHovered(i)
      const o = cellOrigin(layout, i)
      setPointer({ x: o.x + o.size, y: o.y + o.size })
    } else if ((e.key === 'Enter' || e.key === ' ') && v.hovered != null) {
      e.preventDefault()
      v.select(v.selected === v.hovered ? null : v.hovered)
    } else if (e.key === 'Escape') {
      v.select(null)
      v.pin(null)
      v.setBrush(null)
    }
  }

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-0 w-full overflow-y-auto overflow-x-hidden rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setPointer(null)}
      aria-label={`Integrity grid: ${n.toLocaleString()} reviews in time order. Arrow keys move, Enter selects, Escape clears.`}
      aria-describedby="grid-legend"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={steamView ? 'One square per review, coloured by whether Steam’s score counts it' : 'One square per review, coloured by action'}
        className="block cursor-crosshair"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
      />
      {pointer && layout && (
        <GridTooltip
          runId={runId}
          ratingScale={ratingScale}
          buckets={buckets}
          x={pointer.x}
          y={pointer.y}
          boxWidth={layout.width / layout.dpr}
        />
      )}
    </div>
  )
}

/** Hour range from the timeline, the hovered cell and the selected cell, in CSS pixels. */
function drawHighlights(ctx: CanvasRenderingContext2D, l: GridLayout) {
  const { hovered, selected, hoverRange } = useViewStore.getState()
  if (hovered == null && selected == null && !hoverRange) return
  ctx.setTransform(l.dpr, 0, 0, l.dpr, 0, 0)
  const size = l.cellPx / l.dpr
  if (hoverRange) {
    const rects = rangeRects(l, hoverRange.start, hoverRange.end)
    ctx.fillStyle = 'rgba(255,255,255,0.28)'
    for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1
    for (const r of rects) ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1)
  }
  const ring = (i: number, colour: string, width: number) => {
    const o = cellOrigin(l, i)
    const pad = Math.max(1.5, (8 - size) / 2) // tiny cells get a ring big enough to see
    ctx.strokeStyle = '#0f1217'
    ctx.lineWidth = width + 2
    ctx.strokeRect(o.x - pad, o.y - pad, size + 2 * pad, size + 2 * pad)
    ctx.strokeStyle = colour
    ctx.lineWidth = width
    ctx.strokeRect(o.x - pad, o.y - pad, size + 2 * pad, size + 2 * pad)
  }
  if (selected != null && selected < l.n) ring(selected, '#ffffff', 2)
  if (hovered != null && hovered < l.n && hovered !== selected) ring(hovered, 'rgba(255,255,255,0.8)', 1)
}
