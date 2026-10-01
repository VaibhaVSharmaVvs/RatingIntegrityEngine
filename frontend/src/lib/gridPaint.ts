import type { GridBuffer } from '@/state/gridBuffer'
import { mix, packRgba, type GridPalette } from './palette'

/**
 * A newly labelled cell flashes bright and eases into its action colour, so each decision
 * is visible as it lands (spec said a 150 ms fade from pending; on a 4 px cell that read as
 * an instant switch). `prefers-reduced-motion` still snaps.
 */
export const FADE_MS = 320
/** how far toward white the flash starts */
export const FLASH = 0.6
/** fade is quantised to this many steps (~20 ms each at 320 ms) */
export const FADE_STEPS = 16
const WHITE = packRgba(255, 255, 255)
/** ease-out cubic: fast settle, so the colour is readable almost at once */
export const easeOut = (x: number) => 1 - (1 - x) ** 3
const N = 5

/**
 * Precomputed fade colours: [from * 5 + to][step], for the full and the dimmed palette.
 * Every fade starts from the flash of its target colour; `from` is kept in the index so a
 * different start (e.g. from the previous action) stays a table change. One lookup per cell.
 */
export interface FadeTable {
  cells: Uint32Array
  dimmed: Uint32Array
}

export function buildFadeTable(palette: GridPalette): FadeTable {
  const make = (lut: Uint32Array) => {
    const t = new Uint32Array(N * N * FADE_STEPS)
    for (let a = 0; a < N; a++)
      for (let b = 0; b < N; b++)
        for (let k = 0; k < FADE_STEPS; k++) {
          const flash = mix(lut[b], WHITE, FLASH)
          t[(a * N + b) * FADE_STEPS + k] = mix(flash, lut[b], easeOut(k / FADE_STEPS))
        }
    return t
  }
  return { cells: make(palette.cells), dimmed: make(palette.dimmed) }
}

const fadeTables = new WeakMap<GridPalette, FadeTable>()
function fadeTable(palette: GridPalette): FadeTable {
  let t = fadeTables.get(palette)
  if (!t) fadeTables.set(palette, (t = buildFadeTable(palette)))
  return t
}

export interface PaintContext {
  /** one pixel per cell, length >= cols * rows */
  pixels: Uint32Array
  palette: GridPalette
  /** brushed cluster: 1 = member; others are dimmed */
  mask: Uint8Array | null
  fadeMs: number
}

/** Colour of one cell at time `now`, including its fade from the previous action. */
export function cellColor(ctx: PaintContext, grid: GridBuffer, i: number, now: number): number {
  const dim = ctx.mask !== null && !ctx.mask[i]
  const a = grid.actions[i]
  const age = now - grid.changedAt[i]
  if (ctx.fadeMs <= 0 || age >= ctx.fadeMs || age < 0) return (dim ? ctx.palette.dimmed : ctx.palette.cells)[a]
  const table = fadeTable(ctx.palette)
  const step = Math.floor((age / ctx.fadeMs) * FADE_STEPS)
  return (dim ? table.dimmed : table.cells)[(grid.prev[i] * N + a) * FADE_STEPS + step]
}

/** Repaint every cell; cells past the end of the grid get the surface colour. */
export function paintAll(ctx: PaintContext, grid: GridBuffer, n: number, now: number): number[] {
  const { pixels } = ctx
  const animating: number[] = []
  const count = Math.min(n, grid.size, pixels.length)
  const fast = ctx.fadeMs <= 0
  const cells = ctx.palette.cells
  const dimmed = ctx.palette.dimmed
  const mask = ctx.mask
  const actions = grid.actions
  for (let i = 0; i < count; i++) {
    if (fast) {
      pixels[i] = (mask && !mask[i] ? dimmed : cells)[actions[i]]
    } else {
      pixels[i] = cellColor(ctx, grid, i, now)
      if (now - grid.changedAt[i] < ctx.fadeMs) animating.push(i)
    }
  }
  pixels.fill(ctx.palette.surface, count)
  return animating
}

/**
 * Repaint only `indices` (newly changed or still fading). Returns the cells that are
 * still mid-fade and need painting next frame.
 */
export function paintCells(ctx: PaintContext, grid: GridBuffer, indices: Iterable<number>, now: number): number[] {
  const still: number[] = []
  const limit = Math.min(grid.size, ctx.pixels.length)
  for (const i of indices) {
    if (i >= limit) continue
    ctx.pixels[i] = cellColor(ctx, grid, i, now)
    if (ctx.fadeMs > 0 && now - grid.changedAt[i] < ctx.fadeMs) still.push(i)
  }
  return still
}
