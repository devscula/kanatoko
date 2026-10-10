// Sample results for component tests and for ?fixture= in src/ui/solver/placeholderBackend.ts. Each plan tree is an
// optimal order found by brute force and copied in by hand. The copy of the anvil rules below only derives the steps and
// costs from a tree, independently of src/engine/rules.ts, and never solves anything.

import { GAME_DATA } from '../../data/gameData.generated.ts'
import { areCompatible, getItem, isApplicable, maxLevel, multiplier } from '../../data/gameData.ts'
import type { EnchantmentId, ItemTypeId } from '../../data/types.ts'
import { xpAtLevel } from '../../engine/index.ts'
import type {
  Assumptions,
  Baseline,
  ComplexityEstimate,
  EnchantCostLine,
  EnchantLevels,
  EngineInput,
  LabelSpec,
  ObjectState,
  ObjRef,
  Plan,
  PlanNode,
  PlanStep,
  PlanSummary,
  Problem,
  ReferencePlan,
  Settings,
  SolveOk,
  SolveResult,
  SolveStats,
  StepCost,
  Warning,
} from '../../engine/index.ts'
import { goalOf, isBookOnlyProblem } from '../plan/displayPlan.ts'
import { listProblemInputs } from '../plan/inputs.ts'
import { buildProblem } from '../state/buildProblem.ts'
import { EXAMPLE_INPUT } from '../state/convert.ts'
import { planIdOf, stableStringify } from '../state/planId.ts'
import { DEFAULT_SESSION } from '../state/types.ts'

export const DEFAULT_SETTINGS: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }

// Copy of the anvil rules (https://minecraft.wiki/w/Anvil_mechanics)

export interface SimObject {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
  readonly named: boolean
}

export type SimOutcome =
  | { readonly ok: true; readonly cost: StepCost; readonly result: SimObject }
  | { readonly ok: false; readonly reason: 'refused' | 'too-expensive'; readonly cost?: StepCost }

export const pwp = (uses: number): number => 2 ** uses - 1

const DATA_ORDER: ReadonlyMap<EnchantmentId, number> = new Map(GAME_DATA.enchantments.map((e, i) => [e.id, i]))

function levelsInDataOrder(levels: EnchantLevels): { id: EnchantmentId; level: number }[] {
  return (Object.entries(levels) as [EnchantmentId, number | undefined][])
    .filter((e): e is [EnchantmentId, number] => typeof e[1] === 'number')
    .map(([id, level]) => ({ id, level }))
    .sort((a, b) => (DATA_ORDER.get(a.id) ?? 0) - (DATA_ORDER.get(b.id) ?? 0))
}

export function toObjectState(obj: SimObject): ObjectState {
  return {
    kind: obj.kind,
    itemType: obj.itemType,
    enchantments: levelsInDataOrder(obj.enchantments),
    anvilUses: obj.anvilUses,
    priorWorkPenalty: pwp(obj.anvilUses),
    named: obj.named,
  }
}

