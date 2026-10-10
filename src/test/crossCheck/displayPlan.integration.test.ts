import { solveSync } from '../../engine/solve.ts'
import type { Settings, SolveOk } from '../../engine/types.ts'
import { displayPlanFromResult } from '../../ui/plan/displayPlan.ts'
import { sampleOracleCases, type OracleCase } from '../oracle/generators.ts'
import { expensiveCaseArb, pipelineCaseArb, sample } from './generators.ts'

const SURVIVAL_CAP = 39
const SEED = 0x5eed_0931

function survival({ problem, settings }: OracleCase): OracleCase {
  const capped: Settings = { ...settings, levelCap: SURVIVAL_CAP }
  return { problem, settings: capped }
}

describe('display plan of Survival results never shows a step of 40 or more', () => {
  const cases = [
    ...sampleOracleCases(400, SEED),
    ...sample(pipelineCaseArb(), 150, SEED + 1),
    ...sample(expensiveCaseArb(), 150, SEED + 2),
  ].map(survival)

  it('keeps every step at or below the cap, with the engine costs and totals', () => {
    let okCount = 0
    for (const { problem, settings } of cases) {
      const result = solveSync(problem, settings)
      if (result.status !== 'ok') continue
      okCount++
      const context = JSON.stringify({ problem, settings })
      const { steps } = displayPlanFromResult(result, problem, settings)
      expect(steps.map((step) => step.no), context).toEqual(steps.map((_, i) => i + 1))
      expect(steps.every((step) => step.cost.total <= SURVIVAL_CAP && !step.tooExpensive), context).toBe(true)
      expect(steps.map((step) => step.cost.total).sort((a, b) => a - b), context).toEqual(
        (result as SolveOk).plan.steps.map((step) => step.cost.total).sort((a, b) => a - b),
      )
      expect(steps.reduce((sum, step) => sum + step.cost.total, 0), context).toBe(result.summary.totalLevels)
    }
    // Enough results were feasible for the check to mean something
    expect(okCount).toBeGreaterThan(300)
  })
})
