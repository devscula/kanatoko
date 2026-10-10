// Lives here rather than in features because controller.ts uses it for the screen reader announcement.

import type { SolveInfeasible } from '../../engine/index.ts'

export type InfeasibleTitleKey = 'infeasible.title' | 'infeasible.titleAny'

/**
 * "Can't be made in Survival" unless the engine has ruled out the level cap as the cause. An inconclusive uncapped
 * re-solve (out of time or too many combinations) does not rule it out, since Creative might still work.
 */
export function infeasibleTitleKey(result: Pick<SolveInfeasible, 'capExcluded'>): InfeasibleTitleKey {
  return result.capExcluded ? 'infeasible.titleAny' : 'infeasible.title'
}
