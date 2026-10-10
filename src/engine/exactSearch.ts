// Exact search: dynamic programming over subsets of the inputs.
//
// A state of subset S is an object that can be made from exactly the inputs in S (kind, item type, enchantment levels,
// anvil uses, named). Per state the search keeps only the sub-plan values (t, m, x) = (total levels, max step cost,
// XP points) that can still be part of an optimal plan. It tries every ordered split of S into a left and a right part and
// every pair of their states, combining them with combineCompiled. A step's cost depends only on its two input objects,
// not on how they were made, and plan values are sums and maxima over steps, so sub-plans combine independently.
//
// Identical inputs form groups, and a subset is the count used from each group in mixed radix, with the target as a
// group of one in the most significant digit. Subsets are processed by size, then by number, so every proper subset is
// final before its supersets. Left parts are tried in decreasing number; together with insertion order this decides
// between equal plans deterministically. States and values live in typed arrays, at most 200 bytes per state including
// its values.
//
// Upper bounds from the seeds and from results found on the way drop values and state pairs that cannot be optimal;
// values equal to the bound stay for the tie-break. For objective 'finalPwp' the bound is on the result's anvil uses:
// they only grow with each step, so a result built on a combination above the bound always loses on the first key.

import {
  COMBINE_OK,
  combineCompiled,
  compileProblem,
  copyPackedObject,
  createCombineOut,
  createPackedObject,
  enchantmentUniverse,
  KIND_BOOK,
  KIND_ITEM,
  levelAt,
  levelsDominate,
  meetsGoal,
  PACKED_SLOT_CAPACITY,
  packedPwp,
  REFUSAL_CODE,
  renameOnlyCompiled,
  unpackObject,
  type CompiledProblem,
  type PackedObject,
} from './compile.ts'
import { LIMITS, type Limits } from './limits.ts'
import type { AnvilObject } from './rules.ts'
import {
  OBJECTIVE_KEYS,
  type KeyVector,
  type NormalizedProblem,
  type Objective,
  type PlanKeys,
  type PlanNode,
  type Settings,
  type SolveStats,
} from './types.ts'
import { stepXp } from './xp.ts'

/** The performance tests use these work counters as machine-independent budgets. */
export type ExactStats = NonNullable<SolveStats['exact']>

/**
 * A seed must be a plan that qualifies for the problem (goal met, or a maximal result without a goal); one that does
 * not can prune the optimum away. A PlanNode, such as the tree-table plan, is replayed with the rules and ignored if it
 * does not qualify. Bare values come from a plan the caller has already checked and are used as is.
 */
export type ExactSeed = PlanNode | { readonly totalLevels: number; readonly xpPoints: number; readonly finalAnvilUses?: number }

export interface ExactSearchOptions {
  readonly levelCap?: number | null          // settings.levelCap by default
  readonly limits?: Partial<Limits>
  readonly seeds?: readonly ExactSeed[]
  /**
   * false turns off pruning by upper bounds, for cross-checks. Objective 'finalPwp' never uses the total-level and XP
   * bounds; with a goal and useOnlyNeeded it uses the bound on the result's anvil uses instead.
   */
  readonly boundPruning?: boolean
  readonly grouping?: boolean                // false keeps identical inputs ungrouped, for cross-checks
  readonly now?: () => number                // ms
}

export interface ExactPlan {
  readonly tree: PlanNode
  readonly keys: PlanKeys
  readonly final: AnvilObject
  readonly usedInputs: readonly number[]
  readonly unusedInputs: readonly number[]
}

export interface ExactOk {
  readonly status: 'ok'
  readonly plan: ExactPlan
  /**
   * Without a goal, the best plan for each other maximal level vector, ordered by key (equal keys in state creation
   * order). Empty with a goal.
   */
  readonly otherMaximal: readonly ExactPlan[]
  readonly stats: ExactStats
  readonly elapsedMs: number
}

export interface ExactNoPlan {
  readonly status: 'no-plan'
  /**
   * When every input must be used and the full set has no plan: the best plan of the largest subset that can make a
   * result (containing the target; non-empty in book-only mode), the smaller key among equal sizes. Its unusedInputs
   * become the unusable inputs of 'cannot-use-all-inputs'. null when no subset works, or with useOnlyNeeded.
   */
  readonly partial: ExactPlan | null
  /** In Bedrock that refusal is an unverified assumption (see SearchFailure.noEffectRefusals). */
  readonly noEffectRefusals: boolean
  readonly stats: ExactStats
  readonly elapsedMs: number
}

export interface ExactAborted {
  readonly status: 'aborted'
  readonly cause: 'state-limit' | 'time-limit'   // 'time-limit' covers the projected time too
  readonly stats: ExactStats
  readonly elapsedMs: number
}

export type ExactOutcome = ExactOk | ExactNoPlan | ExactAborted

/** done / total are the left parts tried so far and the complexity C. */
export interface ExactProgress {
  readonly done: number
  readonly total: number
  readonly elapsedMs: number
}

/** null where no bound is known yet. */
export interface ExactBound {
  readonly totalLevels: number | null
  readonly xpPoints: number | null
  readonly finalAnvilUses: number | null     // objective 'finalPwp' only
}

export function planKeyVector(keys: PlanKeys, objective: Objective): KeyVector {
  const [k1, k2, k3, k4, k5] = OBJECTIVE_KEYS[objective]
  return [keys[k1], keys[k2], keys[k3], keys[k4], keys[k5]]
}

export function compareKeyVectors(a: KeyVector, b: KeyVector): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

export function solveExactSync(np: NormalizedProblem, settings: Settings, options: ExactSearchOptions = {}): ExactOutcome {
  const search = new ExactSearch(np, settings, options)
  search.run(Number.POSITIVE_INFINITY)
  return search.result()
}

const NONE = -1
// How an entry was made
const FLAG_RENAME = 1       // combine step with rename (+1 level)
const FLAG_LEAF = 2         // leaf (left = group index)
const FLAG_PRE_RENAME = 4   // leaf renamed before its first use
const TIME_CHECK_INTERVAL = 512   // pairs
/** Only a safety cap: the complexity limits keep accepted problems far below it. */
const MAX_SUBSETS = 2 ** 25

