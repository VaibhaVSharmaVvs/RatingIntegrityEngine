import type { RunOut } from '@/data/api'

type Thresholds = RunOut['config']['thresholds']
export type Answer = { type?: string; noul?: number; score?: number; choice?: string; probabilities?: Record<string, number>; confidence?: number }

export interface LedgerLine {
  code: string
  /** the policy weight, e.g. w_offgame */
  weightName: string
  weight: number
  /** the model's answer that the weight multiplies, in [0, 1] */
  value: number
  contribution: number
}

const levels = (a: Answer) => {
  const keys = Object.keys(a.probabilities ?? {})
  return keys.length > 1 ? keys.length : 4
}
const normScore = (a: Answer) => (a.score ?? 0) / (levels(a) - 1)

/**
 * The integrity score's arithmetic for one review, mirroring backend decide/policy.py
 * `decide`: 1 − Σ weight × answer, floored at 0. Returns null when the run has no
 * System One answers (heuristics-only) or the set is not one this mirrors.
 */
export function integrityLedger(
  raw: Record<string, Record<string, unknown>>,
  t: Thresholds,
  lowPlaytime: boolean,
): { lines: LedgerLine[]; score: number } | null {
  const a = raw as Record<string, Answer>
  if (!a.rating_support || !a.spam_promo || !a.templated || !a.informativeness) return null
  const support = a.rating_support
  const contradiction = support.probabilities?.['0'] ?? 0
  let offgame: number
  let offWeight: number
  let offName: string
  if (a.about_game) {
    offgame = 1 - (a.about_game.noul ?? 0)
    offWeight = t.w_offgame
    offName = 'w_offgame'
  } else if (a.topic) {
    const p = a.topic.probabilities ?? {}
    offgame = (p.off_topic ?? 0) + (p.joke_meme ?? 0)
    offWeight = t.w_offtopic
    offName = 'w_offtopic'
  } else return null
  const lines: LedgerLine[] = [
    { code: 'OFF_TOPIC', weightName: offName, weight: offWeight, value: offgame, contribution: 0 },
    { code: 'CONTRADICTS_VERDICT', weightName: 'w_contradiction', weight: t.w_contradiction, value: contradiction, contribution: 0 },
    { code: 'SPAM', weightName: 'w_spam', weight: t.w_spam, value: a.spam_promo.noul ?? 0, contribution: 0 },
    { code: 'TEMPLATED', weightName: 'w_templated', weight: t.w_templated, value: a.templated.noul ?? 0, contribution: 0 },
    {
      code: 'LOW_EXPERIENCE',
      weightName: 'w_low_experience',
      weight: t.w_low_experience,
      value: lowPlaytime ? offgame : 0,
      contribution: 0,
    },
    {
      code: 'LOW_INFO',
      weightName: 'w_informativeness',
      weight: t.w_informativeness,
      value: 1 - normScore(a.informativeness),
      contribution: 0,
    },
    {
      code: 'UNSUPPORTED_VERDICT',
      weightName: 'w_rating_support',
      weight: t.w_rating_support,
      value: 1 - normScore(support),
      contribution: 0,
    },
  ]
  if (a.influence_attempt) {
    // question set v5: counted only above `influence_floor`, rescaled to [0, 1]
    const tt = t as unknown as Record<string, number>
    const floor = tt.influence_floor ?? 0.5
    lines.push({
      code: 'INFLUENCE_ATTEMPT',
      weightName: 'w_influence',
      weight: tt.w_influence ?? 0,
      value: Math.max(0, (a.influence_attempt.noul ?? 0) - floor) / (1 - floor),
      contribution: 0,
    })
  }
  for (const l of lines) l.contribution = l.weight * l.value
  const score = Math.max(0, 1 - lines.reduce((s, l) => s + l.contribution, 0))
  return { lines, score }
}
