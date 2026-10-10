// Whichever method found the plan tree, every step cost and state is recomputed here with the reference rules in
// rules.ts; a disagreement with the search's own values is a bug in the search, so it throws.
//
// Steps are in post-order, left subtree first, so every product is made right before the step that uses it. A rename-only
// step on the base leaf (preRename) is step 1, since that leaf is visited first.

import { isApplicable, multiplier } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { anvilObjectOf, canonicalLevels, combine, levelEntries, pwp, renameOnly, type AnvilObject, type CombineOutcome } from './rules.ts'
import type {
  DiscardedEnchantment,
  EnchantLevels,
  KeepAlternative,
  LabelSpec,
  NormalizedProblem,
  ObjectState,
  ObjRef,
  Plan,
  PlanNode,
  PlanStep,
  PlanSummary,
  Warning,
} from './types.ts'
import { stepXp } from './xp.ts'

/** levelCap may be any number: the diagnostics' binary search uses overrides of 40 and above. */
export interface PlanContext {
  readonly edition: Edition
  readonly levelCap: number | null
  readonly rename: boolean
}

/** What the search reported along with the tree; any difference from the recomputed values throws. */
export interface ExpectedPlanValues {
  readonly stepCosts?: readonly number[]     // post-order, a rename-only step included
  readonly totalLevels?: number
  readonly maxStepLevels?: number
  readonly xpPoints?: number
  readonly finalAnvilUses?: number
}

/** Always a bug in the search; it must not reach the UI. */
export class PlanBuildError extends Error {
  override name = 'PlanBuildError'
}

export function buildPlan(tree: PlanNode, np: NormalizedProblem, ctx: PlanContext, expected?: ExpectedPlanValues): Plan {
  const leaves = checkTreeShape(tree, np)
  const steps: DraftStep[] = []
  let cumulativeLevels = 0

  const pushStep = (kind: PlanStep['kind'], left: Emitted, right: Emitted | null, outcome: CombineOutcome): Emitted => {
    const index = steps.length + 1
    if (!outcome.ok) {
      const cost = outcome.cost === undefined ? '' : ` (cost ${outcome.cost})`
      throw new PlanBuildError(`step ${index} (${kind}) is refused by the anvil rules: ${outcome.reason}${cost}`)
    }
    const total = outcome.breakdown.total
    cumulativeLevels += total
    for (const used of right === null ? [left] : [left, right]) {
      if (used.ref.kind === 'step') steps[used.ref.step - 1].consumedBy = index
    }
    const resultLabel: LabelSpec = {
      t: 'product',
      step: index,
      kind: outcome.result.kind,
      itemType: outcome.result.itemType,
      targetLineage: left.lineage,
    }
    steps.push({
      index,
      kind,
      left: left.ref,
      right: right?.ref ?? null,
      leftLabel: left.label,
      rightLabel: right?.label ?? null,
      resultLabel,
      before: { left: objectState(left.obj), right: right === null ? null : objectState(right.obj) },
      after: objectState(outcome.result),
      cost: outcome.breakdown,
      xpPoints: stepXp(total),
      cumulativeLevels,
      tooExpensive: total >= TOO_EXPENSIVE_COST,
      consumedBy: null,
    })
    return { ref: { kind: 'step', step: index }, obj: outcome.result, label: resultLabel, lineage: left.lineage }
  }

  const emit = (node: PlanNode, lineage: boolean): Emitted => {
    if (node.t === 'leaf') {
      const input = np.inputs[node.input]
      const emitted: Emitted = {
        ref: { kind: 'input', input: node.input },
        obj: anvilObjectOf(input),
        label: { t: 'input', input: node.input, origin: input.origin },
        lineage,
      }
      if (!node.preRename) return emitted
      return pushStep('rename', emitted, null, renameOnly(emitted.obj, ctx))
    }
    // Left subtree first; the left child stays on its parent's lineage, the right child is off it
    const left = emit(node.left, lineage)
    const right = emit(node.right, false)
    return pushStep('combine', left, right, combine(left.obj, right.obj, { edition: ctx.edition, levelCap: ctx.levelCap, rename: node.rename }))
  }

  const root = emit(tree, true)
  const last = steps.at(-1)
  if (last !== undefined) last.resultLabel = { t: 'final' }
  if (root.obj.named !== ctx.rename) {
    throw new PlanBuildError(`the final object is ${root.obj.named ? '' : 'not '}named, but settings.rename is ${ctx.rename}`)
  }

  const used = new Set(leaves)
  const plan: Plan = {
    steps,
    final: objectState(root.obj),
    finalRef: root.ref,
    usedInputs: [...used].sort((a, b) => a - b),
    unusedInputs: np.inputs.map((_, i) => i).filter((i) => !used.has(i)),
    tree,
  }
  if (expected !== undefined) checkExpected(plan, expected)
  return plan
}

