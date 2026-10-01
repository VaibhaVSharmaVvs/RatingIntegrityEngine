import { cellOrigin, fitGrid, indexAt, rangeRects, stepIndex } from './gridLayout'

describe('fitGrid', () => {
  it('picks the largest whole-pixel cell that fits the box', () => {
    const l = fitGrid(50_000, 1100, 560, 1)
    expect(l.rows * l.cellPx).toBeLessThanOrEqual(560)
    expect(l.cols * l.rows).toBeGreaterThanOrEqual(50_000)
    // one size up would not fit
    const bigger = l.cellPx + 1
    expect(Math.ceil(50_000 / Math.floor(1100 / bigger)) * bigger).toBeGreaterThan(560)
  })

  it('caps cell size for small datasets and adds a gap once cells are big enough', () => {
    const l = fitGrid(200, 1000, 600, 1)
    expect(l.cellPx).toBe(14)
    expect(l.gapPx).toBe(1)
    expect(fitGrid(50_000, 1100, 560, 1).gapPx).toBe(0)
  })

  it('works in device pixels on high-DPI screens', () => {
    const l = fitGrid(5_000, 800, 400, 2)
    expect(l.width).toBe(l.cols * l.cellPx)
    expect(l.width).toBeLessThanOrEqual(1600)
    expect(l.height).toBeLessThanOrEqual(800)
  })

  it('falls back to 1 px cells (and a taller grid) when nothing fits', () => {
    const l = fitGrid(100_000, 100, 100, 1)
    expect(l.cellPx).toBe(1)
    expect(l.rows).toBe(1000)
  })
})

describe('hit testing and geometry', () => {
  const l = fitGrid(1000, 400, 400, 2) // cells are whole device px; CSS coords are halves

  it('round-trips a cell origin through indexAt', () => {
    for (const i of [0, 1, l.cols - 1, l.cols, 999]) {
      const o = cellOrigin(l, i)
      expect(indexAt(l, o.x + o.size / 2, o.y + o.size / 2)).toBe(i)
    }
  })

  it('returns null outside the grid and past the last review', () => {
    expect(indexAt(l, -1, 0)).toBeNull()
    expect(indexAt(l, 10_000, 0)).toBeNull()
    const last = cellOrigin(l, 999)
    if (999 % l.cols !== l.cols - 1) expect(indexAt(l, last.x + last.size * 1.5, last.y + 1)).toBeNull()
  })

  it('moves with the arrow keys and clamps at the ends', () => {
    expect(stepIndex(l, 0, 'ArrowLeft')).toBe(0)
    expect(stepIndex(l, 0, 'ArrowRight')).toBe(1)
    expect(stepIndex(l, 0, 'ArrowDown')).toBe(l.cols)
    expect(stepIndex(l, 999, 'ArrowDown')).toBe(999)
  })

  it('covers a contiguous range with one rectangle per row', () => {
    const start = l.cols - 2
    const rects = rangeRects(l, start, start + l.cols + 3)
    expect(rects).toHaveLength(3)
    const s = l.cellPx / l.dpr
    expect(rects[0].w).toBeCloseTo(2 * s)
    expect(rects[1].w).toBeCloseTo(l.cols * s)
    expect(rects[2].w).toBeCloseTo(1 * s)
  })
})
