// The tree-table method, after kkchengaf/Minecraft-Enchantment-Order-Calculator. It solves additive problems only, with
// the tree-shape tables (treeTables.ts) and the rearrangement inequality. It never runs the exact search itself: when the
// chosen plan exceeds the cap or the tie-break does not finish within its budget, the outcome says so and solve.ts
// decides whether to fall back to the exact search.
//
// In an additive problem every sacrifice is a book or a combined book, no enchantment level ever changes and nothing
// conflicts. So the weight of book i, w_i = sum(book multiplier * level), is paid once for each of its c_i ancestors
// whose right subtree holds it, in both editions. With h the height of a node (a leaf's height is its anvil uses):
//   step cost = pwp(h(left)) + pwp(h(right)) + sum of w_i over the books in the right subtree
//   total     = A(shape) + sum(w_i * c_i),   final prior work penalty = pwp(h(root))

import { areCompatible, isApplicable, multiplier } from '../data/gameData.ts'
import type { EnchantmentId } from '../data/types.ts'
import { LIMITS, type Limits } from './limits.ts'
import { levelEntries, pwp } from './rules.ts'
import { getTreeTable, shapesOf, type ShapeClass, type TreeMode, type TreeShape } from './treeTables.ts'
import type { EngineInput, NormalizedProblem, PlanKeys, PlanNode, Settings, SolveStats } from './types.ts'
import { xpAtLevel } from './xp.ts'

// Eligibility

/** Checked in this order; the first failure is reported. */
export type AdditiveIneligibility =
  | 'objective'
  | 'extra-items'
  | 'book-prior-work'
  | 'overlap'            // an enchantment is on more than one of the target and the used books
  | 'conflict'           // two enchantments on the target and the books (unused ones included) are mutually exclusive
  | 'inapplicable'       // a used book has an enchantment the target cannot take
  | 'rename-prior-work'  // rename is on and the target has prior work
  | 'goal'               // a goal enchantment is not on the target or on one book at the goal level or higher
  | 'too-many-books'
  | 'no-books'           // book-only mode without a book (empty and trivial problems are handled before this)

export interface AdditiveBook {
  readonly input: number
  readonly weight: number
}

export type AdditiveCheck =
  | {
      readonly eligible: true
      /** With a goal and useOnlyNeeded, only the books that carry a goal enchantment. */
      readonly books: readonly AdditiveBook[]
      /** Books without a goal enchantment; inputs left out of the search are not listed. */
      readonly droppedBooks: readonly number[]
    }
  | { readonly eligible: false; readonly because: AdditiveIneligibility }

