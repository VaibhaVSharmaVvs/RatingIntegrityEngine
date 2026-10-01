import { formatDelta, formatRating, formatRatingRange, formatUsd, snippet, verdictWords } from './format'

describe('formatters', () => {
  it('shows binary ratings as % positive and star scales as stars', () => {
    expect(formatRating(0.764, 'binary')).toBe('76.4%')
    expect(formatRating(0.5, '1-5')).toBe('3.00')
    expect(formatRating(null, 'binary')).toBe('—')
    expect(formatRatingRange([0.715, 0.742], 'binary')).toBe('71.5–74.2%')
  })

  it('signs the adjustment in percentage points', () => {
    expect(formatDelta(0.764, 0.729, 'binary')).toBe('−3.5 pp')
    expect(formatDelta(0.3, 0.35, 'binary')).toBe('+5.0 pp')
  })

  it('words a verdict', () => {
    expect(verdictWords(1, 1, 'binary')).toBe('Recommended')
    expect(verdictWords(0, 0, 'binary')).toBe('Not recommended')
    expect(verdictWords(0.75, 4, '1-5')).toBe('4 of 5')
  })

  it('formats money and snippets', () => {
    expect(formatUsd(0)).toBe('$0')
    expect(formatUsd(0.2521)).toBe('$0.25')
    expect(formatUsd(0.0042)).toBe('$0.0042')
    const s = snippet('a  b\n'.repeat(40))
    expect(s.length).toBeLessThanOrEqual(80)
    expect(s.endsWith('…')).toBe(true)
  })
})
