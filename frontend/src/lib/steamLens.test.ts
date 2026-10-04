import { GridBuffer } from '@/state/gridBuffer'
import { hourIndex } from '@/test/fixtures'
import { paintAll, paintCells, type PaintContext } from './gridPaint'
import { buildPalette, DEFAULT_HEX } from './palette'
import { steamClasses, steamHex, steamTally } from './steamLens'
import { hourBuckets } from './timeline'

const window = (start: string, end: string) => ({ start, end, negatives: 10, offtopic_share: 0.8, reviews_removed: 0 })

describe('Steam-policy view', () => {
  // 12 reviews, 3 per hour from 2024-05-01T00:00Z: hours 0..3
  const buckets = hourBuckets(hourIndex(12, 3))

  it('uses the key-activation flag first, as the backend does', () => {
    const counts = [true, false, false, true]
    const key = [false, true, false, false]
    expect(Array.from(steamClasses(counts, key, [], null))).toEqual([1, 3, 2, 1])
  })

  it('falls back to the window hours when the scores have no key-activation flag', () => {
    const counts = [true, true, false, false, false, false, true, false, true, true, true, true]
    // window covers hours 1–2 ([01:00, 03:00)); review 7 (hour 2) and 2 (hour 0) are not counted
    const cls = steamClasses(counts, undefined, [window('2024-05-01T01:00:00Z', '2024-05-01T02:00:00Z')], buckets)
    expect(Array.from(cls)).toEqual([1, 1, 3, 2, 2, 2, 1, 2, 1, 1, 1, 1])
    // without windows every left-out review is a key activation
    expect(Array.from(steamClasses([true, false], undefined, [], buckets))).toEqual([1, 3])
  })

  it('counts only revealed cells; the rest stay pending', () => {
    const actions = new Uint8Array([1, 2, 0, 4])
    const classes = new Uint8Array([1, 1, 3, 2])
    expect(steamTally(actions, classes, 6)).toEqual([3, 2, 1, 0])
  })

  it('paints decided cells by class and leaves pending cells pending', () => {
    const steam = buildPalette(steamHex(DEFAULT_HEX))
    const g = new GridBuffer(4)
    g.load(new Uint8Array([0, 4, 1, 2]))
    const ctx: PaintContext = {
      pixels: new Uint32Array(4),
      palette: steam,
      mask: null,
      fadeMs: 0,
      classes: new Uint8Array([1, 1, 2, 3]),
    }
    paintAll(ctx, g, 4, 0)
    // pending, counts (keep teal) despite EXCLUDE, window (vermilion), key activation (violet)
    expect(Array.from(ctx.pixels)).toEqual([steam.cells[0], steam.cells[1], steam.cells[2], steam.cells[3]])
    expect(steam.hex.slice(0, 4)).toEqual([DEFAULT_HEX[0], DEFAULT_HEX[1], DEFAULT_HEX[4], DEFAULT_HEX[3]])
    // the fading path agrees once a fade has finished
    const fading = { ...ctx, pixels: new Uint32Array(4), fadeMs: 320 }
    paintCells(fading, g, [0, 1, 2, 3], 1e9)
    expect(Array.from(fading.pixels)).toEqual(Array.from(ctx.pixels))
  })
})
