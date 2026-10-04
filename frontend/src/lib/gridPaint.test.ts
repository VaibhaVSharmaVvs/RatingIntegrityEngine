import { GridBuffer } from '@/state/gridBuffer'
import { easeOut, FADE_MS, FADE_STEPS, FLASH, paintAll, paintCells, type PaintContext } from './gridPaint'
import { buildPalette, DEFAULT_HEX, mix, packRgba, parseHex, unpackRgba } from './palette'

// shared CI runners are slower and noisier than a dev machine
const ON_CI = Boolean((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CI)

const palette = buildPalette()
const ctx = (n: number, over: Partial<PaintContext> = {}): PaintContext => ({
  pixels: new Uint32Array(n),
  palette,
  mask: null,
  fadeMs: 0,
  ...over,
})
const hexOf = (c: number) =>
  `#${unpackRgba(c)
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`

describe('grid colour mapping', () => {
  it('maps each action code to the spec palette (MVP_SPEC §8.3)', () => {
    expect(DEFAULT_HEX.slice(1)).toEqual(['#2ba8a0', '#e0a030', '#8b6cef', '#e4572e'])
    const g = new GridBuffer(5)
    g.load(new Uint8Array([0, 1, 2, 3, 4]))
    const c = ctx(5)
    paintAll(c, g, 5, 0)
    expect(Array.from(c.pixels, hexOf)).toEqual([...DEFAULT_HEX])
  })

  it('packs RGBA for a little-endian ImageData view', () => {
    const px = new Uint8ClampedArray(new Uint32Array([packRgba(...parseHex('#2ba8a0'))]).buffer)
    expect(Array.from(px)).toEqual([0x2b, 0xa8, 0xa0, 255])
  })

  it('fills cells past the end of the grid with the surface colour', () => {
    const g = new GridBuffer(3)
    g.load(new Uint8Array([1, 1, 1]))
    const c = ctx(6)
    paintAll(c, g, 3, 0)
    expect(c.pixels[3]).toBe(palette.surface)
    expect(c.pixels[5]).toBe(palette.surface)
  })

  it('dims cells outside a brushed cluster', () => {
    const g = new GridBuffer(3)
    g.load(new Uint8Array([1, 1, 1]))
    const c = ctx(3, { mask: new Uint8Array([0, 1, 0]) })
    paintAll(c, g, 3, 0)
    expect(c.pixels[1]).toBe(palette.cells[1])
    expect(c.pixels[0]).toBe(palette.dimmed[1])
    expect(c.pixels[0]).not.toBe(palette.cells[1])
  })

  it('flashes a newly labelled cell, then eases into its colour', () => {
    const g = new GridBuffer(1)
    g.apply([0], [4], 1000)
    const c = ctx(1, { fadeMs: FADE_MS })
    const flash = mix(palette.cells[4], packRgba(255, 255, 255), FLASH)
    expect(paintCells(c, g, [0], 1000)).toEqual([0])
    expect(c.pixels[0]).toBe(flash) // brightest on the frame it lands
    expect(paintCells(c, g, [0], 1000 + FADE_MS / 2)).toEqual([0])
    expect(c.pixels[0]).toBe(mix(flash, palette.cells[4], easeOut(Math.floor(FADE_STEPS / 2) / FADE_STEPS)))
    expect(paintCells(c, g, [0], 1000 + FADE_MS)).toEqual([])
    expect(c.pixels[0]).toBe(palette.cells[4])
  })

  it('snaps straight to the final colour under reduced motion', () => {
    const g = new GridBuffer(1)
    g.apply([0], [2], 1000)
    const c = ctx(1, { fadeMs: 0 })
    expect(paintCells(c, g, [0], 1001)).toEqual([])
    expect(c.pixels[0]).toBe(palette.cells[2])
  })

  it('fades the whole 50K grid at once inside the frame budget', () => {
    const n = 50_000
    const g = new GridBuffer(n)
    const idx = Array.from({ length: n }, (_, i) => i)
    g.apply(idx, idx.map((i) => 1 + (i % 4)), 0)
    const c = ctx(n, { fadeMs: FADE_MS })
    paintCells(c, g, idx, 10) // warm up (builds the fade table)
    const times: number[] = []
    for (let k = 0; k < 20; k++) {
      const t = performance.now()
      paintCells(c, g, idx, 20 + k)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    // 5 ms on a dev machine; shared CI runners are slower and noisier
    expect(times[10]).toBeLessThan(ON_CI ? 15 : 5)
  })

  it('repaints a 50K grid well inside a frame (budget < 5 ms in the browser)', () => {
    const n = 50_000
    const g = new GridBuffer(n)
    g.load(Uint8Array.from({ length: n }, (_, i) => i % 5))
    const c = ctx(n)
    paintAll(c, g, n, 0) // warm up
    const times: number[] = []
    for (let k = 0; k < 20; k++) {
      const t = performance.now()
      paintAll(c, g, n, 0)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    // jsdom/Node timing is only indicative; the real check is the browser frame budget.
    // 5 ms on a dev machine; shared CI runners are slower and noisier
    expect(times[10]).toBeLessThan(ON_CI ? 15 : 5)
  })
})
