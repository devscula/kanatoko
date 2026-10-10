import { stepXp, xpAtLevel, xpToNextLevel } from './xp.ts'

describe('xpAtLevel', () => {
  it.each([
    [0, 0], [1, 7], [5, 55], [15, 315], [16, 352], [17, 394],
    [30, 1395], [31, 1507], [32, 1628], [39, 2727], [40, 2920],
  ])('level %i -> %i points', (level, points) => {
    expect(xpAtLevel(level)).toBe(points)
  })

  it('is an integer on every branch', () => {
    for (let level = 0; level <= 200; level++) expect(Number.isInteger(xpAtLevel(level)), `L=${level}`).toBe(true)
  })

  it('grows by xpToNextLevel for every level 0..199', () => {
    for (let level = 0; level < 200; level++) {
      expect(xpAtLevel(level + 1) - xpAtLevel(level), `L=${level}`).toBe(xpToNextLevel(level))
    }
  })

  it('increases by at least 7 per level, so a rename adds at least 7 points', () => {
    for (let level = 0; level < 200; level++) expect(xpAtLevel(level + 1) - xpAtLevel(level)).toBeGreaterThanOrEqual(7)
  })
})

describe('xpToNextLevel', () => {
  it.each([
    [0, 7], [14, 35], [15, 37], [29, 107], [30, 112], [31, 121],
  ])('level %i -> %i points (formula boundaries)', (level, points) => {
    expect(xpToNextLevel(level)).toBe(points)
  })
})

describe('stepXp', () => {
  it('is the points of exactly `cost` levels (the player ends at level 0)', () => {
    for (const cost of [0, 1, 16, 39, 40, 64]) expect(stepXp(cost)).toBe(xpAtLevel(cost))
  })

  it('gives 2727 points for a 39-level step, the clamped Java rename-only cost', () => {
    expect(stepXp(39)).toBe(2727)
  })
})
