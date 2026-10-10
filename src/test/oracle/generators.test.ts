// Validation uses the engine's validateProblem, since a problem the engine rejects cannot be cross-checked. The oracle
// itself still imports nothing from the engine.
import fc from 'fast-check'
import { validateProblem } from '../../engine/validate.ts'
import { bruteForceSolve } from './bruteForce.ts'
import {
  advancedCaseArb,
  caseFeatures,
  countInputs,
  sampleOracleCases,
  simpleCaseArb,
  type CaseFeature,
  type OracleCase,
} from './generators.ts'

const SEED = 20260927
const SAMPLE = sampleOracleCases(600, SEED)

describe('generated problems', () => {
  it('pass validation in their edition', () => {
    for (const { problem, settings } of SAMPLE) {
      expect(validateProblem(problem, settings), JSON.stringify(problem)).toEqual([])
    }
  })

  it('have 2-7 normalized inputs by default, and follow minInputs / maxInputs / editions', () => {
    const sizes = SAMPLE.map(({ problem }) => countInputs(problem))
    expect(Math.min(...sizes)).toBe(2)
    expect(Math.max(...sizes)).toBe(7)
    for (let n = 2; n <= 7; n++) expect(sizes.filter((size) => size === n).length, `size ${n}`).toBeGreaterThanOrEqual(20)

    const small = sampleOracleCases(200, SEED, { editions: ['bedrock'], minInputs: 3, maxInputs: 4 })
    for (const { problem, settings } of small) {
      expect(settings.edition).toBe('bedrock')
      expect(countInputs(problem)).toBeGreaterThanOrEqual(3)
      expect(countInputs(problem)).toBeLessThanOrEqual(4)
      expect(validateProblem(problem, settings)).toEqual([])
    }
  })

  it('are the same for the same seed and differ for another seed', () => {
    expect(sampleOracleCases(50, SEED)).toEqual(SAMPLE.slice(0, 50))
    expect(sampleOracleCases(50, SEED + 1)).not.toEqual(SAMPLE.slice(0, 50))
  })

  it('keep the mode of the arbitrary they come from', () => {
    for (const { problem } of fc.sample(simpleCaseArb(), { numRuns: 50, seed: SEED })) expect(problem.mode).toBe('simple')
    for (const { problem } of fc.sample(advancedCaseArb(), { numRuns: 50, seed: SEED })) expect(problem.mode).toBe('advanced')
  })

  it('cover every feature the cross-check needs, often enough', () => {
    const counts = new Map<CaseFeature, number>()
    for (const oracleCase of SAMPLE) for (const feature of caseFeatures(oracleCase)) counts.set(feature, (counts.get(feature) ?? 0) + 1)
    // 3% of the sample, so the 500 or more cases of the cross-check see each feature a dozen times or more
    const features: readonly CaseFeature[] = [
      'java', 'bedrock', 'simple', 'advanced', 'book-only', 'non-damageable-target',
      'conflict', 'blocker', 'inapplicable', 'stacking', 'duplicate-inputs', 'prior-work', 'extra-item',
      'goal', 'no-goal', 'use-only-needed', 'use-all-with-goal',
      'rename', 'no-cap', 'objective-levels', 'objective-xp', 'objective-finalPwp',
    ]
    for (const feature of features) expect(counts.get(feature) ?? 0, feature).toBeGreaterThanOrEqual(18)
  })

  it('describes the features of a hand-made case', () => {
    const oracleCase: OracleCase = {
      problem: {
        mode: 'advanced',
        target: { itemType: 'sword', enchantments: {}, anvilUses: 1 },
        extraItems: [],
        books: [{ enchantments: { smite: 1 }, anvilUses: 0 }, { enchantments: { sharpness: 5, looting: 3 }, anvilUses: 0 }],
        goal: { looting: 3 },
        useOnlyNeeded: true,
      },
      settings: { edition: 'java', levelCap: null, objective: 'xp', rename: true },
    }
    expect([...caseFeatures(oracleCase)].sort()).toEqual([
      'advanced', 'blocker', 'conflict', 'goal', 'java', 'no-cap', 'objective-xp', 'prior-work', 'rename', 'use-only-needed',
    ])
  })
})

describe('the oracle on generated problems', () => {
  it.each(['java', 'bedrock'] as const)('%s: solves 150 problems, with both feasible and infeasible ones', (edition) => {
    const cases = sampleOracleCases(150, SEED + 2, { editions: [edition] })
    const statuses = cases.map(({ problem, settings }) => bruteForceSolve(problem, settings).status)
    const feasible = statuses.filter((status) => status === 'ok').length
    expect(feasible).toBeGreaterThanOrEqual(75)
    expect(feasible).toBeLessThan(150)
  })
})