export function simCombine(settings: Settings, left: SimObject, right: SimObject, rename: boolean): SimOutcome {
  const edition = settings.edition
  if (left.kind === 'book' && right.kind === 'item') return { ok: false, reason: 'refused' }
  if (left.kind === 'item' && right.kind === 'item') {
    if (left.itemType !== right.itemType || left.itemType === null || !getItem(left.itemType).damageable) {
      return { ok: false, reason: 'refused' }
    }
  }
  const result: EnchantLevels = { ...left.enchantments }
  const lines: EnchantCostLine[] = []
  let enchantCost = 0
  let conflictPenalty = 0
  let applied = 0
  let rejected = 0
  let changed = 0
  for (const { id, level: r } of levelsInDataOrder(right.enchantments)) {
    const q = left.enchantments[id] ?? 0
    const conflictsWith = levelsInDataOrder(left.enchantments)
      .map((e) => e.id)
      .filter((other) => other !== id && !areCompatible(edition, id, other))
    const applicable = left.kind === 'book' || (left.itemType !== null && isApplicable(edition, left.itemType, id))
    const mult = multiplier(edition, id, right.kind)
    const base = { id, leftLevel: q, rightLevel: r, multiplier: mult, multiplierKind: right.kind, conflictsWith } as const
    if (conflictsWith.length > 0 || !applicable) {
      if (edition === 'java') conflictPenalty += conflictsWith.length
      rejected++
      lines.push({ ...base, resultLevel: q, cost: 0, outcome: conflictsWith.length > 0 ? 'conflict' : 'inapplicable' })
      continue
    }
    const level = Math.min(q === r ? r + 1 : Math.max(q, r), maxLevel(id))
    const cost = edition === 'java' ? mult * level : mult * (level - q)
    enchantCost += cost
    if (level > q) changed++
    applied++
    result[id] = level
    lines.push({ ...base, resultLevel: level, cost, outcome: q === 0 ? 'added' : level > q ? 'increased' : 'unchanged' })
  }
  if (rejected > 0 && applied === 0) return { ok: false, reason: 'refused' }
  if (edition === 'java' ? enchantCost + conflictPenalty === 0 : changed === 0) return { ok: false, reason: 'refused' }
  const total = pwp(left.anvilUses) + pwp(right.anvilUses) + enchantCost + conflictPenalty + (rename ? 1 : 0)
  const cost: StepCost = {
    leftPenalty: pwp(left.anvilUses),
    rightPenalty: pwp(right.anvilUses),
    enchantments: lines,
    conflictPenalty,
    rename: rename ? 1 : 0,
    clampedFrom: null,
    total,
  }
  if (settings.levelCap !== null && total > settings.levelCap) return { ok: false, reason: 'too-expensive', cost }
  return {
    ok: true,
    cost,
    result: {
      kind: left.kind,
      itemType: left.itemType,
      enchantments: result,
      anvilUses: Math.max(left.anvilUses, right.anvilUses) + 1,
      named: left.named || rename,
    },
  }
}

/** Java caps a rename-only step at 39; Bedrock refuses it above the level cap. */
export function simRenameOnly(settings: Settings, obj: SimObject): SimOutcome {
  const raw = pwp(obj.anvilUses) + 1
  const clamped = settings.edition === 'java' && raw > 39
  const total = clamped ? 39 : raw
  const cost: StepCost = {
    leftPenalty: pwp(obj.anvilUses),
    rightPenalty: 0,
    enchantments: [],
    conflictPenalty: 0,
    rename: 1,
    clampedFrom: clamped ? raw : null,
    total,
  }
  if (settings.edition === 'bedrock' && settings.levelCap !== null && total > settings.levelCap) {
    return { ok: false, reason: 'too-expensive', cost }
  }
  return { ok: true, cost, result: { ...obj, named: true } }
}

// Building a Plan from a tree

export const leaf = (input: number, preRename = false): PlanNode => ({ t: 'leaf', input, preRename })
export const node = (left: PlanNode, right: PlanNode, rename = false): PlanNode => ({ t: 'combine', left, right, rename })

function leftmostInput(tree: PlanNode): number {
  return tree.t === 'leaf' ? tree.input : leftmostInput(tree.left)
}

function leavesOf(tree: PlanNode): number[] {
  return tree.t === 'leaf' ? [tree.input] : [...leavesOf(tree.left), ...leavesOf(tree.right)]
}

const toSim = (input: EngineInput): SimObject => ({
  kind: input.kind,
  itemType: input.itemType,
  enchantments: input.enchantments,
  anvilUses: input.anvilUses,
  named: false,
})

export interface BuiltPlan {
  readonly plan: Plan
  readonly summary: PlanSummary
}

/**
 * Steps come in post-order, left subtree first, and a rename-only step (preRename) right before its leaf is first used.
 * Throws when the rules refuse a step, which means the sample tree is wrong.
 */