/** Cheap enough for the main-thread estimate. Inputs left out of the search are treated as absent. */
export function checkAdditive(
  np: NormalizedProblem,
  settings: Pick<Settings, 'edition' | 'objective' | 'rename'>,
  limits: Pick<Limits, 'fastPathMaxBooks'> = LIMITS,
): AdditiveCheck {
  const { edition } = settings
  if (settings.objective !== 'levels') return ineligible('objective')

  const target = np.targetIndex === null ? null : np.inputs[np.targetIndex]
  const excluded = new Set(np.excludedInputs)
  const books: number[] = []
  for (let index = 0; index < np.inputs.length; index++) {
    if (index === np.targetIndex || excluded.has(index)) continue
    if (np.inputs[index].kind !== 'book') return ineligible('extra-items')
    books.push(index)
  }
  if (books.some((index) => np.inputs[index].anvilUses !== 0)) return ineligible('book-prior-work')

  // With a goal and useOnlyNeeded, books without a goal enchantment are dropped. That is safe only because the conflict
  // check below covers the dropped books too: a conflicting book can make a plan cheaper by blocking an expensive
  // enchantment (a Smite book that blocks Sharpness). With no conflicts, adding a book does not lower the optimal total;
  // the cross-check tests confirm this against the exact search, but it is not proven.
  const goal = np.goal === null ? null : levelEntries(np.goal)
  const used = goal !== null && np.useOnlyNeeded
    ? books.filter((index) => goal.some(([id]) => levelOf(np.inputs[index], id) > 0))
    : books
  const dropped = books.filter((index) => !used.includes(index))

  const holder = new Map<EnchantmentId, number>()
  for (const index of np.targetIndex === null ? used : [np.targetIndex, ...used]) {
    for (const [id] of levelEntries(np.inputs[index].enchantments)) {
      if (holder.has(id)) return ineligible('overlap')
      holder.set(id, index)
    }
  }

  const present = new Set<EnchantmentId>()
  np.inputs.forEach((input, index) => {
    if (!excluded.has(index)) for (const [id] of levelEntries(input.enchantments)) present.add(id)
  })
  const ids = [...present]
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) if (!areCompatible(edition, ids[i], ids[j])) return ineligible('conflict')
  }

  if (target !== null) {
    const itemType = target.itemType
    if (itemType === null) throw new Error('the target input must have an itemType')
    for (const index of used) {
      for (const [id] of levelEntries(np.inputs[index].enchantments)) if (!isApplicable(edition, itemType, id)) return ineligible('inapplicable')
    }
  }

  // A rename needs a base without prior work; in book-only mode the base is a book, and books have none at this point
  if (settings.rename && target !== null && target.anvilUses !== 0) return ineligible('rename-prior-work')

  // The overlap check leaves each goal enchantment at most one holder
  if (goal !== null) {
    for (const [id, level] of goal) {
      const index = holder.get(id)
      if (index === undefined || levelOf(np.inputs[index], id) < level) return ineligible('goal')
    }
  }

  if (used.length > limits.fastPathMaxBooks) return ineligible('too-many-books')
  if (target === null && used.length === 0) return ineligible('no-books')

  return {
    eligible: true,
    books: used.map((input) => ({ input, weight: bookWeight(edition, np.inputs[input]) })),
    droppedBooks: dropped,
  }
}

function ineligible(because: AdditiveIneligibility): AdditiveCheck {
  return { eligible: false, because }
}

function levelOf(input: EngineInput, id: EnchantmentId): number {
  return input.enchantments[id] ?? 0
}

function bookWeight(edition: Settings['edition'], book: EngineInput): number {
  let weight = 0
  for (const [id, level] of levelEntries(book.enchantments)) weight += multiplier(edition, id, 'book') * level
  return weight
}

// Optimization on weights

export interface WeightPlan {
  readonly shape: TreeShape
  /** Index into weights for each leaf in in-order; -1 for the target leaf in item mode. */
  readonly leafBooks: readonly number[]
  readonly stepCosts: readonly number[]      // post-order
  readonly totalLevels: number
  readonly maxStepLevels: number
  readonly xpPoints: number
  readonly finalPriorWorkPenalty: number
  readonly finalAnvilUses: number
}

export interface WeightSolution {
  /** T*, optimal even when the tie-break stops early. */
  readonly optimalTotal: number
  /** The evaluated plan with the smallest (max step, XP, final prior work penalty); its total is T*. */
  readonly best: WeightPlan
  /** Every plan with total T* was evaluated. */
  readonly tieBreakComplete: boolean
  readonly tieBreakEvaluations: number
  readonly classes: number
  readonly shapesAtOptimum: number
}

/**
 * Finds the minimum total and, among the plans with that total, the one with the smallest (max step, XP, final prior
 * work penalty). Ties go to the first plan in class order, then shape derivation order, then lexicographic order of the
 * leaf weights; books with equal weights go to the leaves in input order. At least one plan is evaluated whatever
 * maxEvaluations is.
 */
