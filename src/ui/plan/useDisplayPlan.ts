import type { SolveOutcome } from '../solver/types.ts'
import type { BuiltProblemView, InputView } from './builtProblem.ts'
import { displayPlanFromResult, type DisplayPlan } from './displayPlan.ts'

export interface DisplayPlanView {
  readonly plan: DisplayPlan | null
  /** The engine result was ok but inconsistent, so no plan could be built */
  readonly failed: boolean
}

const NONE: DisplayPlanView = { plan: null, failed: false }
const FAILED: DisplayPlanView = { plan: null, failed: true }

// The outcome object stays the same until the result changes, so every reader shares one plan.
const cache = new WeakMap<SolveOutcome, DisplayPlanView>()

export function builtOf(outcome: SolveOutcome | null): BuiltProblemView | null {
  return outcome?.kind === 'result' ? outcome.built : null
}

export function inputOf(outcome: SolveOutcome | null): InputView | null {
  return outcome?.kind === 'result' ? outcome.input : null
}

export function displayPlanOf(outcome: SolveOutcome | null): DisplayPlanView {
  if (outcome === null || outcome.kind !== 'result' || outcome.result.status !== 'ok') return NONE
  let view = cache.get(outcome)
  if (view === undefined) {
    try {
      view = {
        plan: displayPlanFromResult(outcome.result, outcome.problem, outcome.settings, {
          built: builtOf(outcome),
          input: inputOf(outcome),
        }),
        failed: false,
      }
    } catch (error) {
      console.error('Failed to build the display plan', error)
      view = FAILED
    }
    cache.set(outcome, view)
  }
  return view
}

export function useDisplayPlan(outcome: SolveOutcome | null): DisplayPlanView {
  return displayPlanOf(outcome)
}
