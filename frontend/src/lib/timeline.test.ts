import { hourIndex } from '@/test/fixtures'
import { binColumns, bucketAtX, bucketOfIndex, dayTicks, hourActionCounts, hourBuckets, N_ACTIONS } from './timeline'

describe('timeline aggregation', () => {
  const b = hourBuckets(hourIndex(100, 10)) // 10 hours, 10 reviews each

  it('counts actions per hour from the grid', () => {
    const actions = Uint8Array.from({ length: 100 }, (_, i) => (i < 10 ? 2 : i % 2 ? 1 : 0))
    const per = hourActionCounts(b, actions)
    expect(Array.from(per.subarray(0, N_ACTIONS))).toEqual([0, 0, 10, 0, 0])
    expect(Array.from(per.subarray(N_ACTIONS, 2 * N_ACTIONS))).toEqual([5, 5, 0, 0, 0])
  })

  it('bins hours into pixel columns without losing reviews', () => {
    const per = hourActionCounts(b, new Uint8Array(100).fill(1))
    const { columns, max } = binColumns(b, per, 4)
    let total = 0
    for (const v of columns) total += v
    expect(total).toBe(100)
    expect(max).toBe(30) // 10 hours over 4 columns: 3,2,3,2 hours
  })

  it('finds the hour under x and the hour of a grid index', () => {
    expect(bucketAtX(b, 0, 100)).toBe(0)
    expect(bucketAtX(b, 99.9, 100)).toBe(9)
    expect(bucketOfIndex(b, 0)).toBe(0)
    expect(bucketOfIndex(b, 55)).toBe(5)
    expect(bucketOfIndex(b, 100)).toBe(-1)
  })

  it('drops reviews without a timestamp from the strip', () => {
    const idx = hourIndex(30, 10)
    idx.hours[2] = null
    expect(hourBuckets(idx).ms).toHaveLength(2)
  })

  it('thins day ticks to fit', () => {
    const long = hourBuckets(hourIndex(24 * 90, 1)) // 90 days
    const ticks = dayTicks(long, 8)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks.length).toBeGreaterThan(2)
  })
})