const XP_TABLE = Float64Array.from({ length: 2048 }, (_, cost) => stepXp(cost))
const xpOf = (cost: number): number => (cost < XP_TABLE.length ? XP_TABLE[cost] : stepXp(cost))

const defaultNow = (): number => performance.now()

const NO_EFFECT = REFUSAL_CODE['no-effect']

/** Subset numbers are mixed radix over the groups: S = sum(count used * base). */
interface SearchGroup {
  /** Ascending; plan reconstruction assigns the used copies to leaves in this order. */
  readonly inputs: readonly number[]
  readonly base: number
  readonly radix: number
  readonly leaf: Readonly<PackedObject>
  readonly target: boolean
  /** The target, or any book in book-only mode; a base candidate also gets a renamed leaf. */
  readonly baseCandidate: boolean
}

/** A root state and one of its entries. */
interface RootChoice {
  readonly subset: number
  readonly state: number
  readonly entry: number
  readonly keys: KeyVector
}

/**
 * Callers check the number of distinct enchantments (enchantmentUniverse) and the complexity limits first; the
 * constructor throws otherwise.
 */
export class ExactSearch {
  private readonly np: NormalizedProblem
  private readonly cp: CompiledProblem
  private readonly objective: Objective
  private readonly rename: boolean
  private readonly levelCap: number | null
  private readonly limits: Limits
  private readonly now: () => number
  private readonly useOnlyNeeded: boolean
  private readonly hasTarget: boolean
  private readonly pruning: boolean
  /** Prune by the result's anvil uses (objective 'finalPwp' with a goal and useOnlyNeeded). */
  private readonly usesPruning: boolean

  private readonly groups: readonly SearchGroup[]
  /** Subsets numbered from here up contain the target; without a target it equals the subset count. */
  private readonly targetBase: number
  private readonly fullSet: number
  private readonly complexity: number
  /** By size and then by number, without the empty set. */
  private readonly order: Int32Array
  /** Subset -> its lowest non-zero digit (group), used to step back to the previous left part. */
  private readonly lowDigit: Uint8Array
  private readonly subsetSize: Uint16Array
  /** Subset -> first state and state count (processed subsets only). */
  private readonly subFirst: Int32Array
  private readonly subCount: Int32Array
  /** Subset -> minimum value over its states ('levels': t, 'xp': x) and minimum prior work penalty, to skip whole splits. */
  private readonly subMinValue: Float64Array
  private readonly subMinPwp: Float64Array
  private readonly subMinUses: Uint16Array   // only with usesPruning
  /** For the no-goal seed check: slots of the enchantments that can end up on the result, and their reachable levels. */
  private readonly eligibleSlots: readonly number[]
  private readonly reachableBySlot: Uint8Array

  private readonly store: StateStore
  private readonly leftObject = createPackedObject()
  private readonly rightObject = createPackedObject()
  private readonly scratch = createPackedObject()
  private readonly combineOut = createCombineOut()

  // Where the search stopped, so that run() can resume
  private orderPos = 0
  private subsetOpen = false
  private left = NONE
  private pairA = NONE
  private pairB = NONE

  private upperT = Number.POSITIVE_INFINITY
  private upperX = Number.POSITIVE_INFINITY
  /** Bounds for usesPruning: the fewest anvil uses of any result found (or seeded), and the lowest total among results with that many. */
  private upperUses = Number.POSITIVE_INFINITY
  private upperTAtUses = Number.POSITIVE_INFINITY
  /** With a goal, the best result so far. */
  private best: RootChoice | null = null

  private done = 1   // the empty set, which C also counts
  private doneAtSubsetStart = 0
  private activeMs = 0
  private sliceStart = 0
  private subsetsProcessed = 0
  private transitions = 0
  private prunedByBound = 0
  private noEffectRefused = false
  private abortCause: ExactAborted['cause'] | null = null
  private outcome: ExactOutcome | null = null

  constructor(np: NormalizedProblem, settings: Settings, options: ExactSearchOptions = {}) {
    this.limits = { ...LIMITS, ...options.limits }
    const distinct = enchantmentUniverse(np).length
    const maxDistinct = Math.min(this.limits.exactMaxDistinctEnchantments, PACKED_SLOT_CAPACITY)
    if (distinct > maxDistinct) {
      throw new RangeError(`${distinct} distinct enchantments exceed the exact-search limit of ${maxDistinct}`)
    }
    this.np = np
    this.cp = compileProblem(np, settings)
    this.objective = settings.objective
    this.rename = settings.rename
    this.levelCap = options.levelCap === undefined ? settings.levelCap : options.levelCap
    this.now = options.now ?? defaultNow
    this.useOnlyNeeded = np.goal !== null && np.useOnlyNeeded
    this.hasTarget = np.targetIndex !== null
    this.pruning = (options.boundPruning ?? true) && settings.objective !== 'finalPwp'
    this.usesPruning = (options.boundPruning ?? true) && settings.objective === 'finalPwp' && this.useOnlyNeeded
    this.store = new StateStore(this.limits.exactMaxStates)

    // Non-target groups (in groupInputs order) take the low digits and the target the most significant one. Inputs left
    // out of the search are in no group
    const excluded = new Set(np.excludedInputs)
    const nonTarget = options.grouping === false
      ? np.inputs.flatMap((_, index) => (index === np.targetIndex || excluded.has(index) ? [] : [{ inputs: [index] }]))
      : this.cp.groups
    const specs = [
      ...nonTarget.map((group) => ({ inputs: group.inputs, target: false })),
      ...(np.targetIndex === null ? [] : [{ inputs: [np.targetIndex], target: true }]),
    ]
    let base = 1
    let complexity = this.hasTarget ? 2 : 1
    this.groups = specs.map(({ inputs, target }) => {
      const radix = inputs.length + 1
      const leaf = this.cp.inputs[inputs[0]]
      if (leaf === null) throw new Error(`input ${inputs[0]} is left out of the search but is in a group`)
      const group: SearchGroup = {
        inputs,
        base,
        radix,
        leaf,
        target,
        baseCandidate: target || !this.hasTarget,
      }
      base *= radix
      if (!target) complexity *= (radix * (radix + 1)) / 2
      return group
    })
    const subsetCount = base
    if (subsetCount > MAX_SUBSETS) throw new RangeError(`${subsetCount} subsets are too many for the exact search`)
    this.fullSet = subsetCount - 1
    this.targetBase = this.hasTarget ? this.groups[this.groups.length - 1].base : subsetCount
    this.complexity = complexity

    // Per subset: lowest non-zero digit and size; then the processing order
    this.lowDigit = new Uint8Array(subsetCount)
    this.subsetSize = new Uint16Array(subsetCount)
    let maxSize = 0
    for (let id = 1; id < subsetCount; id++) {
      let digit = 0
      while (this.digit(id, digit) === 0) digit++
      this.lowDigit[id] = digit
      this.subsetSize[id] = this.subsetSize[id - this.groups[digit].base] + 1
      if (this.subsetSize[id] > maxSize) maxSize = this.subsetSize[id]
    }
    this.order = orderBySize(this.subsetSize, maxSize)
    this.subFirst = new Int32Array(subsetCount)
    this.subCount = new Int32Array(subsetCount)
    this.subMinValue = new Float64Array(subsetCount)
    this.subMinPwp = new Float64Array(subsetCount)
    this.subMinUses = new Uint16Array(this.usesPruning ? subsetCount : 0)

    const eligible = new Set(np.eligible)
    this.eligibleSlots = this.cp.universe.flatMap((id, slot) => (eligible.has(id) ? [slot] : []))
    this.reachableBySlot = Uint8Array.from(this.cp.universe, (id) => np.reachable[id] ?? 0)

    if (this.pruning || this.usesPruning) for (const seed of options.seeds ?? []) this.applySeed(seed)
  }

