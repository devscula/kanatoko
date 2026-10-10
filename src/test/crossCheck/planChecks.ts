// Steps are replayed with rules.combine and rules.renameOnly rather than trusting the values from planBuilder or the search.

import { isApplicable, isItemInEdition, multiplier } from '../../data/gameData.ts'
import type { EnchantmentId } from '../../data/types.ts'
import { normalizeProblem } from '../../engine/normalize.ts'
import { anvilObjectOf, combine, levelEntries, renameOnly, type AnvilObject } from '../../engine/rules.ts'
import {
  OBJECTIVE_KEYS,
  type EnchantLevels,
  type KeyVector,
  type NormalizedProblem,
  type ObjectState,
  type ObjRef,
  type Objective,
  type Plan,
  type PlanSummary,
  type Problem,
  type Settings,
  type SolveOk,
  type SolveResult,
  type Warning,
} from '../../engine/types.ts'
import { xpAtLevel } from '../../engine/xp.ts'
import { GAME_DATA } from '../../data/gameData.generated.ts'

export function expectOk(result: SolveResult): SolveOk {
  if (result.status !== 'ok') throw new Error(`expected status 'ok', got ${JSON.stringify(result).slice(0, 2000)}`)
  return result
}

export function keyVectorOf(result: SolveOk, objective: Objective): KeyVector {
  const values = {
    totalLevels: result.summary.totalLevels,
    maxStepLevels: result.summary.maxStepLevels,
    xpPoints: result.summary.xpPoints,
    finalPriorWorkPenalty: result.summary.finalPriorWorkPenalty,
    inputsUsed: result.plan.usedInputs.length,
  }
  const [a, b, c, d, e] = OBJECTIVE_KEYS[objective]
  return [values[a], values[b], values[c], values[d], values[e]]
}

export function scenarioValues(result: SolveResult): [number, number, number, number] {
  const { summary } = expectOk(result)
  return [summary.totalLevels, summary.maxStepLevels, summary.xpPoints, summary.finalPriorWorkPenalty]
}

export function warningOf<C extends Warning['code']>(result: { readonly warnings: readonly Warning[] }, code: C): Extract<Warning, { code: C }> | undefined {
  return result.warnings.find((warning): warning is Extract<Warning, { code: C }> => warning.code === code)
}

export function levelsOfState(state: ObjectState): EnchantLevels {
  const levels: EnchantLevels = {}
  for (const { id, level } of state.enchantments) levels[id] = level
  return levels
}

export function meetsLevels(levels: EnchantLevels, required: EnchantLevels): boolean {
  return levelEntries(required).every(([id, level]) => (levels[id] ?? 0) >= level)
}

/** Written independently of the engine, so the two can be compared. */
function stateOf(obj: AnvilObject): ObjectState {
  return {
    kind: obj.kind,
    itemType: obj.itemType,
    enchantments: levelEntries(obj.enchantments).map(([id, level]) => ({ id, level })),
    anvilUses: obj.anvilUses,
    priorWorkPenalty: 2 ** obj.anvilUses - 1,
    named: obj.named,
  }
}

export interface PlanCheckContext {
  readonly problem: Problem
  readonly settings: Settings
  /** The SolveOptions.levelCapOverride the result was solved with, if any. */
  readonly levelCap?: number | null
}

/** Checks everything that does not need the oracle, and returns the final object as rules.ts computes it. */
export function expectPlanProperties(result: SolveOk, context: PlanCheckContext): AnvilObject {
  const { settings } = context
  const levelCap = context.levelCap === undefined ? settings.levelCap : context.levelCap
  const np = normalizeProblem(context.problem, settings)
  const { plan, summary } = result

  const final = expectReplay(plan, np, settings, levelCap)
  expectSummary(plan, summary, final)
  expectReferences(plan, np)

  if (levelCap !== null) {
    for (const step of plan.steps) {
      expect(step.cost.total).toBeLessThanOrEqual(levelCap)
      if (levelCap < 40) expect(step.tooExpensive).toBe(false)
    }
  }
  expect(final.kind).toBe(np.targetIndex === null ? 'book' : 'item')
  expect(final.named).toBe(settings.rename)
  if (np.goal !== null) expect(meetsLevels(final.enchantments, np.goal)).toBe(true)
  const all = np.inputs.map((_, i) => i)
  expect([...plan.usedInputs, ...plan.unusedInputs].sort((a, b) => a - b)).toEqual(all)
  expect(plan.usedInputs.length).toBeGreaterThan(0)
  if (np.targetIndex !== null) expect(plan.usedInputs).toContain(np.targetIndex)
  if (!np.useOnlyNeeded) expect(plan.unusedInputs).toEqual([])

  expectDiscards(result, np)
  expectBaseline(result, settings)
  expectBookApplyCost(result, np, settings)
  expectPlanWarnings(result, np, levelCap)
  return final
}

