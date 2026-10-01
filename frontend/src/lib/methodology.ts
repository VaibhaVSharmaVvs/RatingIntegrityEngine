/**
 * Words for the method's codes (backend app/decide/policy.py, app/corpus/suspicion.py).
 * One place, so the inspector, the tables and the help page say the same thing.
 * UI rule: never "fake"; say "integrity weight" or "low evidential value".
 */

export interface ReasonInfo {
  label: string
  /** one line, shown as the chip's title */
  short: string
}

export const REASONS: Record<string, ReasonInfo> = {
  OFF_TOPIC: {
    label: 'Not about the game',
    short: 'The review talks about the company, politics or other products rather than the game.',
  },
  CONTRADICTS_VERDICT: {
    label: 'Contradicts its verdict',
    short: 'The text argues the opposite of the thumbs up / down it was posted with.',
  },
  SPAM: { label: 'Spam or promotion', short: 'Advertising, referral links or giveaways.' },
  TEMPLATED: { label: 'Copied text', short: 'Copypasta, lyrics, a meme or a fill-in template, not written for this review.' },
  NEAR_DUPLICATE: { label: 'Later copy', short: 'A near-copy of an earlier review in this dataset; the first one keeps full weight.' },
  COORDINATED_CLUSTER: {
    label: 'Coordinated cluster',
    short: 'A member of a group of similar reviews whose suspicion is above the threshold.',
  },
  BURST_WINDOW: { label: 'Suspicious burst', short: 'Posted inside a volume spike whose suspicion is above the threshold.' },
  LOW_CONFIDENCE: { label: 'Model unsure', short: 'System One was unsure on questions that carry weight: a human should look.' },
  LOW_EXPERIENCE: { label: 'Off-game, low playtime', short: 'Not about the game, from an account with very little playtime.' },
  LOW_INFO: { label: 'Low information', short: 'Short or vague. Shown as evidence quality; carries no weight by default.' },
  LOW_INFORMATIVENESS: { label: 'Low information', short: 'Short or vague (heuristics-only run).' },
  UNSUPPORTED_VERDICT: {
    label: 'Weak support',
    short: 'The text barely supports its verdict. Shown as evidence quality; no weight by default.',
  },
}

export const reasonLabel = (code: string) => REASONS[code]?.label ?? code.replaceAll('_', ' ').toLowerCase()
export const reasonHelpHref = (code: string) => `/help#reason-${code.toLowerCase().replaceAll('_', '-')}`

export interface QuestionInfo {
  label: string
  /** how to read a high value */
  high: string
  /** the PolicyThresholds weight that makes it move integrity, if any */
  weight?: string
}

/** System One questions, in the order the inspector lists them. */
export const QUESTIONS: Record<string, QuestionInfo> = {
  about_game: { label: 'About the game', high: 'talks about the game itself', weight: 'w_offgame' },
  verdict_basis: { label: 'Verdict from playing', high: 'the verdict rests on playing the game (platform policy)' },
  rating_support: { label: 'Supports its verdict', high: 'the text backs the thumbs up / down', weight: 'w_contradiction' },
  spam_promo: { label: 'Spam or promotion', high: 'advertising or referral', weight: 'w_spam' },
  templated: { label: 'Copied text', high: 'copypasta, lyrics or template', weight: 'w_templated' },
  informativeness: { label: 'Informativeness', high: 'concrete facts and reasons', weight: 'w_informativeness' },
  topic: { label: 'Topic', high: 'main subject' },
  campaign_language: { label: 'Campaign language', high: 'calls to action, "everyone review-bomb"' },
}

export const questionOrder = (ids: string[]) => {
  const known = Object.keys(QUESTIONS)
  return [...ids].sort((a, b) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99))
}

/** Cluster suspicion factors (geometric mean; new-account share at half weight). */
export const FACTORS: Record<string, { label: string; short: string }> = {
  time_concentration: {
    label: 'Time concentration',
    short: 'How bunched in time, against random same-size groups from this corpus (bursts: against their trailing baseline).',
  },
  similarity: { label: 'Similar wording', short: 'Share of members within cosine 0.8 of the group’s centre (sentence embeddings).' },
  rating_homogeneity: { label: 'Same verdict', short: 'How far the majority verdict is above a 50/50 split.' },
  new_account_share: {
    label: 'New or low-playtime accounts',
    short: 'Share of single-review or low-playtime accounts, as a lift over this corpus (half weight).',
  },
  offtopic_mean: { label: 'Off-topic', short: 'Mean probability that a member’s topic is off-topic, a joke or platform policy.' },
}

export const KIND_LABEL: Record<string, string> = { semantic: 'Semantic cluster', duplicate: 'Duplicate group', burst: 'Burst' }