export function solveWeights(
  weights: readonly number[],
  mode: TreeMode,
  targetUses: number,
  maxEvaluations: number = LIMITS.tieBreakMaxEvaluations,
): WeightSolution {
  for (const weight of weights) if (!Number.isSafeInteger(weight) || weight < 0) throw new RangeError(`weights must be non-negative integers: ${weight}`)
  const itemMode = mode === 'item'
  const leaves = itemMode ? weights.length + 1 : weights.length
  if (leaves < 1) throw new RangeError('book-only mode needs at least one book')

  const table = getTreeTable(leaves, itemMode ? targetUses : 0, mode)
  // Rearrangement inequality: heavier books go to leaves with smaller contributions. assignBooks picks the actual books last
  const descending = [...weights].sort((a, b) => b - a)
  // In item mode the target's leaf (leftmost, contribution 0) takes no weight; in book-only mode that leaf holds a book too
  const skip = itemMode ? 1 : 0

  let optimalTotal = Infinity
  const totals = table.classes.map((cls) => {
    let total = cls.penaltyCost
    for (let j = 0; j < descending.length; j++) total += descending[j] * cls.contributions[j + skip]
    if (total < optimalTotal) optimalTotal = total
    return total
  })
  const atOptimum = table.classes.filter((_, index) => totals[index] === optimalTotal)

  const groups = atOptimum.map((cls) => contributionGroups(cls, descending, skip))
  let needed = 0
  atOptimum.forEach((cls, index) => {
    needed += cls.shapeCount * groups[index].assignmentsPerShape
  })
  const budget = Math.max(1, maxEvaluations)
  const { best, evaluations } = runTieBreak(atOptimum, groups, { baseHeight: itemMode ? targetUses : 0, skip, optimalTotal, maxEvaluations: budget })
  return {
    optimalTotal,
    best: {
      shape: best.shape,
      leafBooks: assignBooks(weights, best.leafWeights, itemMode),
      stepCosts: best.stepCosts,
      totalLevels: best.totalLevels,
      maxStepLevels: best.maxStepLevels,
      xpPoints: best.xpPoints,
      finalPriorWorkPenalty: best.finalPriorWorkPenalty,
      finalAnvilUses: best.finalAnvilUses,
    },
    tieBreakComplete: needed <= budget,
    tieBreakEvaluations: evaluations,
    classes: table.classes.length,
    shapesAtOptimum: atOptimum.reduce((sum, cls) => sum + cls.shapeCount, 0),
  }
}

/** A class's leaves grouped by contribution value; each group gets the multiset of weights the sorted pairing gives it. */
interface ContributionGroups {
  readonly groupOf: ReadonlyMap<number, number>
  /** Per group, the distinct weights (ascending) and how many of each are left; mutated only while enumerating assignments. */
  readonly values: readonly (readonly number[])[]
  readonly counts: readonly Int32Array[]
  /** Optimal assignments per shape (the product of the groups' multinomial coefficients); equal for every shape of the class. */
  readonly assignmentsPerShape: number
}

/** A shape laid out as steps: leaves in in-order, steps in post-order (left subtree first). */
interface FlatShape {
  readonly leafContribution: Int32Array
  /** The right subtree of step s holds the leaves [rightStart[s], end[s]) */
  readonly rightStart: Int32Array
  readonly end: Int32Array
  /** pwp(h(left)) + pwp(h(right)) of step s */
  readonly penalty: Float64Array
  readonly height: number
}

interface EvaluatedPlan extends Omit<WeightPlan, 'leafBooks'> {
  /** Weight on each leaf in in-order (0 for the target leaf in item mode). */
  readonly leafWeights: Float64Array
}

/**
 * Groups the rearrangement pairing (smallest contributions with the heaviest books) by contribution value. The optimal
 * assignments are exactly those that give each group these weights, in any order.
 */
function contributionGroups(cls: ShapeClass, descending: readonly number[], skip: number): ContributionGroups {
  const groupOf = new Map<number, number>()
  const members: number[][] = []
  descending.forEach((weight, j) => {
    const contribution = cls.contributions[j + skip]
    let group = groupOf.get(contribution)
    if (group === undefined) {
      group = members.length
      groupOf.set(contribution, group)
      members.push([])
    }
    members[group].push(weight)
  })
  const values: number[][] = []
  const counts: Int32Array[] = []
  let assignmentsPerShape = 1
  for (const weights of members) {
    const distinct = [...new Set(weights)].sort((a, b) => a - b)
    const count = Int32Array.from(distinct, (value) => weights.filter((w) => w === value).length)
    values.push(distinct)
    counts.push(count)
    assignmentsPerShape *= multinomial(count)
  }
  return { groupOf, values, counts, assignmentsPerShape }
}