export function buildFixturePlan(problem: Problem, settings: Settings, tree: PlanNode): BuiltPlan {
  const inputs = listProblemInputs(problem)
  const baseInput = leftmostInput(tree)
  type Mutable = { -readonly [K in keyof PlanStep]: PlanStep[K] }
  const steps: Mutable[] = []
  let cumulative = 0

  interface Emitted {
    readonly ref: ObjRef
    readonly obj: SimObject
    readonly label: LabelSpec
    readonly lineage: boolean
  }

  const pushStep = (
    kind: PlanStep['kind'],
    left: Emitted,
    right: Emitted | null,
    outcome: SimOutcome,
  ): Emitted => {
    if (!outcome.ok) throw new Error(`Fixture tree has a step the anvil refuses (step ${steps.length + 1})`)
    const index = steps.length + 1
    cumulative += outcome.cost.total
    for (const used of right === null ? [left] : [left, right]) {
      if (used.ref.kind === 'step') steps[used.ref.step - 1].consumedBy = index
    }
    const lineage = left.lineage
    const label: LabelSpec = { t: 'product', step: index, kind: outcome.result.kind, itemType: outcome.result.itemType, targetLineage: lineage }
    steps.push({
      index,
      kind,
      left: left.ref,
      right: right?.ref ?? null,
      leftLabel: left.label,
      rightLabel: right?.label ?? null,
      resultLabel: label,
      before: { left: toObjectState(left.obj), right: right === null ? null : toObjectState(right.obj) },
      after: toObjectState(outcome.result),
      cost: outcome.cost,
      xpPoints: xpAtLevel(outcome.cost.total),
      cumulativeLevels: cumulative,
      tooExpensive: outcome.cost.total >= 40,
      consumedBy: null,
    })
    return { ref: { kind: 'step', step: index }, obj: outcome.result, label, lineage }
  }

  const emit = (n: PlanNode): Emitted => {
    if (n.t === 'leaf') {
      const input = inputs[n.input]
      if (input === undefined) throw new Error(`Fixture tree refers to missing input ${n.input}`)
      const emitted: Emitted = {
        ref: { kind: 'input', input: n.input },
        obj: toSim(input),
        label: { t: 'input', input: n.input, origin: input.origin },
        lineage: n.input === baseInput,
      }
      return n.preRename ? pushStep('rename', emitted, null, simRenameOnly(settings, emitted.obj)) : emitted
    }
    const left = emit(n.left)
    const right = emit(n.right)
    return pushStep('combine', left, right, simCombine(settings, left.obj, right.obj, n.rename))
  }

  const root = emit(tree)
  const last = steps.at(-1)
  if (last) last.resultLabel = { t: 'final' }

  const used = [...new Set(leavesOf(tree))].sort((a, b) => a - b)
  const unused = inputs.map((_, i) => i).filter((i) => !used.includes(i))
  const plan: Plan = {
    steps,
    final: toObjectState(root.obj),
    finalRef: root.ref,
    usedInputs: used,
    unusedInputs: unused,
    tree,
  }
  return { plan, summary: summarize(problem, settings, plan, inputs) }
}