/** The lowest cost the anvil refuses as Too Expensive in survival. */
const TOO_EXPENSIVE_COST = 40

type DraftStep = { -readonly [K in keyof PlanStep]: PlanStep[K] }

interface Emitted {
  readonly ref: ObjRef
  readonly obj: AnvilObject
  readonly label: LabelSpec
  /** On the target lineage: the chain of left children from the root down to the base leaf. */
  readonly lineage: boolean
}

/** Returns the leaf inputs in in-order. */
function checkTreeShape(tree: PlanNode, np: NormalizedProblem): number[] {
  const leaves: number[] = []
  let renames = 0
  const visit = (node: PlanNode, onSpine: boolean, isBase: boolean): void => {
    if (node.t === 'leaf') {
      if (!Number.isInteger(node.input) || node.input < 0 || node.input >= np.inputs.length) {
        throw new PlanBuildError(`leaf refers to input ${node.input}, but the problem has ${np.inputs.length} inputs`)
      }
      if (leaves.includes(node.input)) throw new PlanBuildError(`input ${node.input} is used twice`)
      if (node.preRename) {
        if (!isBase) throw new PlanBuildError(`input ${node.input} has a rename-only step but is not the base leaf`)
        renames++
      }
      leaves.push(node.input)
      return
    }
    if (node.rename) {
      if (!onSpine) throw new PlanBuildError('a combine step outside the target lineage is renamed')
      renames++
    }
    visit(node.left, onSpine, isBase)
    visit(node.right, false, false)
  }
  visit(tree, true, true)
  if (renames > 1) throw new PlanBuildError(`the plan renames ${renames} times`)
  const base = leaves[0]
  if (np.targetIndex !== null && base !== np.targetIndex) {
    throw new PlanBuildError(`the base leaf is input ${base}, but the target (input ${np.targetIndex}) must be the base`)
  }
  return leaves
}

function checkExpected(plan: Plan, expected: ExpectedPlanValues): void {
  const costs = plan.steps.map((step) => step.cost.total)
  const mismatches: string[] = []
  if (expected.stepCosts !== undefined && !sameNumbers(expected.stepCosts, costs)) {
    mismatches.push(`step costs [${expected.stepCosts.join(', ')}] vs rules [${costs.join(', ')}]`)
  }
  const values = planValues(plan)
  for (const key of ['totalLevels', 'maxStepLevels', 'xpPoints', 'finalAnvilUses'] as const) {
    const value = expected[key]
    if (value !== undefined && value !== values[key]) mismatches.push(`${key} ${value} vs rules ${values[key]}`)
  }
  if (mismatches.length > 0) throw new PlanBuildError(`the search and the anvil rules disagree: ${mismatches.join('; ')}`)
}