function expectReplay(plan: Plan, np: NormalizedProblem, settings: Settings, levelCap: number | null): AnvilObject {
  const products: AnvilObject[] = []
  const objectAt = (ref: ObjRef): AnvilObject => {
    if (ref.kind === 'input') return anvilObjectOf(np.inputs[ref.input])
    const product = products[ref.step - 1]
    if (product === undefined) throw new Error(`step refers to step ${ref.step}, which is not earlier`)
    return product
  }
  let cumulative = 0
  plan.steps.forEach((step, i) => {
    expect(step.index).toBe(i + 1)
    const left = objectAt(step.left)
    const right = step.right === null ? null : objectAt(step.right)
    const outcome = step.kind === 'rename'
      ? renameOnly(left, { edition: settings.edition, levelCap })
      : combine(left, right ?? fail('a combine step without a right input'), { edition: settings.edition, levelCap, rename: step.cost.rename === 1 })
    if (!outcome.ok) throw new Error(`step ${step.index} is refused by rules.ts: ${outcome.reason}`)
    expect(step.cost).toEqual(outcome.breakdown)
    expect(step.before).toEqual({ left: stateOf(left), right: right === null ? null : stateOf(right) })
    expect(step.after).toEqual(stateOf(outcome.result))
    expect(step.xpPoints).toBe(xpAtLevel(outcome.cost))
    cumulative += outcome.cost
    expect(step.cumulativeLevels).toBe(cumulative)
    expect(step.tooExpensive).toBe(outcome.cost >= 40)
    // The breakdown adds up to the total, except for a capped Java rename-only step, which costs 39
    const { cost } = step
    const parts = cost.leftPenalty + cost.rightPenalty + cost.enchantments.reduce((sum, line) => sum + line.cost, 0) + cost.conflictPenalty + cost.rename
    if (cost.clampedFrom === null) expect(cost.total).toBe(parts)
    else expect([cost.total, cost.clampedFrom]).toEqual([39, parts])
    products.push(outcome.result)
  })
  const final = plan.steps.length === 0 ? objectAt(plan.finalRef) : products[products.length - 1]
  expect(plan.final).toEqual(stateOf(final))
  if (plan.steps.length > 0) expect(plan.finalRef).toEqual({ kind: 'step', step: plan.steps.length })
  return final
}

function expectSummary(plan: Plan, summary: PlanSummary, final: AnvilObject): void {
  const costs = plan.steps.map((step) => step.cost.total)
  expect(summary.totalLevels).toBe(costs.reduce((a, b) => a + b, 0))
  expect(summary.maxStepLevels).toBe(Math.max(0, ...costs))
  expect(summary.xpPoints).toBe(costs.reduce((sum, cost) => sum + xpAtLevel(cost), 0))
  expect(summary.finalAnvilUses).toBe(final.anvilUses)
  expect(summary.finalPriorWorkPenalty).toBe(2 ** final.anvilUses - 1)
  expect(summary.anvilOperations).toBe(plan.steps.length)
  expect(levelEntries(summary.finalEnchantments)).toEqual(levelEntries(final.enchantments))
}

/** Every product but the last is used exactly once, only earlier steps are referenced, and the left chain starts at the base. */
function expectReferences(plan: Plan, np: NormalizedProblem): void {
  const consumers = new Map<number, number[]>()
  const usedInputs: number[] = []
  plan.steps.forEach((step) => {
    for (const ref of step.right === null ? [step.left] : [step.left, step.right]) {
      if (ref.kind === 'step') {
        expect(ref.step).toBeLessThan(step.index)
        consumers.set(ref.step, [...(consumers.get(ref.step) ?? []), step.index])
      } else {
        usedInputs.push(ref.input)
      }
    }
  })
  plan.steps.forEach((step) => {
    const users = consumers.get(step.index) ?? []
    if (step.index === plan.steps.length) {
      expect(users).toEqual([])
      expect(step.consumedBy).toBeNull()
    } else {
      expect(users).toEqual([step.consumedBy])
    }
  })
  if (plan.steps.length === 0) {
    expect(plan.finalRef).toEqual({ kind: 'input', input: plan.usedInputs[0] })
    expect(plan.usedInputs).toHaveLength(1)
    return
  }
  expect([...usedInputs].sort((a, b) => a - b)).toEqual(plan.usedInputs)
  // Following left inputs back from the final object leads to the base (the target, or a book with books only)
  let ref: ObjRef = { kind: 'step', step: plan.steps.length }
  while (ref.kind === 'step') ref = plan.steps[ref.step - 1].left
  if (np.targetIndex !== null) expect(ref.input).toBe(np.targetIndex)
}

