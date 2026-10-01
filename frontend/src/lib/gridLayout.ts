/**
 * Integrity grid geometry. One cell per review, row-major in chronological order, so a
 * burst of reviews reads as a solid band. Cells are whole device pixels so the scaled
 * 1-px-per-cell bitmap stays crisp.
 */
export interface GridLayout {
  n: number
  cols: number
  rows: number
  /** cell pitch in device pixels (cell + gap) */
  cellPx: number
  /** gap between cells in device pixels (0 when cells are too small for one) */
  gapPx: number
  dpr: number
  /** canvas size in device pixels */
  width: number
  height: number
}

export const MAX_CELL_CSS = 14
export const GAP_MIN_CELL_PX = 4

/**
 * Largest cell that fits `n` cells in the box. If even 1 device px does not fit the
 * height, the grid keeps 1 px cells and grows taller than the box (the panel scrolls).
 */
export function fitGrid(n: number, boxWidthCss: number, boxHeightCss: number, dpr = 1): GridLayout {
  const w = Math.max(1, Math.floor(boxWidthCss * dpr))
  const h = Math.max(1, Math.floor(boxHeightCss * dpr))
  const count = Math.max(n, 1)
  const maxCell = Math.max(1, Math.floor(MAX_CELL_CSS * dpr))
  let cellPx = 1
  for (let c = Math.min(maxCell, w); c >= 1; c--) {
    const cols = Math.floor(w / c)
    if (cols >= 1 && Math.ceil(count / cols) * c <= h) {
      cellPx = c
      break
    }
  }
  const cols = Math.max(1, Math.floor(w / cellPx))
  const rows = Math.ceil(count / cols)
  return {
    n,
    cols,
    rows,
    cellPx,
    gapPx: cellPx >= GAP_MIN_CELL_PX ? Math.max(1, Math.round(dpr)) : 0,
    dpr,
    width: cols * cellPx,
    height: rows * cellPx,
  }
}

/** Grid index under a point in CSS pixels relative to the canvas, or null. */
export function indexAt(layout: GridLayout, xCss: number, yCss: number): number | null {
  const col = Math.floor((xCss * layout.dpr) / layout.cellPx)
  const row = Math.floor((yCss * layout.dpr) / layout.cellPx)
  if (col < 0 || row < 0 || col >= layout.cols || row >= layout.rows) return null
  const i = row * layout.cols + col
  return i < layout.n ? i : null
}

/** Top-left of a cell in CSS pixels. */
export function cellOrigin(layout: GridLayout, i: number): { x: number; y: number; size: number } {
  const col = i % layout.cols
  const row = Math.floor(i / layout.cols)
  return {
    x: (col * layout.cellPx) / layout.dpr,
    y: (row * layout.cellPx) / layout.dpr,
    size: layout.cellPx / layout.dpr,
  }
}

/** Arrow-key navigation in the grid; clamps to [0, n). */
export function stepIndex(layout: GridLayout, i: number, key: string): number {
  const delta: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -layout.cols,
    ArrowDown: layout.cols,
  }
  const next = i + (delta[key] ?? 0)
  return Math.min(Math.max(next, 0), Math.max(layout.n - 1, 0))
}

/** Rectangles (CSS px) covering the contiguous index range [start, end): one per row touched. */
export function rangeRects(
  layout: GridLayout,
  start: number,
  end: number,
): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = []
  const s = layout.cellPx / layout.dpr
  let i = Math.max(0, start)
  const stop = Math.min(end, layout.n)
  while (i < stop) {
    const row = Math.floor(i / layout.cols)
    const rowEnd = Math.min((row + 1) * layout.cols, stop)
    const col = i % layout.cols
    out.push({ x: col * s, y: row * s, w: (rowEnd - i) * s, h: s })
    i = rowEnd
  }
  return out
}