function summarize(problem: Problem, settings: Settings, plan: Plan, inputs: readonly EngineInput[]): PlanSummary {
  const costs = plan.steps.map((s) => s.cost.total)
  const books = new Map<string, { enchantments: EnchantLevels; anvilUses: number; count: number; inputs: number[] }>()
  for (const i of plan.usedInputs) {
    const input = inputs[i]
    if (input.kind !== 'book') continue
    const key = stableStringify([input.enchantments, input.anvilUses])
    const entry = books.get(key) ?? { enchantments: input.enchantments, anvilUses: input.anvilUses, count: 0, inputs: [] }
    entry.count += 1
    entry.inputs.push(i)
    books.set(key, entry)
  }
  const finalEnchantments: EnchantLevels = {}
  for (const { id, level } of plan.final.enchantments) finalEnchantments[id] = level
  let applyToFreshItem: PlanSummary['applyToFreshItem'] = null
  if (isBookOnlyProblem(problem)) {
    const cost =
      plan.final.priorWorkPenalty +
      plan.final.enchantments.reduce((sum, e) => sum + multiplier(settings.edition, e.id, 'book') * e.level, 0)
    applyToFreshItem = { cost, tooExpensive: settings.levelCap !== null && cost > settings.levelCap }
  }
  return {
    totalLevels: costs.reduce((a, b) => a + b, 0),
    maxStepLevels: costs.length === 0 ? 0 : Math.max(...costs),
    xpPoints: plan.steps.reduce((sum, s) => sum + s.xpPoints, 0),
    finalPriorWorkPenalty: plan.final.priorWorkPenalty,
    finalAnvilUses: plan.final.anvilUses,
    anvilOperations: plan.steps.length,
    booksRequired: [...books.values()],
    extraItemsUsed: plan.usedInputs.filter((i) => inputs[i].origin.source === 'extra-item'),
    finalEnchantments,
    applyToFreshItem,
  }
}

// Baseline: one book at a time

function inputWeight(settings: Settings, input: EngineInput): number {
  return levelsInDataOrder(input.enchantments).reduce((sum, e) => sum + multiplier(settings.edition, e.id, input.kind) * e.level, 0)
}

export function fixtureBaseline(problem: Problem, settings: Settings, built: BuiltPlan): Baseline {
  const inputs = listProblemInputs(problem)
  const used = built.plan.usedInputs
  const byWeight = (a: number, b: number) => inputWeight(settings, inputs[b]) - inputWeight(settings, inputs[a]) || a - b
  const hasTarget = !isBookOnlyProblem(problem)
  const base = hasTarget ? 0 : [...used].sort(byWeight)[0]
  const others = used.filter((i) => i !== base).sort(byWeight)
  const uncapped: Settings = { ...settings, levelCap: null }

  let current = toSim(inputs[base])
  const stepCosts: number[] = []
  const skippedInputs: number[] = []
  for (const i of others) {
    const outcome = simCombine(uncapped, current, toSim(inputs[i]), settings.rename && stepCosts.length === 0)
    if (!outcome.ok) {
      skippedInputs.push(i)
      continue
    }
    stepCosts.push(outcome.cost.total)
    current = outcome.result
  }
  const totalLevels = stepCosts.reduce((a, b) => a + b, 0)
  const xpPoints = stepCosts.reduce((a, c) => a + xpAtLevel(c), 0)
  const over = settings.levelCap === null ? -1 : stepCosts.findIndex((c) => c >= 40)
  const firstTooExpensiveStep = over >= 0 ? over + 1 : null
  const goal = goalOf(problem)
  const finalLevels = built.summary.finalEnchantments
  const achievesGoal =
    goal !== null
      ? levelsInDataOrder(goal).every((g) => (current.enchantments[g.id] ?? 0) >= g.level)
      : levelsInDataOrder(finalLevels).every((f) => (current.enchantments[f.id] ?? 0) >= f.level)
  const comparable =
    skippedInputs.length === 0 && achievesGoal && (!settings.rename || current.named) && firstTooExpensiveStep === null
  return {
    stepCosts,
    totalLevels,
    maxStepLevels: stepCosts.length === 0 ? 0 : Math.max(...stepCosts),
    xpPoints,
    firstTooExpensiveStep,
    skippedInputs,
    achievesGoal,
    comparable,
    savedLevels: comparable ? totalLevels - built.summary.totalLevels : null,
    savedXpPoints: comparable ? xpPoints - built.summary.xpPoints : null,
  }
}

// Assembling a SolveResult

export function fixtureAssumptions(settings: Settings): Assumptions {
  return {
    edition: settings.edition,
    levelCap: settings.levelCap,
    objective: settings.objective,
    rulesBasis: settings.edition === 'java' ? 'java-26.3-code' : 'bedrock-26.5x-wiki',
    dataVersion: GAME_DATA.version,
    fullDurability: true,
    xpAssumption: 'exact-levels-per-step',
  }
}