function planValues(plan: Plan): Required<Omit<ExpectedPlanValues, 'stepCosts'>> {
  let totalLevels = 0
  let maxStepLevels = 0
  let xpPoints = 0
  for (const step of plan.steps) {
    totalLevels += step.cost.total
    maxStepLevels = Math.max(maxStepLevels, step.cost.total)
    xpPoints += step.xpPoints
  }
  return { totalLevels, maxStepLevels, xpPoints, finalAnvilUses: plan.final.anvilUses }
}

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((value, i) => value === b[i])

export function objectState(obj: AnvilObject): ObjectState {
  return {
    kind: obj.kind,
    itemType: obj.itemType,
    enchantments: levelEntries(obj.enchantments).map(([id, level]) => ({ id, level })),
    anvilUses: obj.anvilUses,
    priorWorkPenalty: pwp(obj.anvilUses),
    named: obj.named,
  }
}

export function levelsOf(state: ObjectState): EnchantLevels {
  const levels: EnchantLevels = {}
  for (const { id, level } of state.enchantments) levels[id] = level
  return levels
}

export function summarize(plan: Plan, np: NormalizedProblem, ctx: Pick<PlanContext, 'edition' | 'levelCap'>): PlanSummary {
  const values = planValues(plan)
  const finalEnchantments = levelsOf(plan.final)
  return {
    totalLevels: values.totalLevels,
    maxStepLevels: values.maxStepLevels,
    xpPoints: values.xpPoints,
    finalPriorWorkPenalty: plan.final.priorWorkPenalty,
    finalAnvilUses: plan.final.anvilUses,
    anvilOperations: plan.steps.length,
    booksRequired: booksRequired(plan, np),
    extraItemsUsed: plan.usedInputs.filter((i) => np.inputs[i].origin.source === 'extra-item'),
    finalEnchantments,
    applyToFreshItem: np.targetIndex === null ? applyToFreshItem(plan.final, ctx) : null,
  }
}