  get progress(): ExactProgress {
    return { done: this.done, total: this.complexity, elapsedMs: this.activeMs }
  }

  /** The current upper bounds, from the seeds and, with a goal and useOnlyNeeded, from results found on the way. */
  get bound(): ExactBound {
    return {
      totalLevels: this.pruning && this.objective === 'levels' && Number.isFinite(this.upperT) ? this.upperT : null,
      xpPoints: this.pruning && this.objective === 'xp' && Number.isFinite(this.upperX) ? this.upperX : null,
      finalAnvilUses: this.usesPruning && Number.isFinite(this.upperUses) ? this.upperUses : null,
    }
  }

  /** Bytes allocated by the state store's typed arrays, for the memory checks of the performance tests. */
  get storageBytes(): number {
    return this.store.byteLength()
  }

  /** Returns true once the search has finished or aborted. */
  run(sliceMs: number): boolean {
    if (this.outcome !== null) return true
    this.sliceStart = this.now()
    try {
      this.advance(this.sliceStart + sliceMs)
    } finally {
      this.activeMs += this.now() - this.sliceStart
    }
    if (this.abortCause === null && this.orderPos < this.order.length) return false
    this.outcome = this.finish()
    return true
  }

  result(): ExactOutcome {
    if (this.outcome === null) throw new Error('the exact search has not finished: call run() until it returns true')
    return this.outcome
  }

  // Main loop

  private advance(deadline: number): void {
    const store = this.store
    let countdown = TIME_CHECK_INTERVAL
    while (this.orderPos < this.order.length) {
      const subset = this.order[this.orderPos]
      if (!this.subsetOpen) {
        this.openSubset(subset)
        if (this.abortCause !== null) return
      }
      // A subset with the target is only split with the target on the left: the target is always the leftmost leaf.
      // A named object is never a right input, so renaming only pays off on the target's lineage; in book-only mode any
      // book can become the base.
      const lowestLeft = subset >= this.targetBase ? this.targetBase : 1
      const renameSplits = this.rename && (!this.hasTarget || subset >= this.targetBase)
      while (this.left >= lowestLeft) {
        const left = this.left
        const right = subset - left
        if (this.pairA === NONE) this.startSplit(left, right)
        const aEnd = this.subFirst[left] + this.subCount[left]
        const bStart = this.subFirst[right]
        const bEnd = bStart + this.subCount[right]
        let a = this.pairA
        let b = this.pairB
        for (; a < aEnd; a++, b = bStart) {
          if (b === bStart && (this.pruning ? this.leftStateCannotFit(a, right) : this.usesPruning && store.uses[a] >= this.upperUses)) {
            this.prunedByBound += bEnd - bStart
            continue
          }
          store.load(a, this.leftObject)
          const renameHere = renameSplits && store.named[a] === 0
          for (; b < bEnd; b++) {
            this.tryPair(a, b, renameHere)
            if (this.abortCause !== null) return
            if (--countdown === 0) {
              countdown = TIME_CHECK_INTERVAL
              if (this.sliceOver(deadline)) {
                this.pairA = a
                this.pairB = b + 1
                return
              }
            }
          }
        }
        this.done++
        this.left = this.previousLeft(left, subset)
        this.pairA = NONE
        if (--countdown === 0) {
          countdown = TIME_CHECK_INTERVAL
          if (this.sliceOver(deadline)) return
        }
      }
      this.closeSubset(subset)
      if (this.abortCause !== null) return
      this.orderPos++
      this.subsetOpen = false
    }
  }

  /** Also aborts the search once the time budget is spent. */
  private sliceOver(deadline: number): boolean {
    const now = this.now()
    if (this.activeMs + (now - this.sliceStart) > this.limits.exactTimeBudgetMs) {
      this.abortCause = 'time-limit'
      return true
    }
    return now >= deadline
  }

  private openSubset(subset: number): void {
    this.store.beginSubset()
    this.subFirst[subset] = this.store.count
    this.doneAtSubsetStart = this.done
    const leafGroup = this.groups.findIndex((group) => group.base === subset)
    if (leafGroup !== NONE) this.addLeaves(leafGroup)
    this.left = this.previousLeft(subset, subset)
    this.pairA = NONE
    this.subsetOpen = true
  }