const TREE_TABLE_STATS: SolveStats = {
  elapsedMs: 3,
  fastPath: { eligible: true, ineligibleBecause: null, classes: 5, shapesAtOptimum: 12, tieBreakEvaluations: 1584, tieBreakComplete: true },
  exact: null,
  diagnosticsMs: null,
}

const EXACT_STATS: SolveStats = {
  elapsedMs: 12,
  fastPath: { eligible: false, ineligibleBecause: 'overlap', classes: 0, shapesAtOptimum: 0, tieBreakEvaluations: 0, tieBreakComplete: true },
  exact: { complexity: 486, subsets: 64, states: 212, transitions: 1840, prunedByBound: 96 },
  diagnosticsMs: 4,
}

function editionWarnings(settings: Settings): Warning[] {
  return settings.edition === 'bedrock' ? [{ code: 'bedrock-rules-from-wiki' }] : []
}

export function fixtureOk(
  problem: Problem,
  settings: Settings,
  tree: PlanNode,
  options: { readonly method?: SolveOk['method']; readonly warnings?: readonly Warning[]; readonly stats?: SolveStats } = {},
): SolveOk {
  const built = buildFixturePlan(problem, settings, tree)
  const overCap = built.plan.steps.filter((s) => s.tooExpensive).map((s) => s.index)
  const warnings: Warning[] = [...editionWarnings(settings), ...(options.warnings ?? [])]
  if (settings.levelCap === null && overCap.length > 0 && !warnings.some((w) => w.code === 'steps-over-survival-limit')) {
    warnings.push({ code: 'steps-over-survival-limit', steps: overCap })
  }
  if (built.plan.unusedInputs.length > 0 && !warnings.some((w) => w.code === 'inputs-unused')) {
    warnings.push({ code: 'inputs-unused', inputs: built.plan.unusedInputs })
  }
  if (built.summary.applyToFreshItem?.tooExpensive) {
    warnings.push({ code: 'final-book-too-expensive-to-apply', cost: built.summary.applyToFreshItem.cost })
  }
  return {
    status: 'ok',
    method: options.method ?? 'tree-table',
    plan: built.plan,
    summary: built.summary,
    baseline: fixtureBaseline(problem, settings, built),
    assumptions: fixtureAssumptions(settings),
    warnings,
    stats: options.stats ?? TREE_TABLE_STATS,
  }
}

export function fixtureReference(problem: Problem, settings: Settings, tree: PlanNode): ReferencePlan {
  const built = buildFixturePlan(problem, { ...settings, levelCap: null }, tree)
  return { plan: built.plan, summary: built.summary, overCap: true }
}

// Fixtures

export type FixtureName =
  | 'bootsSevenBooks'
  | 'bootsRename'
  | 'bootsBedrock'
  | 'bookOnly'
  | 'advancedUnused'
  | 'advancedRename'
  | 'infeasible'
  | 'creative40'
  | 'tooComplex'
  | 'invalid'
  | 'empty'

export interface Fixture {
  readonly name: FixtureName
  readonly problem: Problem
  readonly settings: Settings
  readonly result: SolveResult
  /** Returned by the placeholder backend's estimateComplexity. */
  readonly estimate: ComplexityEstimate
}

/**
 * The shared example: new boots and seven max-level books.
 * Inputs, in the tooltip order buildProblem sorts them into: 0 boots, 1 Protection IV, 2 Feather Falling IV, 3 Soul Speed III,
 * 4 Depth Strider III, 5 Thorns III, 6 Unbreaking III, 7 Mending.
 * Tree: (((boots + Thorns) + (Soul Speed + Mending)) + (Depth Strider + Protection)) + (Feather Falling + Unbreaking)
 * Step costs in display order are 2, 4, 3, 12, 16, 14, 15: 66 levels in total, 16 at most, 1,246 experience points and a final
 * prior work penalty of 15.
 */
