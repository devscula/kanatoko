import { validateProblem } from '../../engine/validate.ts'
import { checkAdditive } from '../../engine/fastPath.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { levelEntries } from '../../engine/rules.ts'
import { solveSync } from '../../engine/solve.ts'
import type { AdvancedProblem, EnchantLevels, Settings, SolveResult } from '../../engine/types.ts'
import type { Edition } from '../../data/types.ts'
import { sampleOracleCases, type OracleCase } from '../oracle/generators.ts'
import { additiveCaseArb, expensiveCaseArb, pipelineCaseArb, sample } from './generators.ts'
import { expectOk, expectPlanProperties, warningOf } from './planChecks.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']
const SEED = 0x5eed_1506

function forEachCase<T extends OracleCase>(cases: readonly T[], check: (testCase: T) => void): void {
  cases.forEach((testCase, index) => {
    try {
      check(testCase)
    } catch (error) {
      throw new Error(`case ${index}: ${JSON.stringify(testCase)}\n${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  })
}

const withoutStats = (result: SolveResult): unknown => ('stats' in result ? { ...result, stats: undefined } : result)

function expectResultProperties({ problem, settings }: OracleCase): SolveResult {
  const result = solveSync(problem, settings)
  if (result.status === 'ok') {
    expectPlanProperties(result, { problem, settings })
  } else if (result.status === 'infeasible') {
    expect(result.reasons.length).toBeGreaterThan(0)
    for (const reason of result.reasons) {
      if (reason.code !== 'too-expensive') continue
      expect(settings.levelCap).not.toBeNull()
      // The reference plan is the uncapped plan, with the steps over the cap marked
      const reference = result.reference
      if (reference === null) throw new Error('too-expensive without a reference plan')
      expect(reference.overCap).toBe(true)
      expect(reference.summary.totalLevels).toBe(reason.uncappedTotal)
      expect(reference.plan.steps.filter((step) => step.cost.total > (settings.levelCap ?? Infinity)).map((step) => step.index)).toEqual(reason.stepsOverCap)
      if (reason.minAchievableMaxStep !== null) {
        expect(reason.minAchievableMaxStep).toBeGreaterThan(settings.levelCap ?? 0)
        expect(reason.minAchievableMaxStep).toBeLessThanOrEqual(reason.uncappedMaxStep)
      }
    }
    for (let i = 1; i < result.suggestions.length; i++) expect(result.suggestions[i - 1].totalLevels).toBeLessThanOrEqual(result.suggestions[i].totalLevels)
  } else {
    expect(result.status).not.toBe('invalid')
  }
  return result
}

describe.each(EDITIONS)('plan properties through solveSync (%s)', (edition) => {
  it('hold for every generated result, including problems larger than the oracle can check', () => {
    const cases = [
      ...sampleOracleCases(150, SEED, { editions: [edition], minInputs: 6, maxInputs: 9 }),
      ...sample(pipelineCaseArb({ editions: [edition], maxBooks: 9 }), 150, SEED + 1),
      ...sample(expensiveCaseArb({ editions: [edition], maxInputs: 9 }), 100, SEED + 2),
    ]
    let keeps = 0
    forEachCase(cases, (testCase) => {
      const result = expectResultProperties(testCase)
      // Deterministic down to plans, warnings and diagnoses
      expect(withoutStats(solveSync(testCase.problem, testCase.settings))).toEqual(withoutStats(result))
      // keep equals a re-solve with the discarded enchantments added to the goal
      if (result.status !== 'ok' || testCase.problem.mode !== 'advanced' || testCase.problem.goal === null) return
      const keep = warningOf(result, 'enchantments-discarded')?.keep
      if (keep == null) return
      keeps++
      const goal: EnchantLevels = { ...testCase.problem.goal }
      for (const [id, level] of levelEntries(keep.enchantments)) goal[id] = Math.max(goal[id] ?? 0, level)
      const fresh = expectOk(solveSync({ ...testCase.problem, goal }, testCase.settings))
      expect([keep.totalLevels, keep.maxStepLevels]).toEqual([fresh.summary.totalLevels, fresh.summary.maxStepLevels])
    })
    expect(keeps).toBeGreaterThan(5)
  }, 120_000)

  it('never raises the optimal total when the goal is lowered or the cap removed', () => {
    const cases = sample(pipelineCaseArb({ editions: [edition], maxBooks: 8 }), 200, SEED + 3)
      .filter((testCase): testCase is OracleCase & { problem: AdvancedProblem } => testCase.problem.mode === 'advanced' && testCase.problem.goal !== null)
    let compared = 0
    forEachCase(cases, ({ problem, settings }) => {
      const levels: Settings = { ...settings, objective: 'levels' }
      const needed = { ...problem, useOnlyNeeded: true }
      const total = (result: SolveResult): number | null => (result.status === 'ok' ? result.summary.totalLevels : null)
      const high = total(solveSync(needed, levels))
      // Lower each goal enchantment by one level in turn, removing it at level 1
      for (const [id, level] of levelEntries(needed.goal ?? {})) {
        const lowered: EnchantLevels = { ...needed.goal }
        if (level > 1) lowered[id] = level - 1
        else delete lowered[id]
        const low = total(solveSync({ ...needed, goal: lowered }, levels))
        if (high !== null) {
          if (low === null) throw new Error(`a lower goal ${JSON.stringify(lowered)} became infeasible`)
          expect(low).toBeLessThanOrEqual(high)
          compared++
        }
      }
      const capped = total(solveSync(needed, { ...levels, levelCap: 39 }))
      const uncapped = total(solveSync(needed, { ...levels, levelCap: null }))
      if (capped !== null) {
        if (uncapped === null) throw new Error('removing the cap made the problem infeasible')
        expect(uncapped).toBeLessThanOrEqual(capped)
      }
    })
    expect(compared).toBeGreaterThan(100)
  }, 120_000)
})

describe('edition equivalence', () => {
  it('gives equal totals in Java and Bedrock for additive problems without Impaling', () => {
    const cases = sample(additiveCaseArb({ editions: ['java'], maxBooks: 8 }), 300, SEED + 4)
    let compared = 0
    forEachCase(cases, ({ problem, settings }) => {
      const bedrock: Settings = { ...settings, edition: 'bedrock' }
      if (validateProblem(problem, bedrock).length > 0) return   // an enchantment or item missing from one edition
      const additive = (s: Settings) => checkAdditive(normalizeProblem(problem, s), s).eligible
      if (!additive(settings) || !additive(bedrock)) return
      const npJava = normalizeProblem(problem, settings)
      if (npJava.inputs.some((input) => input.enchantments.impaling !== undefined)) return
      for (const levelCap of [null, 39] as const) {
        const java = solveSync(problem, { ...settings, levelCap })
        const other = solveSync(problem, { ...bedrock, levelCap })
        expect(other.status).toBe(java.status)
        if (java.status === 'ok' && other.status === 'ok') expect(other.summary.totalLevels).toBe(java.summary.totalLevels)
      }
      compared++
    })
    expect(compared).toBeGreaterThan(150)
  }, 120_000)
})