interface TieBreakParams {
  /** Height of the leftmost leaf: the target's anvil uses in item mode. */
  readonly baseHeight: number
  /** Leftmost leaves without a book: 1 for the target leaf in item mode, 0 in book-only mode. */
  readonly skip: number
  readonly optimalTotal: number
  readonly maxEvaluations: number
}

function runTieBreak(
  classes: readonly ShapeClass[],
  groups: readonly ContributionGroups[],
  params: TieBreakParams,
): { readonly best: EvaluatedPlan; readonly evaluations: number } {
  const { baseHeight, skip, optimalTotal, maxEvaluations } = params
  let evaluations = 0
  let best: EvaluatedPlan | null = null

  const evaluate = (flat: FlatShape, shape: TreeShape, leafWeights: Float64Array, prefix: Float64Array, costs: Float64Array): void => {
    evaluations++
    for (let leaf = 0; leaf < leafWeights.length; leaf++) prefix[leaf + 1] = prefix[leaf] + leafWeights[leaf]
    let total = 0
    let maxStep = 0
    let xp = 0
    for (let s = 0; s < costs.length; s++) {
      const cost = flat.penalty[s] + prefix[flat.end[s]] - prefix[flat.rightStart[s]]
      costs[s] = cost
      total += cost
      if (cost > maxStep) maxStep = cost
      xp += xpAtLevel(cost)
    }
    // An assignment that keeps the rearrangement pairing totals T* whatever the shape
    if (total !== optimalTotal) throw new Error(`a rearrangement-optimal assignment totals ${total}, not ${optimalTotal}`)
    const finalPwp = pwp(flat.height)
    if (best !== null && !isBetter(maxStep, xp, finalPwp, best)) return
    best = {
      shape,
      leafWeights: leafWeights.slice(),
      stepCosts: Array.from(costs),
      totalLevels: total,
      maxStepLevels: maxStep,
      xpPoints: xp,
      finalPriorWorkPenalty: finalPwp,
      finalAnvilUses: flat.height,
    }
  }

  const evaluateShape = (shape: TreeShape, shapeGroups: ContributionGroups): void => {
    const flat = flatten(shape, baseHeight)
    const leaves = flat.leafContribution.length
    const leafGroup = new Int32Array(leaves)
    for (let leaf = skip; leaf < leaves; leaf++) {
      const group = shapeGroups.groupOf.get(flat.leafContribution[leaf])
      if (group === undefined) throw new Error('a shape does not match the contributions of its class')
      leafGroup[leaf] = group
    }
    const leafWeights = new Float64Array(leaves)
    const prefix = new Float64Array(leaves + 1)
    const costs = new Float64Array(flat.penalty.length)

    // Each in-order leaf takes the weights left in its group in ascending order, each distinct value once, so every
    // distinct assignment is visited exactly once, in lexicographic order
    const assign = (leaf: number): void => {
      if (leaf === leaves) {
        evaluate(flat, shape, leafWeights, prefix, costs)
        return
      }
      const values = shapeGroups.values[leafGroup[leaf]]
      const counts = shapeGroups.counts[leafGroup[leaf]]
      for (let v = 0; v < values.length && evaluations < maxEvaluations; v++) {
        if (counts[v] === 0) continue
        counts[v]--
        leafWeights[leaf] = values[v]
        assign(leaf + 1)
        counts[v]++
      }
    }
    assign(skip)
  }

  search: for (let index = 0; index < classes.length; index++) {
    for (const shape of shapesOf(classes[index])) {
      if (evaluations >= maxEvaluations) break search
      evaluateShape(shape, groups[index])
    }
  }
  if (best === null) throw new Error('the tie-break evaluated no plan')
  return { best, evaluations }
}

