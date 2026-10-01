import type { ActionCode } from '@/data/api'

/** Action order matches the grid byte (ActionCode): 0=PENDING .. 4=EXCLUDE. */
export const ACTION_NAMES = ['PENDING', 'KEEP', 'DOWNWEIGHT', 'FLAG', 'EXCLUDE'] as const
export type ActionName = (typeof ACTION_NAMES)[number]

export const ACTION_LABELS: Record<ActionName, string> = {
  PENDING: 'Pending',
  KEEP: 'Keep',
  DOWNWEIGHT: 'Downweight',
  FLAG: 'Flag',
  EXCLUDE: 'Exclude',
}

/** CSS custom properties that hold each action colour (index.css). */
export const ACTION_VARS = [
  '--action-pending',
  '--action-keep',
  '--action-downweight',
  '--action-flag',
  '--action-exclude',
] as const

/**
 * Spec hex (MVP_SPEC §8.3). Validated with the dataviz palette checker against the
 * instrument surface: CVD ΔE ≥ 10.9 all pairs, contrast ≥ 3:1. The grid always sits on
 * the dark instrument surface, in both themes, because darker light-mode steps of the
 * same hues collapse amber into vermilion for deuteranopes.
 */
export const DEFAULT_HEX = ['#3a414c', '#2ba8a0', '#e0a030', '#8b6cef', '#e4572e'] as const
export const DEFAULT_INSTRUMENT = '#0f1217'

export interface GridPalette {
  /** RGBA per action code, packed for a little-endian Uint32 view of ImageData. */
  cells: Uint32Array
  /** The same colours mixed toward the surface, for cells outside a brushed cluster. */
  dimmed: Uint32Array
  surface: number
  hex: string[]
  surfaceHex: string
}

export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  const n = Number.parseInt(h.slice(0, 6), 16)
  if (Number.isNaN(n)) throw new Error(`not a hex colour: ${hex}`)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Pack RGB(A) for a Uint32Array over ImageData on little-endian hosts (every browser we target). */
export function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0
}

export function unpackRgba(c: number): [number, number, number, number] {
  return [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24]
}

export function mix(a: number, b: number, t: number): number {
  const [ar, ag, ab] = unpackRgba(a)
  const [br, bg, bb] = unpackRgba(b)
  return packRgba(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  )
}

export function buildPalette(hex: readonly string[] = DEFAULT_HEX, surfaceHex = DEFAULT_INSTRUMENT): GridPalette {
  const surface = packRgba(...parseHex(surfaceHex))
  const cells = new Uint32Array(hex.map((h) => packRgba(...parseHex(h))))
  const dimmed = new Uint32Array(Array.from(cells, (c) => mix(c, surface, 0.78)))
  return { cells, dimmed, surface, hex: [...hex], surfaceHex }
}

/** Read the palette from CSS tokens so the canvas follows the theme; falls back to spec hex. */
export function readPalette(el: Element = document.documentElement): GridPalette {
  const css = getComputedStyle(el)
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return buildPalette(
    ACTION_VARS.map((v, i) => read(v, DEFAULT_HEX[i])),
    read('--instrument', DEFAULT_INSTRUMENT),
  )
}

export function actionName(code: ActionCode | number): ActionName {
  return ACTION_NAMES[code] ?? 'PENDING'
}