/** enchantments-discarded lists exactly the enchantments of used inputs that end lower on the final object, each blocked in some step. */
function expectDiscards(result: SolveOk, np: NormalizedProblem): void {
  const final = result.summary.finalEnchantments
  const lowered = new Map<EnchantmentId, number>()
  for (const index of result.plan.usedInputs) {
    for (const [id, level] of levelEntries(np.inputs[index].enchantments)) {
      if (level > (final[id] ?? 0)) lowered.set(id, Math.max(lowered.get(id) ?? 0, level))
    }
  }
  const warning = warningOf(result, 'enchantments-discarded')
  expect(warning === undefined).toBe(lowered.size === 0)
  if (warning === undefined) return
  expect(warning.items.map((item) => item.id).sort()).toEqual([...lowered.keys()].sort())
  for (const item of warning.items) {
    expect(item.inputLevel).toBe(lowered.get(item.id))
    expect(item.finalLevel).toBe(final[item.id] ?? 0)
    const blocked = result.plan.steps.some((step) =>
      step.cost.enchantments.some((line) => line.id === item.id && (line.outcome === 'conflict' || line.outcome === 'inapplicable')))
    expect(blocked).toBe(true)
  }
  if (np.goal === null) expect(warning.keep).toBeNull()
}

/** The baseline applies one book at a time. When comparable, it skips no input and the plan's savings are not negative. */
function expectBaseline(result: SolveOk, settings: Settings): void {
  const baseline = result.baseline
  if (baseline === null) return
  if (baseline.comparable) {
    expect(baseline.skippedInputs).toEqual([])
    expect(baseline.savedLevels).toBe(baseline.totalLevels - result.summary.totalLevels)
    expect(baseline.savedXpPoints).toBe(baseline.xpPoints - result.summary.xpPoints)
    if (settings.objective === 'levels') expect(baseline.savedLevels).toBeGreaterThanOrEqual(0)
    if (settings.objective === 'xp') expect(baseline.savedXpPoints).toBeGreaterThanOrEqual(0)
  } else {
    expect(baseline.savedLevels).toBeNull()
    expect(baseline.savedXpPoints).toBeNull()
  }
  for (const input of baseline.skippedInputs) expect(result.plan.usedInputs).toContain(input)
}

/** With books only, applyToFreshItem.cost equals applying the final book to a fresh item that accepts all its enchantments. */
function expectBookApplyCost(result: SolveOk, np: NormalizedProblem, settings: Settings): void {
  const apply = result.summary.applyToFreshItem
  if (np.targetIndex !== null) {
    expect(apply).toBeNull()
    return
  }
  if (apply === null) throw new Error('a book-only result must report applyToFreshItem')
  const final = result.summary.finalEnchantments
  const ids = levelEntries(final).map(([id]) => id)
  let expected = result.summary.finalPriorWorkPenalty
  for (const [id, level] of levelEntries(final)) expected += multiplier(settings.edition, id, 'book') * level
  expect(apply.cost).toBe(expected)
  expect(apply.tooExpensive).toBe(settings.levelCap !== null && expected > settings.levelCap)
  const accepting = GAME_DATA.items.find((item) =>
    !item.isBook && isItemInEdition(settings.edition, item.id) && ids.every((id) => isApplicable(settings.edition, item.id, id)))
  if (accepting === undefined || ids.length === 0) return
  const book: AnvilObject = { kind: 'book', itemType: null, enchantments: final, anvilUses: result.summary.finalAnvilUses, named: false }
  const fresh: AnvilObject = { kind: 'item', itemType: accepting.id, enchantments: {}, anvilUses: 0, named: false }
  const outcome = combine(fresh, book, { edition: settings.edition, levelCap: null, rename: false })
  if (!outcome.ok) throw new Error(`applying the final book to a fresh ${accepting.id} was refused: ${outcome.reason}`)
  expect(outcome.cost).toBe(apply.cost)
}

function expectPlanWarnings(result: SolveOk, np: NormalizedProblem, levelCap: number | null): void {
  const unused = warningOf(result, 'inputs-unused')
  expect(unused?.inputs ?? []).toEqual(result.plan.unusedInputs)
  const overLimit = warningOf(result, 'steps-over-survival-limit')
  const overSteps = result.plan.steps.filter((step) => step.cost.total >= 40).map((step) => step.index)
  if (levelCap === null) expect(overLimit?.steps ?? []).toEqual(overSteps)
  else expect(overLimit).toBeUndefined()
  expect(warningOf(result, 'bedrock-rules-from-wiki') !== undefined).toBe(result.assumptions.edition === 'bedrock')
  if (np.goal !== null) {
    expect(warningOf(result, 'below-reachable-level')).toBeUndefined()
    expect(warningOf(result, 'other-maximal-results')).toBeUndefined()
  }
}

function fail(message: string): never {
  throw new Error(message)
}