/** Strictly better only, so the earlier plan wins ties. */
function isBetter(maxStep: number, xp: number, finalPwp: number, than: EvaluatedPlan): boolean {
  if (maxStep !== than.maxStepLevels) return maxStep < than.maxStepLevels
  if (xp !== than.xpPoints) return xp < than.xpPoints
  return finalPwp < than.finalPriorWorkPenalty
}

/** Only compared with the budget, so large values may be approximate. */
function multinomial(counts: Int32Array): number {
  let result = 1
  let total = 0
  for (const count of counts) {
    for (let i = 1; i <= count; i++) {
      total++
      result = (result * total) / i
    }
  }
  return Math.round(result)
}

/** The leftmost leaf has height baseHeight (the target's anvil uses); the other leaves have height 0. */
function flatten(shape: TreeShape, baseHeight: number): FlatShape {
  const contributions: number[] = []
  const rightStart: number[] = []
  const end: number[] = []
  const penalty: number[] = []
  const walk = (node: TreeShape, rightDepth: number): number => {
    if (node.t === 'leaf') {
      const height = contributions.length === 0 ? baseHeight : 0
      contributions.push(rightDepth)
      return height
    }
    const leftHeight = walk(node.left, rightDepth)
    const start = contributions.length
    const rightHeight = walk(node.right, rightDepth + 1)
    rightStart.push(start)
    end.push(contributions.length)
    penalty.push(pwp(leftHeight) + pwp(rightHeight))
    return Math.max(leftHeight, rightHeight) + 1
  }
  const height = walk(shape, 0)
  return {
    leafContribution: Int32Array.from(contributions),
    rightStart: Int32Array.from(rightStart),
    end: Int32Array.from(end),
    penalty: Float64Array.from(penalty),
    height,
  }
}

function assignBooks(weights: readonly number[], leafWeights: Float64Array, itemMode: boolean): number[] {
  const queues = new Map<number, number[]>()
  weights.forEach((weight, index) => {
    const queue = queues.get(weight)
    if (queue === undefined) queues.set(weight, [index])
    else queue.push(index)
  })
  return Array.from(leafWeights, (weight, leaf) => {
    if (itemMode && leaf === 0) return -1
    const book = queues.get(weight)?.shift()
    if (book === undefined) throw new Error('the leaf weights do not match the book weights')
    return book
  })
}

// Plan output, rename and cap

export interface TreeTablePlan {
  readonly tree: PlanNode
  /** In planBuilder's step order; a difference from what rules.ts computes is a bug in the tree-table method. */
  readonly stepCosts: readonly number[]
  readonly keys: PlanKeys
  readonly finalAnvilUses: number
  readonly usedInputs: readonly number[]
}

export type FastPathStats = NonNullable<SolveStats['fastPath']>

/**
 * 'solved': every candidate was evaluated and the chosen plan fits the cap, so it is optimal for every 'levels' key.
 *
 * 'fallback': the exact search should take over if C_eff allows. With cause 'over-cap', every plan with the minimum
 * total exceeds the cap, so best is only a reference plan. With 'tie-break-partial', the budget ran out; if the exact
 * search does not run or aborts, bestWithinCap (its total is still optimal) is returned as 'ok' with a warning, and
 * otherwise the result is 'too-complex' with best as the reference plan. bestWithinCap can also seed the exact search's
 * bound.
 */
export type FastPathOutcome =
  | { readonly status: 'solved'; readonly plan: TreeTablePlan; readonly stats: FastPathStats }
  | {
      readonly status: 'fallback'
      readonly cause: 'over-cap' | 'tie-break-partial'
      readonly best: TreeTablePlan
      /** All evaluated plans share the total and best has the smallest max step, so this is best if it fits. */
      readonly bestWithinCap: TreeTablePlan | null
      readonly stats: FastPathStats
    }

