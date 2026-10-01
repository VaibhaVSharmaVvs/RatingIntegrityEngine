import type { RunScores } from '@/data/api'
import { adjustedRating, platformRating, rawRating, waterfall } from './scores'

const CODES = ['OFF_TOPIC', 'NEAR_DUPLICATE', 'SPAM']

/** 8 reviews: two off-topic negatives downweighted, a copy, a spam exclude, a flag. */
function scores(): RunScores {
  return {
    rating_norm: [1, 1, 0, 0, 1, 0, 1, null],
    integrity: [0.9, 0.95, 0.3, 0.4, 0.9, 0.2, 0.6, null],
    base_integrity: [0.9, 0.95, 0.3, 0.5, 0.9, 0.2, 0.8, null],
    action: [1, 1, 2, 2, 2, 4, 3, 0],
    primary_reason: [-1, -1, 0, 0, 1, 2, -1, -1],
    reason_codes: CODES,
    counts_in_platform: [true, true, false, false, true, true, true, true],
    weights: { KEEP: 1, DOWNWEIGHT: 0.25, FLAG: 1, EXCLUDE: 0 },
    downweight_below: 0.55,
  }
}

it('computes the three ratings', () => {
  const s = scores()
  expect(rawRating(s)).toBeCloseTo(4 / 7)
  // weights 1,1,.25,.25,.25,0,1 -> num 1+1+.25+1 = 3.25, den 3.75
  expect(adjustedRating(s)).toBeCloseTo(3.25 / 3.75)
  expect(platformRating(s)).toBeCloseTo(4 / 5)
})

it('walks raw to adjusted one reason at a time and lands on the adjusted rating', () => {
  const s = scores()
  const steps = waterfall(s)
  expect(steps.map((x) => x.code)).toEqual(['OFF_TOPIC', 'NEAR_DUPLICATE', 'SPAM'])
  expect(steps[0].reviews).toBe(2)
  expect(steps[0].delta).toBeGreaterThan(0) // removing negatives raises the rating
  expect(steps[1].delta).toBeLessThan(0)
  expect(steps.at(-1)!.after).toBeCloseTo(adjustedRating(s)!)
  const total = steps.reduce((a, x) => a + x.delta, rawRating(s)!)
  expect(total).toBeCloseTo(adjustedRating(s)!)
})