  /** A base candidate also gets a renamed leaf, unless its rename-only step is refused (Bedrock, above the cap). */
  private addLeaves(groupIndex: number): void {
    const group = this.groups[groupIndex]
    const store = this.store
    const plain = this.findOrCreateState(group.leaf)
    if (plain === NONE) return
    store.appendEntry(plain, 0, 0, 0, groupIndex, NONE, FLAG_LEAF)
    if (!this.rename || !group.baseCandidate) return
    if (renameOnlyCompiled(this.cp, group.leaf, this.levelCap, this.combineOut) !== COMBINE_OK) return
    const cost = this.combineOut.cost
    if (this.pruning && this.exceedsBound(cost, xpOf(cost))) {
      this.prunedByBound++
      return
    }
    const renamed = this.findOrCreateState(this.combineOut.result)
    if (renamed === NONE) return
    store.appendEntry(renamed, cost, cost, xpOf(cost), groupIndex, NONE, FLAG_LEAF | FLAG_PRE_RENAME)
  }

  /** A mixed-radix decrement within subset. */
  private previousLeft(left: number, subset: number): number {
    if (left === 0) return NONE
    const base = this.groups[this.lowDigit[left]].base
    // Decrement the lowest non-zero digit of left and reset the digits below it to those of subset (they are 0 in left,
    // so adding subset % base does it)
    return left - base + (subset % base)
  }

  /** No pair is tried when either side has no state or the bound rules out the split. */
  private startSplit(left: number, right: number): void {
    const leftCount = this.subCount[left]
    const rightCount = this.subCount[right]
    this.pairB = this.subFirst[right]
    if (leftCount === 0 || rightCount === 0) {
      this.pairA = this.subFirst[left] + leftCount
      return
    }
    const cannotFit = this.pruning
      ? this.exceedsLowerBound(this.subMinValue[left] + this.subMinValue[right], this.subMinPwp[left] + this.subMinPwp[right] + 1)
      : this.usesPruning && Math.max(this.subMinUses[left], this.subMinUses[right]) >= this.upperUses
    if (cannotFit) {
      this.prunedByBound += leftCount * rightCount
      this.pairA = this.subFirst[left] + leftCount
      return
    }
    this.pairA = this.subFirst[left]
  }

  private leftStateCannotFit(a: number, right: number): boolean {
    return this.exceedsLowerBound(this.stateValue(a) + this.subMinValue[right], packedPwp(this.store.uses[a]) + this.subMinPwp[right] + 1)
  }

  /**
   * valueSum is the sum of t for 'levels' and of x for 'xp'. Every step costs at least both prior work penalties + 1 in
   * both editions. Values equal to the bound stay for the tie-break.
   */
  private exceedsLowerBound(valueSum: number, minCost: number): boolean {
    return this.objective === 'xp' ? valueSum + xpOf(minCost) > this.upperX : valueSum + minCost > this.upperT
  }

  private exceedsBound(t: number, x: number): boolean {
    return this.objective === 'xp' ? x > this.upperX : t > this.upperT
  }

  /** t for 'levels' and 'finalPwp' (all entries of a state share t), x for 'xp' (one entry per state). */
  private stateValue(state: number): number {
    const store = this.store
    const entry = store.head[state]
    return this.objective === 'xp' ? store.x[entry] : store.t[entry]
  }

  /** a must already be loaded into leftObject. */
  private tryPair(a: number, b: number, renameHere: boolean): void {
    const store = this.store
    if (store.named[b] === 1) return   // a named object is never a right input
    const cap = this.levelCap
    const minCost = packedPwp(store.uses[a]) + packedPwp(store.uses[b]) + 1
    if (cap !== null && minCost > cap) return   // every step costs at least this, so it would be refused
    if (this.pruning && this.exceedsLowerBound(this.stateValue(a) + this.stateValue(b), minCost)) {
      this.prunedByBound++
      return
    }
    // The product has max + 1 anvil uses; above the bound, any result built on it loses on prior work penalty
    if (this.usesPruning && Math.max(store.uses[a], store.uses[b]) >= this.upperUses) {
      this.prunedByBound++
      return
    }
    store.load(b, this.rightObject)
    this.transitions++
    const code = combineCompiled(this.cp, this.leftObject, this.rightObject, false, cap, this.combineOut)
    if (code !== COMBINE_OK) {
      if (code === NO_EFFECT) this.noEffectRefused = true
      return
    }
    const cost = this.combineOut.cost
    this.addProduct(a, b, cost, 0)
    // The renamed variant of the same step costs one more level; only the cap check can differ
    if (renameHere && (cap === null || cost + 1 <= cap) && this.abortCause === null) {
      this.combineOut.result.named = 1
      this.addProduct(a, b, cost + 1, FLAG_RENAME)
    }
  }

  private addProduct(a: number, b: number, cost: number, flags: number): void {
    const store = this.store
    const result = this.combineOut.result
    const stepXpCost = xpOf(cost)
    if (this.objective === 'xp') {
      // One entry per state, the lexicographically smallest (x, t, m): x and t are both sums, so smaller is always better
      // after combining, and with equal (x, t) a smaller m is never worse
      const ea = store.head[a]
      const eb = store.head[b]
      const x = store.x[ea] + store.x[eb] + stepXpCost
      const t = store.t[ea] + store.t[eb] + cost
      const m = Math.max(store.m[ea], store.m[eb], cost)
      if (this.pruning && x > this.upperX) {
        this.prunedByBound++
        return
      }
      let state = store.lookup(result)
      if (state === NONE) {
        state = this.createState(result)
        if (state === NONE) return
        store.appendEntry(state, t, m, x, ea, eb, flags)
        return
      }
      const e = store.head[state]
      if (x < store.x[e] || (x === store.x[e] && (t < store.t[e] || (t === store.t[e] && m < store.m[e])))) {
        store.setEntry(e, t, m, x, ea, eb, flags)
      }
      return
    }

    // 'levels' and 'finalPwp': keep only the smallest t and, at that t, the Pareto front over (m, x). A smaller t always
    // gives a smaller plan total. m combines by max rather than sum, so a smaller m with a larger x can win or lose
    // depending on the rest of the plan, and both must stay. Final PWP and inputs used follow from the root state.
    const t = store.t[store.head[a]] + store.t[store.head[b]] + cost
    // usesPruning: an object at the bound cannot be combined further (anvil uses would grow), so it can only be a result,
    // and with a larger total than a known result with the same uses it loses on the second key
    if ((this.pruning && t > this.upperT) || (this.usesPruning && result.uses === this.upperUses && t > this.upperTAtUses)) {
      this.prunedByBound++
      return
    }
    let state = store.lookup(result)
    if (state === NONE) {
      state = this.createState(result)
      if (state === NONE) return
    } else {
      const current = store.t[store.head[state]]
      if (t > current) return
      if (t < current) store.clearEntries(state)
    }
    for (let ea = store.head[a]; ea !== NONE; ea = store.next[ea]) {
      for (let eb = store.head[b]; eb !== NONE; eb = store.next[eb]) {
        const m = Math.max(store.m[ea], store.m[eb], cost)
        const x = store.x[ea] + store.x[eb] + stepXpCost
        store.addToFront(state, t, m, x, ea, eb, flags)
      }
    }
  }