export const BOOTS_PROBLEM: Problem = buildProblem(EXAMPLE_INPUT, DEFAULT_SESSION)!.problem
export const BOOTS_TREE: PlanNode = node(node(node(node(leaf(0), leaf(5)), node(leaf(3), leaf(7))), node(leaf(4), leaf(1))), node(leaf(2), leaf(6)))
/** With rename: a 1-level rename-only step on the new boots comes first, for 67 levels over 8 steps. */
const BOOTS_RENAME_TREE: PlanNode = node(node(node(node(leaf(0, true), leaf(5)), node(leaf(3), leaf(7))), node(leaf(4), leaf(1))), node(leaf(2), leaf(6)))

/**
 * Books only: the seven books of the shared example merged into one, for 49 levels in total, 12 at most, 793 experience points
 * and a prior work penalty of 15. Applying the merged book then costs 58, which is too expensive.
 * Inputs: 0 Protection IV, 1 Feather Falling IV, 2 Soul Speed III, 3 Depth Strider III, 4 Thorns III, 5 Unbreaking III, 6 Mending.
 * Tree (optimal by brute force): (((Thorns + Soul Speed) + (Depth Strider + Mending)) + (Feather Falling + Unbreaking)) + Protection
 */
export const BOOK_ONLY_PROBLEM: Problem = buildProblem({ ...EXAMPLE_INPUT, item: 'enchanted_book' }, DEFAULT_SESSION)!.problem
const BOOK_ONLY_TREE: PlanNode = node(node(node(node(leaf(4), leaf(2)), node(leaf(3), leaf(6))), node(leaf(1), leaf(5))), leaf(0))

/**
 * Advanced mode: a pickaxe with Efficiency IV and Unbreaking III and 2 anvil uses, plus five books.
 * Inputs: 0 pickaxe, 1 book (Efficiency IV), 2 book (Mending), 3 book (Fortune III), 4 book (Silk Touch), 5 book (Unbreaking II).
 * Tree: (pickaxe + (Fortune III + Mending)) + Efficiency IV, for 26 levels in total, 12 at most, 448 experience points and a
 * final prior work penalty of 15. Inputs 4 and 5 go unused.
 */
export const ADVANCED_PROBLEM: Problem = {
  mode: 'advanced',
  target: { itemType: 'pickaxe', enchantments: { efficiency: 4, unbreaking: 3 }, anvilUses: 2 },
  extraItems: [],
  books: [
    { enchantments: { efficiency: 4 }, anvilUses: 0 },
    { enchantments: { mending: 1 }, anvilUses: 0 },
    { enchantments: { fortune: 3 }, anvilUses: 0 },
    { enchantments: { silk_touch: 1 }, anvilUses: 0 },
    { enchantments: { unbreaking: 2 }, anvilUses: 0 },
  ],
  goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
  useOnlyNeeded: true,
}
const ADVANCED_TREE: PlanNode = node(node(leaf(0), node(leaf(3), leaf(2))), leaf(1))
/** With rename: the name is typed in the last step (+1, 27 in total). */
const ADVANCED_RENAME_TREE: PlanNode = node(node(leaf(0), node(leaf(3), leaf(2))), leaf(1), true)

/**
 * Infeasible: a pickaxe with Unbreaking III and 5 anvil uses (prior work penalty 31), plus books with Efficiency V, Fortune III
 * and Mending. Inputs: 0 pickaxe, 1 Efficiency V, 2 Fortune III, 3 Mending.
 * Optimal without a level cap (by brute force): pickaxe + ((Fortune III + Efficiency V) + Mending), 55 in total and 47 at most.
 * Dropping Fortune gives 41 in total and 39 at most.
 */
