import { activeSectionIndex } from './scrollSpy'

describe('activeSectionIndex', () => {
  it('picks the last section whose top is above the reading line', () => {
    expect(activeSectionIndex([300, 900, 1500], 200, false)).toBe(-1)
    expect(activeSectionIndex([150, 900, 1500], 200, false)).toBe(0)
    expect(activeSectionIndex([-800, -100, 600], 200, false)).toBe(1)
  })

  it('lights the last section at the bottom of the page, even if it never reaches the line', () => {
    expect(activeSectionIndex([-800, -100, 600], 200, true)).toBe(2)
    expect(activeSectionIndex([], 200, true)).toBe(-1)
  })
})