  private findOrCreateState(obj: Readonly<PackedObject>): number {
    const state = this.store.lookup(obj)
    return state !== NONE ? state : this.createState(obj)
  }

  /** Only after a lookup that found nothing. Aborts at the state limit. */
  private createState(obj: Readonly<PackedObject>): number {
    if (this.store.count >= this.limits.exactMaxStates) {
      this.abortCause = 'state-limit'
      return NONE
    }
    return this.store.insert(obj)
  }

  private closeSubset(subset: number): void {
    const store = this.store
    const first = this.subFirst[subset]
    const count = store.count - first
    this.subCount[subset] = count
    if (this.pruning && count > 0) {
      let minValue = Number.POSITIVE_INFINITY
      let minPwp = Number.POSITIVE_INFINITY
      for (let state = first; state < first + count; state++) {
        minValue = Math.min(minValue, this.stateValue(state))
        minPwp = Math.min(minPwp, packedPwp(store.uses[state]))
      }
      this.subMinValue[subset] = minValue
      this.subMinPwp[subset] = minPwp
    }
    if (this.usesPruning && count > 0) {
      let minUses = store.uses[first]
      for (let state = first + 1; state < first + count; state++) minUses = Math.min(minUses, store.uses[state])
      this.subMinUses[subset] = minUses
    }
    this.subsetsProcessed++
    this.done = this.doneAtSubsetStart + this.weight(subset)
    if (this.np.goal !== null && this.isRootCandidate(subset)) this.considerGoalRoots(subset)
    this.checkProjectedTime()
  }

  /**
   * Projected-time abort, only while no bound is known. Larger subsets take more work per pair, so the linear projection
   * from the fraction done underestimates the total; with a bound, later pairs can be cheaper, so it is not used.
   */
  private checkProjectedTime(): void {
    if (this.boundKnown()) return
    const fraction = this.done / this.complexity
    if (fraction < this.limits.projectionMinFraction) return
    const elapsed = this.activeMs + (this.now() - this.sliceStart)
    if (elapsed / fraction > this.limits.exactTimeBudgetMs) this.abortCause = 'time-limit'
  }

  private boundKnown(): boolean {
    if (this.usesPruning) return Number.isFinite(this.upperUses)
    return this.pruning && Number.isFinite(this.objective === 'xp' ? this.upperX : this.upperT)
  }

  private isRootCandidate(subset: number): boolean {
    if (!this.useOnlyNeeded) return subset === this.fullSet
    return subset >= this.targetBase || !this.hasTarget
  }

  private considerGoalRoots(subset: number): void {
    const store = this.store
    const first = this.subFirst[subset]
    for (let state = first; state < first + this.subCount[subset]; state++) {
      if (!this.isValidRoot(state)) continue
      for (let entry = store.head[state]; entry !== NONE; entry = store.next[entry]) {
        const choice = this.rootChoice(subset, state, entry)
        if (this.best === null || compareKeyVectors(choice.keys, this.best.keys) < 0) this.best = choice
        if (this.pruning && this.useOnlyNeeded) {
          this.upperT = Math.min(this.upperT, store.t[entry])
          this.upperX = Math.min(this.upperX, store.x[entry])
        }
        if (this.usesPruning) this.lowerUsesBound(store.uses[state], store.t[entry])
      }
    }
  }

  private isValidRoot(state: number): boolean {
    const store = this.store
    if (store.kind[state] !== (this.hasTarget ? KIND_ITEM : KIND_BOOK)) return false
    if (store.named[state] !== (this.rename ? 1 : 0)) return false
    if (this.np.goal === null) return true
    store.load(state, this.scratch)
    return meetsGoal(this.cp, this.scratch)
  }

  private rootChoice(subset: number, state: number, entry: number): RootChoice {
    return { subset, state, entry, keys: planKeyVector(this.rootKeys(subset, state, entry), this.objective) }
  }

  private rootKeys(subset: number, state: number, entry: number): PlanKeys {
    const store = this.store
    return {
      totalLevels: store.t[entry],
      maxStepLevels: store.m[entry],
      xpPoints: store.x[entry],
      finalPriorWorkPenalty: packedPwp(store.uses[state]),
      inputsUsed: this.subsetSize[subset],
    }
  }

  // Roots and result

  private finish(): ExactOutcome {
    // subsets: processed subsets; states: states created; transitions: state pairs passed to combineCompiled;
    // prunedByBound: state pairs skipped by a bound before combining, plus values dropped by a bound after combining
    const stats: ExactStats = {
      complexity: this.complexity,
      subsets: this.subsetsProcessed,
      states: this.store.count,
      transitions: this.transitions,
      prunedByBound: this.prunedByBound,
    }
    const elapsedMs = this.activeMs
    if (this.abortCause !== null) return { status: 'aborted', cause: this.abortCause, stats, elapsedMs }

    if (this.np.goal !== null) {
      if (this.best !== null) return { status: 'ok', plan: this.toPlan(this.best), otherMaximal: [], stats, elapsedMs }
    } else {
      const [chosen, ...others] = this.maximalRoots(this.fullSet)
      if (chosen !== undefined) {
        return { status: 'ok', plan: this.toPlan(chosen), otherMaximal: others.map((choice) => this.toPlan(choice)), stats, elapsedMs }
      }
    }
    return {
      status: 'no-plan',
      partial: this.useOnlyNeeded ? null : this.largestPartialPlan(),
      noEffectRefusals: this.noEffectRefused,
      stats,
      elapsedMs,
    }
  }