export const INFEASIBLE_PROBLEM: Problem = {
  mode: 'advanced',
  target: { itemType: 'pickaxe', enchantments: { unbreaking: 3 }, anvilUses: 5 },
  extraItems: [],
  books: [
    { enchantments: { efficiency: 5 }, anvilUses: 0 },
    { enchantments: { fortune: 3 }, anvilUses: 0 },
    { enchantments: { mending: 1 }, anvilUses: 0 },
  ],
  goal: { efficiency: 5, fortune: 3, unbreaking: 3, mending: 1 },
  useOnlyNeeded: true,
}
const INFEASIBLE_TREE: PlanNode = node(leaf(0), node(node(leaf(2), leaf(1)), leaf(3)))

/** Too many combinations: a sword and 13 books, several with more than one enchantment, and no goal (use everything). */
export const TOO_COMPLEX_PROBLEM: Problem = {
  mode: 'advanced',
  target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
  extraItems: [],
  books: [
    { enchantments: { sharpness: 4, looting: 2 }, anvilUses: 0 },
    { enchantments: { sharpness: 4 }, anvilUses: 1 },
    { enchantments: { looting: 3, unbreaking: 1 }, anvilUses: 0 },
    { enchantments: { unbreaking: 2, mending: 1 }, anvilUses: 0 },
    { enchantments: { fire_aspect: 1 }, anvilUses: 0 },
    { enchantments: { fire_aspect: 2, knockback: 1 }, anvilUses: 1 },
    { enchantments: { knockback: 2 }, anvilUses: 0 },
    { enchantments: { sweeping_edge: 2 }, anvilUses: 0 },
    { enchantments: { sweeping_edge: 3, unbreaking: 3 }, anvilUses: 1 },
    { enchantments: { looting: 1 }, anvilUses: 0 },
    { enchantments: { sharpness: 3, fire_aspect: 1 }, anvilUses: 0 },
    { enchantments: { mending: 1 }, anvilUses: 1 },
    { enchantments: { unbreaking: 1 }, anvilUses: 0 },
  ],
  goal: null,
  useOnlyNeeded: false,
}

/** Invalid input: boots with Efficiency V. */
export const INVALID_PROBLEM: Problem = {
  mode: 'advanced',
  target: { itemType: 'boots', enchantments: { efficiency: 5 }, anvilUses: 0 },
  extraItems: [],
  books: [{ enchantments: { mending: 1 }, anvilUses: 0 }],
  goal: null,
  useOnlyNeeded: true,
}

const estimate = (complexity: number, level: ComplexityEstimate['level'], fastPathEligible: boolean, hardLimit = 1_200_000): ComplexityEstimate => ({
  complexity,
  effectiveComplexity: complexity,
  fastPathEligible,
  level,
  hardLimit,
})