function booksRequired(plan: Plan, np: NormalizedProblem): PlanSummary['booksRequired'] {
  const groups = new Map<string, { enchantments: EnchantLevels; anvilUses: number; inputs: number[] }>()
  for (const index of plan.usedInputs) {
    const input = np.inputs[index]
    if (input.kind !== 'book') continue
    const key = `${input.anvilUses}|${levelEntries(input.enchantments).map(([id, level]) => `${id}=${level}`).join(',')}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { enchantments: canonicalLevels(input.enchantments), anvilUses: input.anvilUses, inputs: [index] })
    else group.inputs.push(index)
  }
  return [...groups.values()].map((group) => ({ ...group, count: group.inputs.length }))
}

/** The same formula in both editions: the fresh item has no enchantments, so Bedrock charges the full levels too. */
function applyToFreshItem(final: ObjectState, ctx: Pick<PlanContext, 'edition' | 'levelCap'>): NonNullable<PlanSummary['applyToFreshItem']> {
  let cost = final.priorWorkPenalty
  for (const { id, level } of final.enchantments) cost += multiplier(ctx.edition, id, 'book') * level
  return { cost, tooExpensive: ctx.levelCap !== null && cost > ctx.levelCap }
}

/**
 * Enchantments that a used input carries at a higher level than the result. A transferred enchantment never loses
 * levels, so these are exactly the ones some step blocked as conflicting or inapplicable. One that is both ('conflict'
 * in the step's cost line) is reported as 'inapplicable', since the target could never take it.
 */
export function discardedEnchantments(plan: Plan, np: NormalizedProblem, ctx: Pick<PlanContext, 'edition'>): DiscardedEnchantment[] {
  const final = levelsOf(plan.final)
  const targetType = targetItemType(np)
  const inputLevel: EnchantLevels = {}
  const carriers = new Map<EnchantmentId, number[]>()
  for (const index of plan.usedInputs) {
    for (const [id, level] of levelEntries(np.inputs[index].enchantments)) {
      if (level <= (final[id] ?? 0)) continue
      inputLevel[id] = Math.max(inputLevel[id] ?? 0, level)
      carriers.set(id, [...(carriers.get(id) ?? []), index])
    }
  }
  return levelEntries(inputLevel).map(([id, level]) => ({
    id,
    inputLevel: level,
    finalLevel: final[id] ?? 0,
    inputs: carriers.get(id) ?? [],
    reason: targetType !== null && !isApplicable(ctx.edition, targetType, id) ? 'inapplicable' : 'conflict',
  }))
}

function targetItemType(np: NormalizedProblem): ItemTypeId | null {
  return np.targetIndex === null ? null : np.inputs[np.targetIndex].itemType
}

/**
 * Warnings that follow from the plan alone, in the order of the Warning type. The rest need more than the plan and are
 * added by the caller: bedrock-rules-from-wiki, bedrock-unverified-value for no-effect-refused, other-maximal-results,
 * tie-break-partial and slow-search.
 */
export function planWarnings(
  plan: Plan,
  summary: PlanSummary,
  np: NormalizedProblem,
  ctx: Pick<PlanContext, 'edition' | 'levelCap'>,
  keep: KeepAlternative | null = null,
): Warning[] {
  const warnings: Warning[] = []
  const targetType = targetItemType(np)

  // A Bedrock step that sacrifices an item with Loyalty: its item multiplier of 2 is assumed, not documented
  if (ctx.edition === 'bedrock' && plan.steps.some((step) => step.before.right?.kind === 'item' && step.before.right.enchantments.some((e) => e.id === 'loyalty'))) {
    warnings.push({ code: 'bedrock-unverified-value', detail: 'loyalty-item-multiplier' })
  }

  if (ctx.levelCap === null) {
    const overLimit = plan.steps.filter((step) => step.tooExpensive).map((step) => step.index)
    if (overLimit.length > 0) warnings.push({ code: 'steps-over-survival-limit', steps: overLimit })
    // Real Creative mode also transfers inapplicable enchantments; this engine only removes the cap
    if (targetType !== null) {
      const inapplicable = distinctInDataOrder(
        plan.usedInputs.flatMap((i) => levelEntries(np.inputs[i].enchantments).map(([id]) => id)).filter((id) => !isApplicable(ctx.edition, targetType, id)),
      )
      if (inapplicable.length > 0) warnings.push({ code: 'creative-inapplicable-ignored', enchantments: inapplicable })
    }
  }

  if (np.goal !== null) {
    const goal = np.goal
    // Enchantments the plan added or raised that are not in the goal; the target's own enchantments do not count
    const targetLevels = np.targetIndex === null ? {} : np.inputs[np.targetIndex].enchantments
    const extra = plan.final.enchantments
      .filter(({ id, level }) => goal[id] === undefined && level > (targetLevels[id] ?? 0))
      .map(({ id }) => id)
    if (extra.length > 0) warnings.push({ code: 'result-has-extra-enchantments', enchantments: extra })
  }

  const discarded = discardedEnchantments(plan, np, ctx)
  if (discarded.length > 0) warnings.push({ code: 'enchantments-discarded', items: discarded, keep })

  if (np.goal === null) {
    const listed = new Set(discarded.map((d) => d.id))
    const items = np.eligible
      .map((id) => ({ id, level: summary.finalEnchantments[id] ?? 0, reachable: np.reachable[id] ?? 0 }))
      .filter((item) => item.level < item.reachable && !listed.has(item.id))
    if (items.length > 0) warnings.push({ code: 'below-reachable-level', items })
  }

  if (summary.applyToFreshItem?.tooExpensive === true) {
    warnings.push({ code: 'final-book-too-expensive-to-apply', cost: summary.applyToFreshItem.cost })
  }
  if (plan.unusedInputs.length > 0) warnings.push({ code: 'inputs-unused', inputs: plan.unusedInputs })
  return warnings
}

function distinctInDataOrder(ids: readonly EnchantmentId[]): EnchantmentId[] {
  const levels: EnchantLevels = {}
  for (const id of ids) levels[id] = 1
  return levelEntries(levels).map(([id]) => id)
}