  /**
   * Results without a goal: the best entry for each level vector that no other vector dominates, ordered by key; equal
   * keys keep state creation order.
   */
  private maximalRoots(subset: number): RootChoice[] {
    const store = this.store
    interface VectorGroup { readonly levels: PackedObject; readonly levelSum: number; best: RootChoice }
    const vectors = new Map<string, VectorGroup>()
    const first = this.subFirst[subset]
    for (let state = first; state < first + this.subCount[subset]; state++) {
      if (!this.isValidRoot(state)) continue
      const key = `${store.w0[state]},${store.w1[state]},${store.w2[state]}`
      let group = vectors.get(key)
      for (let entry = store.head[state]; entry !== NONE; entry = store.next[entry]) {
        const choice = this.rootChoice(subset, state, entry)
        if (group === undefined) {
          const levels = createPackedObject()
          store.load(state, levels)
          group = { levels, levelSum: this.levelSum(levels), best: choice }
          vectors.set(key, group)
        } else if (compareKeyVectors(choice.keys, group.best.keys) < 0) {
          group.best = choice
        }
      }
    }
    // A dominating vector has a larger level sum, so in this order it is always kept before the vectors it dominates
    // (dominance is transitive)
    const candidates = [...vectors.values()].sort((p, q) => q.levelSum - p.levelSum)
    const maximal: VectorGroup[] = []
    for (const candidate of candidates) {
      if (!maximal.some((kept) => levelsDominate(kept.levels, candidate.levels))) maximal.push(candidate)
    }
    return maximal
      .map((group) => group.best)
      .sort((p, q) => compareKeyVectors(p.keys, q.keys) || p.state - q.state)
  }

  private levelSum(obj: Readonly<PackedObject>): number {
    let sum = 0
    for (let slot = 0; slot < this.cp.universe.length; slot++) sum += levelAt(obj, slot)
    return sum
  }

  private largestPartialPlan(): ExactPlan | null {
    const order = this.order
    let end = order.length - 1
    while (end >= 0) {
      const size = this.subsetSize[order[end]]
      let start = end
      while (start > 0 && this.subsetSize[order[start - 1]] === size) start--
      let best: RootChoice | null = null
      for (let i = start; i <= end; i++) {
        const subset = order[i]
        if (subset === this.fullSet || (this.hasTarget && subset < this.targetBase)) continue
        const choice = this.np.goal === null ? this.maximalRoots(subset)[0] : this.bestGoalRoot(subset)
        if (choice !== undefined && choice !== null && (best === null || compareKeyVectors(choice.keys, best.keys) < 0)) best = choice
      }
      if (best !== null) return this.toPlan(best)
      end = start - 1
    }
    return null
  }

  private bestGoalRoot(subset: number): RootChoice | null {
    const store = this.store
    let best: RootChoice | null = null
    const first = this.subFirst[subset]
    for (let state = first; state < first + this.subCount[subset]; state++) {
      if (!this.isValidRoot(state)) continue
      for (let entry = store.head[state]; entry !== NONE; entry = store.next[entry]) {
        const choice = this.rootChoice(subset, state, entry)
        if (best === null || compareKeyVectors(choice.keys, best.keys) < 0) best = choice
      }
    }
    return best
  }

  /** Group leaves get the group's inputs in index order, left to right. */
  private toPlan(choice: RootChoice): ExactPlan {
    const store = this.store
    const nextCopy = new Array<number>(this.groups.length).fill(0)
    const used: number[] = []
    const unfold = (entry: number): PlanNode => {
      const flags = store.flags[entry]
      if ((flags & FLAG_LEAF) !== 0) {
        const groupIndex = store.left[entry]
        const input = this.groups[groupIndex].inputs[nextCopy[groupIndex]++]
        used.push(input)
        return { t: 'leaf', input, preRename: (flags & FLAG_PRE_RENAME) !== 0 }
      }
      const left = unfold(store.left[entry])
      const right = unfold(store.right[entry])
      return { t: 'combine', left, right, rename: (flags & FLAG_RENAME) !== 0 }
    }
    const tree = unfold(choice.entry)
    const final = createPackedObject()
    store.load(choice.state, final)
    const usedSet = new Set(used)
    return {
      tree,
      keys: this.rootKeys(choice.subset, choice.state, choice.entry),
      final: unpackObject(this.cp, final),
      usedInputs: [...used].sort((p, q) => p - q),
      unusedInputs: this.np.inputs.flatMap((_, index) => (usedSet.has(index) ? [] : [index])),
    }
  }

  // Seeds

  private applySeed(seed: ExactSeed): void {
    const value = 't' in seed
      ? this.replaySeed(seed)
      : { t: seed.totalLevels, x: seed.xpPoints, uses: seed.finalAnvilUses ?? Number.POSITIVE_INFINITY }
    if (value === null) return
    if (this.pruning) {
      this.upperT = Math.min(this.upperT, value.t)
      this.upperX = Math.min(this.upperX, value.x)
    }
    if (this.usesPruning) this.lowerUsesBound(value.uses, value.t)
  }

  private lowerUsesBound(uses: number, t: number): void {
    if (uses < this.upperUses) {
      this.upperUses = uses
      this.upperTAtUses = t
    } else if (uses === this.upperUses && t < this.upperTAtUses) {
      this.upperTAtUses = t
    }
  }

