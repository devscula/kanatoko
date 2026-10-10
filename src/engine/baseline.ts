// The "one book at a time" chain: the other inputs are applied to the base (the target, or in book-only mode the
// heaviest book) one by one, heaviest first, which keeps the late steps, where the prior work penalty is largest, as
// cheap as possible. Over the inputs a plan uses it is the baseline the result is compared with; over every input it
// seeds the exact search's upper bound. It runs without a cap and skips inputs the anvil refuses for other reasons.

import { areCompatible, multiplier } from '../data/gameData.ts'
import type { Edition } from '../data/types.ts'
import { anvilObjectOf, combine, levelEntries, meetsLevels, renameOnly, type AnvilObject } from './rules.ts'
import type { Baseline, EngineInput, NormalizedProblem, PlanSummary, Settings } from './types.ts'
import { stepXp } from './xp.ts'

export function inputWeight(input: EngineInput, edition: Edition): number {
  let weight = 0
  for (const [id, level] of levelEntries(input.enchantments)) weight += multiplier(edition, id, input.kind) * level
  return weight
}

export interface OneAtATimeChain {
  readonly base: number
  readonly order: readonly number[]          // skipped inputs included
  readonly stepCosts: readonly number[]
  readonly skippedInputs: readonly number[]
  readonly final: AnvilObject
}

/** With settings.rename the first accepted step renames; if none is accepted, a rename-only step names the base. */
export function oneAtATime(np: NormalizedProblem, settings: Pick<Settings, 'edition' | 'rename'>, inputs: readonly number[]): OneAtATimeChain {
  if (inputs.length === 0) throw new Error('the one-at-a-time chain needs at least one input')
  if (np.targetIndex !== null && !inputs.includes(np.targetIndex)) throw new Error('the one-at-a-time chain must use the target')
  const weight = (i: number): number => inputWeight(np.inputs[i], settings.edition)
  const heaviestFirst = (a: number, b: number): number => weight(b) - weight(a) || a - b
  const base = np.targetIndex ?? [...inputs].sort(heaviestFirst)[0]
  const order = inputs.filter((i) => i !== base).sort(heaviestFirst)

  let current = anvilObjectOf(np.inputs[base])
  const stepCosts: number[] = []
  const skipped: number[] = []
  for (const index of order) {
    const rename = settings.rename && !current.named
    const outcome = combine(current, anvilObjectOf(np.inputs[index]), { edition: settings.edition, levelCap: null, rename })
    if (!outcome.ok) {
      skipped.push(index)
      continue
    }
    stepCosts.push(outcome.cost)
    current = outcome.result
  }
  if (settings.rename && !current.named) {
    // Without a cap, both editions accept a rename-only step
    const outcome = renameOnly(current, { edition: settings.edition, levelCap: null })
    if (!outcome.ok) throw new Error(`a rename-only step without a level cap was refused: ${outcome.reason}`)
    stepCosts.push(outcome.cost)
    current = outcome.result
  }
  return { base, order, stepCosts, skippedInputs: skipped.sort((a, b) => a - b), final: current }
}

/** levelCap is widened for SolveOptions.levelCapOverride. */
export type BaselineSettings = Pick<Settings, 'edition' | 'rename'> & { readonly levelCap: number | null }

export type BaselineComparison = Pick<PlanSummary, 'totalLevels' | 'xpPoints' | 'finalEnchantments'>

export function computeBaseline(
  np: NormalizedProblem,
  settings: BaselineSettings,
  usedInputs: readonly number[],
  plan: BaselineComparison,
): Baseline {
  const chain = oneAtATime(np, settings, usedInputs)
  const totals = chainTotals(chain.stepCosts)
  const cap = settings.levelCap
  const overCap = cap === null ? -1 : chain.stepCosts.findIndex((cost) => cost > cap)
  const firstTooExpensiveStep = overCap >= 0 ? overCap + 1 : null
  const achievesGoal = np.goal !== null ? meetsLevels(chain.final.enchantments, np.goal) : meetsLevels(chain.final.enchantments, plan.finalEnchantments)
  const comparable = chain.skippedInputs.length === 0 && achievesGoal && (!settings.rename || chain.final.named) && firstTooExpensiveStep === null
  return {
    stepCosts: chain.stepCosts,
    totalLevels: totals.totalLevels,
    maxStepLevels: totals.maxStepLevels,
    xpPoints: totals.xpPoints,
    firstTooExpensiveStep,
    skippedInputs: chain.skippedInputs,
    achievesGoal,
    comparable,
    savedLevels: comparable ? totals.totalLevels - plan.totalLevels : null,
    savedXpPoints: comparable ? totals.xpPoints - plan.xpPoints : null,
  }
}

export interface BaselineSeed {
  readonly totalLevels: number
  readonly maxStepLevels: number
  readonly xpPoints: number
  readonly finalAnvilUses: number            // the bound for objective 'finalPwp'
}

/**
 * The chain over every input the search uses, or null when it is not a valid plan for the problem: a seed that is not
 * one can prune the optimum away. Without a goal it must reach every reachable level, and no two eligible enchantments
 * on the inputs may conflict, so that the maximal result is unique.
 */
export function allInputsBaselineSeed(np: NormalizedProblem, settings: BaselineSettings): BaselineSeed | null {
  const excluded = new Set(np.excludedInputs)
  const chain = oneAtATime(np, settings, np.inputs.flatMap((_, i) => (excluded.has(i) ? [] : [i])))
  if (chain.skippedInputs.length > 0) return null
  const cap = settings.levelCap
  if (cap !== null && chain.stepCosts.some((cost) => cost > cap)) return null
  if (settings.rename && !chain.final.named) return null
  if (np.goal !== null) {
    if (!meetsLevels(chain.final.enchantments, np.goal)) return null
  } else if (!reachesEveryReachableLevel(np, chain.final) || eligibleInputsConflict(np, settings.edition)) {
    return null
  }
  return { ...chainTotals(chain.stepCosts), finalAnvilUses: chain.final.anvilUses }
}

function chainTotals(stepCosts: readonly number[]): Omit<BaselineSeed, 'finalAnvilUses'> {
  let totalLevels = 0
  let maxStepLevels = 0
  let xpPoints = 0
  for (const cost of stepCosts) {
    totalLevels += cost
    maxStepLevels = Math.max(maxStepLevels, cost)
    xpPoints += stepXp(cost)
  }
  return { totalLevels, maxStepLevels, xpPoints }
}

function reachesEveryReachableLevel(np: NormalizedProblem, final: AnvilObject): boolean {
  return np.eligible.every((id) => (final.enchantments[id] ?? 0) >= (np.reachable[id] ?? 0))
}

function eligibleInputsConflict(np: NormalizedProblem, edition: Edition): boolean {
  const eligible = new Set(np.eligible)
  const present = levelEntries(np.reachable).map(([id]) => id).filter((id) => eligible.has(id))
  return present.some((a, i) => present.slice(i + 1).some((b) => !areCompatible(edition, a, b)))
}
