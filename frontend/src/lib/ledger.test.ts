import type { RunOut } from '@/data/api'
import { integrityLedger } from './ledger'

const T = {
  w_offgame: 0.6,
  w_offtopic: 0.1,
  w_contradiction: 0.5,
  w_spam: 0.2,
  w_templated: 0.15,
  w_low_experience: 0.2,
  w_informativeness: 0,
  w_rating_support: 0,
} as RunOut['config']['thresholds']

const answers = {
  about_game: { noul: 0.25 },
  rating_support: { score: 2, probabilities: { '0': 0.1, '1': 0.2, '2': 0.6, '3': 0.1 } },
  spam_promo: { noul: 0.05 },
  templated: { noul: 0.1 },
  informativeness: { score: 1, probabilities: { '0': 0.1, '1': 0.7, '2': 0.1, '3': 0.1 } },
}

it('mirrors the backend integrity formula', () => {
  const r = integrityLedger(answers, T, false)!
  // 1 - (0.6*0.75 + 0.5*0.1 + 0.2*0.05 + 0.15*0.1) = 1 - 0.525
  expect(r.score).toBeCloseTo(0.475)
  expect(r.lines.find((l) => l.code === 'LOW_INFO')!.contribution).toBe(0) // option B
})

it('adds the experience floor only with low playtime', () => {
  const r = integrityLedger(answers, T, true)!
  expect(r.score).toBeCloseTo(0.475 - 0.2 * 0.75)
})

it('returns null without System One answers', () => {
  expect(integrityLedger({}, T, false)).toBeNull()
})

it('counts the v5 influence answer only above its floor', () => {
  const t = { ...T, w_influence: 0.6, influence_floor: 0.5 } as RunOut['config']['thresholds']
  const yes = integrityLedger({ ...answers, influence_attempt: { noul: 0.6 } }, t, false)!
  expect(yes.score).toBeCloseTo(0.475 - 0.6 * 0.2)
  const no = integrityLedger({ ...answers, influence_attempt: { noul: 0.3 } }, t, false)!
  expect(no.score).toBeCloseTo(0.475)
})