  /**
   * null unless the seed is a valid plan for the problem: every step accepted within the cap, the target as the base, a
   * rename-only step on the base leaf only, no named right input, named exactly when rename is on, every input used
   * unless useOnlyNeeded, and the goal met. Without a goal, the result must reach every reachable level and no two
   * eligible enchantments on the inputs may conflict, so that the maximal result is unique.
   */
  private replaySeed(tree: PlanNode): { t: number; x: number; uses: number } | null {
    const cp = this.cp
    const used = new Set<number>()
    let t = 0
    let x = 0
    let baseInput = NONE
    const step = (cost: number): void => {
      t += cost
      x += xpOf(cost)
    }
    const replay = (node: PlanNode, isBase: boolean): PackedObject | null => {
      if (node.t === 'leaf') {
        const input = node.input
        // A seed that uses an input left out of the search cannot be replayed in packed form, so it is ignored
        const leaf = Number.isInteger(input) && input >= 0 && input < cp.inputs.length ? cp.inputs[input] : null
        if (leaf === null || used.has(input)) return null
        used.add(input)
        if (isBase) baseInput = input
        const obj = createPackedObject()
        copyPackedObject(leaf, obj)
        if (!node.preRename) return obj
        const out = createCombineOut()
        if (!isBase || !this.rename || renameOnlyCompiled(cp, obj, this.levelCap, out) !== COMBINE_OK) return null
        step(out.cost)
        return out.result
      }
      const left = replay(node.left, isBase)
      const right = left === null ? null : replay(node.right, false)
      if (left === null || right === null || right.named === 1) return null
      if (node.rename && (!this.rename || left.named === 1)) return null
      const out = createCombineOut()
      if (combineCompiled(cp, left, right, node.rename, this.levelCap, out) !== COMBINE_OK) return null
      step(out.cost)
      return out.result
    }

    const final = replay(tree, true)
    if (final === null || final.named !== (this.rename ? 1 : 0)) return null
    if (this.hasTarget ? baseInput !== this.np.targetIndex || final.kind !== KIND_ITEM : final.kind !== KIND_BOOK) return null
    if (!this.useOnlyNeeded && used.size !== cp.inputs.length) return null
    if (this.np.goal !== null) return meetsGoal(cp, final) ? { t, x, uses: final.uses } : null
    return this.isUniqueMaximum(final) ? { t, x, uses: final.uses } : null
  }

  private isUniqueMaximum(final: Readonly<PackedObject>): boolean {
    let eligibleMask = 0
    for (const slot of this.eligibleSlots) {
      if (levelAt(final, slot) < this.reachableBySlot[slot]) return false
      eligibleMask |= 1 << slot
    }
    // Slots are the enchantments on the inputs, so checking conflicts among the eligible slots is enough
    return this.eligibleSlots.every((slot) => (this.cp.exclusive[slot] & eligibleMask) === 0)
  }

  /** How many inputs of group g the subset uses. */
  private digit(subset: number, g: number): number {
    const group = this.groups[g]
    return Math.floor(subset / group.base) % group.radix
  }

  /** Left parts tried for subset; summed over all subsets this is C. */
  private weight(subset: number): number {
    let weight = 1
    this.groups.forEach((group, g) => {
      if (!group.target) weight *= this.digit(subset, g) + 1
    })
    return weight
  }
}

/** A counting sort; the empty set is left out. */
function orderBySize(size: Uint16Array, maxSize: number): Int32Array {
  const starts = new Int32Array(maxSize + 2)
  for (let id = 1; id < size.length; id++) starts[size[id] + 1]++
  for (let s = 1; s <= maxSize + 1; s++) starts[s] += starts[s - 1]
  const order = new Int32Array(size.length - 1)
  for (let id = 1; id < size.length; id++) order[starts[size[id]]++] = id
  return order
}

// State storage

type NumericArray = Uint8Array | Int8Array | Uint16Array | Int32Array | Float64Array

function resized<A extends NumericArray>(array: A, length: number): A {
  const Constructor = array.constructor as new (length: number) => A
  const next = new Constructor(length)
  next.set(array)
  return next
}

function hashState(obj: Readonly<PackedObject>): number {
  let h = Math.imul(obj.w0 ^ 0x2545f491, 0x9e3779b1)
  h = Math.imul(h ^ (h >>> 15) ^ obj.w1, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 13) ^ obj.w2, 0xc2b2ae3d)
  h = Math.imul(h ^ (h >>> 16) ^ (obj.uses | (obj.named << 16) | (obj.kind << 17) | ((obj.itemType + 1) << 18)), 0x27d4eb2f)
  return h ^ (h >>> 15)
}

/**
 * States are numbered in creation order, and subsets are processed one at a time, so each subset's states are
 * contiguous. Entries form one list per state, linked by next. Freed entry slots are reused only within the subset
 * being built; entries of finished subsets are never freed, so back-pointers into them stay valid. States of the subset
 * being built are found through an open-addressing table, cleared per subset by bumping a generation stamp.
 */
class StateStore {
  count = 0
  kind = new Uint8Array(0)
  itemType = new Int8Array(0)
  mask = new Int32Array(0)
  w0 = new Int32Array(0)
  w1 = new Int32Array(0)
  w2 = new Int32Array(0)
  uses = new Uint16Array(0)
  named = new Uint8Array(0)
  /** State -> first entry, or NONE. */
  head = new Int32Array(0)

  /** Entries: total levels, max step cost, XP points, back-pointers (left and right entries; for a leaf, left is the group index), next entry, flags. */
  t = new Float64Array(0)
  m = new Float64Array(0)
  x = new Float64Array(0)
  left = new Int32Array(0)
  right = new Int32Array(0)
  next = new Int32Array(0)
  flags = new Uint8Array(0)
  private entryTop = 0
  private freeEntries = NONE

  private slots = new Int32Array(0)
  private stamps = new Int32Array(0)
  private generation = 0
  private subsetFirst = 0
  private lastSlot = 0
  private readonly maxStates: number

  constructor(maxStates: number) {
    this.maxStates = Math.max(1, maxStates)
    this.growStates(Math.min(1024, this.maxStates))
    this.growEntries(2048)
    this.slots = new Int32Array(256)
    this.stamps = new Int32Array(256)
  }

