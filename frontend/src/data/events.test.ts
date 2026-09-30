import { decodeJudged } from './events'

it('decodes little-endian indices and action bytes', () => {
  // indices [1, 300] as <u4, actions [1, 4]; produced by the backend's encoder
  const e = { type: 'judged' as const, indices_b64: 'AQAAACwBAAA=', actions_b64: 'AQQ=' }
  const { indices, actions } = decodeJudged(e)
  expect(Array.from(indices)).toEqual([1, 300])
  expect(Array.from(actions)).toEqual([1, 4])
})
