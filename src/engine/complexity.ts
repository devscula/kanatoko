// The UI calls this on the main thread after every edit, so it must never search or evaluate tree tables.
//
// The estimate is not a promise: a problem the tree-table method accepts can still end too-complex when it falls back to
// the exact search, and any exact search can stop at the state or time limit.

import { enchantmentUniverse } from './compile.ts'
import { checkAdditive } from './fastPath.ts'
import { LIMITS, type Limits } from './limits.ts'
import { groupInputs, normalizeProblem } from './normalize.ts'
import type { ComplexityEstimate, NormalizedProblem, Problem, Settings } from './types.ts'
import { validateProblem } from './validate.ts'

/** At this C_eff the exact search takes about 0.1 s on a desktop. */
export const INSTANT_COMPLEXITY = 40_000

/** Up to this many books the tree-table tie-break stays within its budget, even in book-only mode. */
export const INSTANT_FAST_PATH_BOOKS = 10

export type ComplexityLimits = Pick<
  Limits,
  'maxAnvilUses' | 'maxStackCount' | 'fastPathMaxBooks' | 'exactComplexitySoft' | 'exactComplexityHard' | 'exactComplexityHardUseAll' | 'exactMaxDistinctEnchantments'
>

/** An invalid problem never reaches the search, so it is 'instant' with C = 0. */
export function estimateComplexity(problem: Problem, settings: Settings, limits: ComplexityLimits = LIMITS): ComplexityEstimate {
  if (validateProblem(problem, settings, limits).length > 0) {
    const everyInputUsed = problem.mode === 'advanced' && (problem.goal === null || !problem.useOnlyNeeded)
    return { complexity: 0, effectiveComplexity: 0, fastPathEligible: false, level: 'instant', hardLimit: hardLimitOf(everyInputUsed, limits) }
  }
  return estimateNormalizedComplexity(normalizeProblem(problem, settings), settings, limits)
}

export function estimateNormalizedComplexity(np: NormalizedProblem, settings: Settings, limits: ComplexityLimits = LIMITS): ComplexityEstimate {
  const complexity = subsetComplexity(np)
  const effectiveComplexity = complexity * (settings.rename ? 2 : 1) * (settings.levelCap === null ? 2 : 1)
  const hardLimit = hardLimitOf(!(np.goal !== null && np.useOnlyNeeded), limits)
  const additive = checkAdditive(np, settings, limits)
  const fastPathEligible = additive.eligible
  const level = ((): ComplexityEstimate['level'] => {
    if (!additive.eligible && (effectiveComplexity > hardLimit || enchantmentUniverse(np).length > limits.exactMaxDistinctEnchantments)) return 'too-complex'
    if ((additive.eligible && additive.books.length <= INSTANT_FAST_PATH_BOOKS) || effectiveComplexity <= INSTANT_COMPLEXITY) return 'instant'
    return effectiveComplexity <= limits.exactComplexitySoft ? 'ok' : 'slow'
  })()
  return { complexity, effectiveComplexity, fastPathEligible, level, hardLimit }
}

/**
 * C: the number of (subset, left part) pairs the exact search enumerates. A group of c identical inputs gives
 * (c + 1)(c + 2) / 2 choices: the subset takes 0..c of them and the left part some of those. The target is always in
 * the left part, so it only doubles the count (in the subset or not).
 */
export function subsetComplexity(np: NormalizedProblem): number {
  let complexity = np.targetIndex === null ? 1 : 2
  for (const group of groupInputs(np)) {
    const count = group.inputs.length
    complexity *= ((count + 1) * (count + 2)) / 2
  }
  return complexity
}

function hardLimitOf(everyInputUsed: boolean, limits: ComplexityLimits): number {
  return everyInputUsed ? limits.exactComplexityHardUseAll : limits.exactComplexityHard
}