  byteLength(): number {
    const arrays: readonly NumericArray[] = [
      this.kind, this.itemType, this.mask, this.w0, this.w1, this.w2, this.uses, this.named, this.head,
      this.t, this.m, this.x, this.left, this.right, this.next, this.flags, this.slots, this.stamps,
    ]
    return arrays.reduce((sum, array) => sum + array.byteLength, 0)
  }

  beginSubset(): void {
    this.generation++
    this.subsetFirst = this.count
  }

  /** The state equal to obj in the current subset, or NONE, after which insert may be called. */
  lookup(obj: Readonly<PackedObject>): number {
    const slotMask = this.slots.length - 1
    let slot = hashState(obj) & slotMask
    while (this.stamps[slot] === this.generation) {
      const state = this.slots[slot]
      if (this.w0[state] === obj.w0 && this.w1[state] === obj.w1 && this.w2[state] === obj.w2 && this.uses[state] === obj.uses
        && this.named[state] === obj.named && this.kind[state] === obj.kind && this.itemType[state] === obj.itemType) {
        return state
      }
      slot = (slot + 1) & slotMask
    }
    this.lastSlot = slot
    return NONE
  }

  /** Adds the state the preceding lookup did not find. The caller checks the state limit. */
  insert(obj: Readonly<PackedObject>): number {
    if (this.count === this.kind.length) this.growStates(Math.min(this.maxStates, this.kind.length * 2))
    const state = this.count++
    this.kind[state] = obj.kind
    this.itemType[state] = obj.itemType
    this.mask[state] = obj.mask
    this.w0[state] = obj.w0
    this.w1[state] = obj.w1
    this.w2[state] = obj.w2
    this.uses[state] = obj.uses
    this.named[state] = obj.named
    this.head[state] = NONE
    this.stamps[this.lastSlot] = this.generation
    this.slots[this.lastSlot] = state
    if ((this.count - this.subsetFirst) * 2 > this.slots.length) this.rehash(this.slots.length * 2)
    return state
  }

  load(state: number, into: PackedObject): void {
    into.kind = this.kind[state]
    into.itemType = this.itemType[state]
    into.mask = this.mask[state]
    into.w0 = this.w0[state]
    into.w1 = this.w1[state]
    into.w2 = this.w2[state]
    into.uses = this.uses[state]
    into.named = this.named[state]
  }

  appendEntry(state: number, t: number, m: number, x: number, left: number, right: number, flags: number): void {
    const entry = this.newEntry(t, m, x, left, right, flags)
    let tail = this.head[state]
    if (tail === NONE) {
      this.head[state] = entry
      return
    }
    while (this.next[tail] !== NONE) tail = this.next[tail]
    this.next[tail] = entry
  }

  setEntry(entry: number, t: number, m: number, x: number, left: number, right: number, flags: number): void {
    this.t[entry] = t
    this.m[entry] = m
    this.x[entry] = x
    this.left[entry] = left
    this.right[entry] = right
    this.flags[entry] = flags
  }

  /** Drops every entry of a state, when a smaller t turns up. */
  clearEntries(state: number): void {
    let entry = this.head[state]
    while (entry !== NONE) {
      const next = this.next[entry]
      this.freeEntry(entry)
      entry = next
    }
    this.head[state] = NONE
  }

  /**
   * Inserts a candidate into the Pareto front over (m, x); all entries of the state share t. Nothing is inserted when an
   * entry at least as good exists, so the earlier entry wins ties. Otherwise the entries the candidate beats (m and x both
   * at least as large) are dropped.
   */
  addToFront(state: number, t: number, m: number, x: number, left: number, right: number, flags: number): void {
    for (let entry = this.head[state]; entry !== NONE; entry = this.next[entry]) {
      if (this.m[entry] <= m && this.x[entry] <= x) return
    }
    let previous = NONE
    let entry = this.head[state]
    while (entry !== NONE) {
      const next = this.next[entry]
      if (m <= this.m[entry] && x <= this.x[entry]) {
        if (previous === NONE) this.head[state] = next
        else this.next[previous] = next
        this.freeEntry(entry)
      } else {
        previous = entry
      }
      entry = next
    }
    const added = this.newEntry(t, m, x, left, right, flags)
    if (previous === NONE) this.head[state] = added
    else this.next[previous] = added
  }

  private newEntry(t: number, m: number, x: number, left: number, right: number, flags: number): number {
    let entry = this.freeEntries
    if (entry !== NONE) {
      this.freeEntries = this.next[entry]
    } else {
      if (this.entryTop === this.t.length) this.growEntries(this.t.length * 2)
      entry = this.entryTop++
    }
    this.setEntry(entry, t, m, x, left, right, flags)
    this.next[entry] = NONE
    return entry
  }

  private freeEntry(entry: number): void {
    this.next[entry] = this.freeEntries
    this.freeEntries = entry
  }

  private growStates(capacity: number): void {
    this.kind = resized(this.kind, capacity)
    this.itemType = resized(this.itemType, capacity)
    this.mask = resized(this.mask, capacity)
    this.w0 = resized(this.w0, capacity)
    this.w1 = resized(this.w1, capacity)
    this.w2 = resized(this.w2, capacity)
    this.uses = resized(this.uses, capacity)
    this.named = resized(this.named, capacity)
    this.head = resized(this.head, capacity)
  }

  private growEntries(capacity: number): void {
    this.t = resized(this.t, capacity)
    this.m = resized(this.m, capacity)
    this.x = resized(this.x, capacity)
    this.left = resized(this.left, capacity)
    this.right = resized(this.right, capacity)
    this.next = resized(this.next, capacity)
    this.flags = resized(this.flags, capacity)
  }

  /** Grows the lookup table and reinserts the states of the current subset. */
  private rehash(size: number): void {
    this.slots = new Int32Array(size)
    this.stamps = new Int32Array(size)
    this.generation = 1
    const slotMask = size - 1
    const obj = createPackedObject()
    for (let state = this.subsetFirst; state < this.count; state++) {
      this.load(state, obj)
      let slot = hashState(obj) & slotMask
      while (this.stamps[slot] === this.generation) slot = (slot + 1) & slotMask
      this.stamps[slot] = this.generation
      this.slots[slot] = state
    }
  }
}
