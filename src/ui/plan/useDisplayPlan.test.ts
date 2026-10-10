import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SolveOk } from '../../engine/index.ts'
import { type FixtureName, getFixture } from '../dev/fixtures.ts'
import type { SolveOutcome } from '../solver/types.ts'
import { planIdOf } from '../state/buildProblem.ts'
import { displayPlanOf } from './useDisplayPlan.ts'

function outcomeOf(name: FixtureName, patch: (result: SolveOk) => SolveOk = (r) => r): SolveOutcome {
  const { problem, settings, result } = getFixture(name)
  if (result.status === 'cancelled') throw new Error('fixture is cancelled')
  // built and input are optional; without them the sources come from the engine input origins.
  return {
    kind: 'result',
    result: result.status === 'ok' ? patch(result) : result,
    problem,
    settings,
    planId: planIdOf(problem, settings),
  } as unknown as SolveOutcome
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('displayPlanOf', () => {
  it('returns the same plan for the same outcome and a new one for a new outcome', () => {
    const outcome = outcomeOf('bootsSevenBooks')
    const first = displayPlanOf(outcome)
    expect(first.failed).toBe(false)
    expect(first.plan?.steps).toHaveLength(7)
    expect(displayPlanOf(outcome)).toBe(first)
    const next = displayPlanOf(outcomeOf('bootsSevenBooks'))
    expect(next.plan).not.toBe(first.plan)
    expect(next.plan?.planId).toBe(first.plan?.planId)
  })

  it('returns no plan, without failing, when there is no ok result', () => {
    expect(displayPlanOf(null)).toEqual({ plan: null, failed: false })
    expect(displayPlanOf(outcomeOf('infeasible'))).toEqual({ plan: null, failed: false })
    expect(displayPlanOf({ kind: 'empty', reason: 'noItem' })).toEqual({ plan: null, failed: false })
  })

  it('reports failed when the engine result is inconsistent', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = outcomeOf('bootsSevenBooks', (r) => ({ ...r, plan: { ...r.plan, steps: r.plan.steps.slice(1) } }))
    const view = displayPlanOf(broken)
    expect(view).toEqual({ plan: null, failed: true })
    expect(error).toHaveBeenCalledTimes(1)
    // The failure is cached too, so it is logged only once.
    expect(displayPlanOf(broken)).toBe(view)
    expect(error).toHaveBeenCalledTimes(1)
  })
})