function makeFixtures(): Readonly<Record<FixtureName, Fixture>> {
  const bedrock: Settings = { ...DEFAULT_SETTINGS, edition: 'bedrock' }
  const rename: Settings = { ...DEFAULT_SETTINGS, rename: true }
  const creative: Settings = { ...DEFAULT_SETTINGS, levelCap: null }
  const tooComplexEstimate: ComplexityEstimate = {
    complexity: 2 * 3 ** 13,
    effectiveComplexity: 2 * 3 ** 13,
    fastPathEligible: false,
    level: 'too-complex',
    hardLimit: 360_000,
  }
  const fixtures: Fixture[] = [
    {
      name: 'bootsSevenBooks',
      problem: BOOTS_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: fixtureOk(BOOTS_PROBLEM, DEFAULT_SETTINGS, BOOTS_TREE),
      estimate: estimate(4374, 'instant', true),
    },
    {
      name: 'bootsRename',
      problem: BOOTS_PROBLEM,
      settings: rename,
      result: fixtureOk(BOOTS_PROBLEM, rename, BOOTS_RENAME_TREE),
      estimate: estimate(8748, 'instant', true),
    },
    {
      name: 'bootsBedrock',
      problem: BOOTS_PROBLEM,
      settings: bedrock,
      result: fixtureOk(BOOTS_PROBLEM, bedrock, BOOTS_TREE),
      estimate: estimate(4374, 'instant', true),
    },
    {
      name: 'bookOnly',
      problem: BOOK_ONLY_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: fixtureOk(BOOK_ONLY_PROBLEM, DEFAULT_SETTINGS, BOOK_ONLY_TREE),
      estimate: estimate(2187, 'instant', true),
    },
    {
      name: 'advancedUnused',
      problem: ADVANCED_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: fixtureOk(ADVANCED_PROBLEM, DEFAULT_SETTINGS, ADVANCED_TREE, { method: 'exact', stats: EXACT_STATS }),
      estimate: estimate(486, 'instant', false),
    },
    {
      name: 'advancedRename',
      problem: ADVANCED_PROBLEM,
      settings: rename,
      result: fixtureOk(ADVANCED_PROBLEM, rename, ADVANCED_RENAME_TREE, { method: 'exact', stats: EXACT_STATS }),
      estimate: estimate(972, 'instant', false),
    },
    {
      name: 'infeasible',
      problem: INFEASIBLE_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: {
        status: 'infeasible',
        reasons: [{ code: 'too-expensive', uncappedTotal: 55, uncappedMaxStep: 47, stepsOverCap: [3], minAchievableMaxStep: 47 }],
        suggestions: [{ code: 'drop-goal-enchantment', enchantment: 'fortune', totalLevels: 41, maxStepLevels: 39 }],
        suggestionsComplete: true,
        capExcluded: false,
        reference: fixtureReference(INFEASIBLE_PROBLEM, DEFAULT_SETTINGS, INFEASIBLE_TREE),
        assumptions: fixtureAssumptions(DEFAULT_SETTINGS),
        warnings: [],
        stats: { ...EXACT_STATS, diagnosticsMs: 18 },
      },
      estimate: estimate(54, 'instant', false),
    },
    {
      name: 'creative40',
      problem: INFEASIBLE_PROBLEM,
      settings: creative,
      result: fixtureOk(INFEASIBLE_PROBLEM, creative, INFEASIBLE_TREE, { method: 'exact', stats: EXACT_STATS }),
      estimate: estimate(108, 'instant', false),
    },
    {
      name: 'tooComplex',
      problem: TOO_COMPLEX_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: {
        status: 'too-complex',
        complexity: tooComplexEstimate,
        cause: 'complexity-limit',
        reference: null,
        assumptions: fixtureAssumptions(DEFAULT_SETTINGS),
        warnings: [],
        stats: { elapsedMs: 1, fastPath: null, exact: null, diagnosticsMs: null },
      },
      estimate: tooComplexEstimate,
    },
    {
      name: 'invalid',
      problem: INVALID_PROBLEM,
      settings: DEFAULT_SETTINGS,
      result: {
        status: 'invalid',
        issues: [{ code: 'not-applicable-on-item-input', enchantment: 'efficiency', where: { part: 'target' } }],
      },
      estimate: estimate(2, 'instant', false),
    },
    {
      name: 'empty',
      problem: { mode: 'advanced', target: { itemType: 'pickaxe', enchantments: {}, anvilUses: 0 }, extraItems: [], books: [], goal: null, useOnlyNeeded: true },
      settings: DEFAULT_SETTINGS,
      result: { status: 'empty' },
      estimate: estimate(2, 'instant', true),
    },
  ]
  return Object.fromEntries(fixtures.map((f) => [f.name, f])) as Record<FixtureName, Fixture>
}

let cache: Readonly<Record<FixtureName, Fixture>> | null = null

export function getFixtures(): Readonly<Record<FixtureName, Fixture>> {
  cache ??= makeFixtures()
  return cache
}

export function getFixture(name: FixtureName): Fixture {
  return getFixtures()[name]
}

/** Compared by plan ID, so input and settings must match exactly. */
export function findFixture(problem: Problem, settings: Settings): Fixture | null {
  const id = planIdOf(problem, settings)
  return Object.values(getFixtures()).find((f) => planIdOf(f.problem, f.settings) === id) ?? null
}

export function isFixtureName(value: string): value is FixtureName {
  return value in getFixtures()
}