export interface TreeTableOptions {
  readonly levelCap?: number | null          // settings.levelCap by default
  readonly limits?: Partial<Limits>
  readonly check?: AdditiveCheck             // checkAdditive for the same problem and settings, if already done
}

/** The base has no prior work here (see 'rename-prior-work'). */
const RENAME_ONLY_COST = pwp(0) + 1

export function solveTreeTable(np: NormalizedProblem, settings: Settings, opts: TreeTableOptions = {}): FastPathOutcome {
  const limits = { ...LIMITS, ...opts.limits }
  const check = opts.check ?? checkAdditive(np, settings, limits)
  if (!check.eligible) throw new Error(`the problem is not additive: ${check.because}`)

  const target = np.targetIndex === null ? null : np.inputs[np.targetIndex]
  const solution = solveWeights(
    check.books.map((book) => book.weight),
    target === null ? 'book-only' : 'item',
    target === null ? 0 : target.anvilUses,
    limits.tieBreakMaxEvaluations,
  )
  const plan = toTreeTablePlan(solution.best, check.books, np.targetIndex, settings.rename)
  const stats: FastPathStats = {
    eligible: true,
    ineligibleBecause: null,
    classes: solution.classes,
    shapesAtOptimum: solution.shapesAtOptimum,
    tieBreakEvaluations: solution.tieBreakEvaluations,
    tieBreakComplete: solution.tieBreakComplete,
  }

  // Every evaluated plan totals T* and best has the smallest max step, so if best does not fit, none of them does
  const levelCap = opts.levelCap !== undefined ? opts.levelCap : settings.levelCap
  const fits = levelCap === null || plan.keys.maxStepLevels <= levelCap
  if (solution.tieBreakComplete && fits) return { status: 'solved', plan, stats }
  return {
    status: 'fallback',
    cause: solution.tieBreakComplete ? 'over-cap' : 'tie-break-partial',
    best: plan,
    bestWithinCap: fits ? plan : null,
    stats,
  }
}

export function ineligibleFastPathStats(because: AdditiveIneligibility): FastPathStats {
  return { eligible: false, ineligibleBecause: because, classes: 0, shapesAtOptimum: 0, tieBreakEvaluations: 0, tieBreakComplete: true }
}

/**
 * With rename, a rename-only step (cost 1) is added on the base leaf. The base has no prior work, so this gives the best
 * renamed plan: every renamed plan costs at least one more level, the max step does not change, and 7 XP is the
 * smallest possible increase.
 */
function toTreeTablePlan(best: WeightPlan, books: readonly AdditiveBook[], targetIndex: number | null, rename: boolean): TreeTablePlan {
  const leafInputs = best.leafBooks.map((book) => {
    if (book >= 0) return books[book].input
    if (targetIndex === null) throw new Error('a target leaf in a book-only plan')
    return targetIndex
  })
  let leaf = 0
  const toNode = (shape: TreeShape): PlanNode => {
    if (shape.t === 'leaf') {
      const input = leafInputs[leaf]
      const preRename = rename && leaf === 0
      leaf++
      return { t: 'leaf', input, preRename }
    }
    const left = toNode(shape.left)
    return { t: 'combine', left, right: toNode(shape.right), rename: false }
  }
  const tree = toNode(best.shape)
  return {
    tree,
    stepCosts: rename ? [RENAME_ONLY_COST, ...best.stepCosts] : best.stepCosts,
    keys: {
      totalLevels: best.totalLevels + (rename ? RENAME_ONLY_COST : 0),
      maxStepLevels: rename ? Math.max(best.maxStepLevels, RENAME_ONLY_COST) : best.maxStepLevels,
      xpPoints: best.xpPoints + (rename ? xpAtLevel(RENAME_ONLY_COST) : 0),
      finalPriorWorkPenalty: best.finalPriorWorkPenalty,
      inputsUsed: leafInputs.length,
    },
    finalAnvilUses: best.finalAnvilUses,
    usedInputs: [...leafInputs].sort((a, b) => a - b),
  }
}
