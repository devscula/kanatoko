// Brute-force solver for cross-checking the engine's exact search and tree-table method. It imports only GAME_DATA and
// types: normalization, reachable levels, goals, the anvil rules (./anvil.ts) and the comparison keys are written again here
// rather than shared with the engine.
//
// Every full binary tree over every subset of the inputs is built bottom-up, with the target as the leftmost leaf, and each
// step is replayed with ./anvil.ts; a refused step drops the tree. A rename is either a rename-only step on the leftmost leaf
// or +1 on one step of the target's line (the left children from the root down). A renamed object never goes on the right,
// which keeps the rename on that line and allows one rename per plan.
//
// Nothing is pruned, unlike the exact search. Subtrees are merged only when they share the subset, the resulting object and
// (total, max, xp): a step's cost depends only on the two objects, and plan values are sums and maxima over steps, so such
// subtrees are interchangeable.

import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import type {
  AdvancedProblem,
  EnchantLevels,
  KeyVector,
  Objective,
  PlanKeyName,
  PlanKeys,
  PlanNode,
  Problem,
  Settings,
  SimpleProblem,
} from '../../engine/types.ts'
import {
  createRuleTable,
  fromSimObject,
  levelsToVector,
  presentIds,
  priorWorkPenalty,
  simCombine,
  simRenameOnly,
  vectorToLevels,
  xpForLevels,
  type OracleObject,
  type RuleTable,
  type SimObject,
} from './anvil.ts'
import {
  areExclusive,
  canApply,
  dataPosition,
  enchantmentIn,
  enchantmentsOf,
  isBookType,
  isDamageable,
  itemIn,
  maxLevelOf,
} from './gameFacts.ts'

/** The engine's EngineInput without origin. */
export interface OracleInput {
  readonly kind: 'item' | 'book'
  readonly itemType: ItemTypeId | null      // null for books
  readonly enchantments: EnchantLevels
  readonly anvilUses: number
}

/** Inputs are in the engine's normalized order, so indices match PlanNode.input. */
export interface OracleProblem {
  readonly inputs: readonly OracleInput[]
  readonly targetIndex: number | null       // 0 when there is a target
  readonly goal: EnchantLevels | null
  readonly useOnlyNeeded: boolean           // always false when goal is null
}

/** When several plans share the smallest key, this is any one of them. */
export interface OracleChoice {
  readonly keys: KeyVector                  // in ORACLE_KEY_ORDER[objective] order
  readonly planKeys: PlanKeys
  readonly tree: PlanNode
  readonly usedInputs: readonly number[]
  readonly final: OracleObject
  /** In post-order, with a rename-only step first. */
  readonly stepCosts: readonly number[]
}

export interface OracleBestKeys {
  readonly keys: KeyVector
  readonly planKeys: PlanKeys
}

export interface OracleMaximal {
  readonly enchantments: EnchantLevels
  readonly best: { readonly [O in Objective]: OracleBestKeys }
}

export interface OracleStats {
  readonly combines: number                 // rename-only steps included
  readonly entries: number                  // stored subtrees
  readonly rootEntries: number              // subtrees considered as a plan's final object
}

export interface OracleResult {
  readonly status: 'ok' | 'infeasible'
  readonly objective: Objective
  /** best[settings.objective].keys; null when infeasible, like best. */
  readonly keys: KeyVector | null
  readonly best: { readonly [O in Objective]: OracleChoice } | null
  /**
   * Only without a goal: every maximal final object, smallest settings.objective key first. The engine's
   * other-maximal-results warning lists up to three of those it did not choose.
   */
  readonly maximal: readonly OracleMaximal[] | null
  /** Only without a goal: whether some plan using every input reaches U(E) on every eligible enchantment. */
  readonly reachesAllReachable: boolean | null
  readonly problem: OracleProblem
  readonly reachable: EnchantLevels
  /** Enchantments that can stay on the final object, as in the engine's eligible list, in data order. */
  readonly eligible: readonly EnchantmentId[]
  readonly stats: OracleStats
}

export interface OracleOptions {
  readonly levelCapOverride?: number | null
}

export const OBJECTIVES: readonly Objective[] = ['levels', 'xp', 'finalPwp']

/** Written out here rather than taken from the engine's OBJECTIVE_KEYS. */
export const ORACLE_KEY_ORDER: { readonly [O in Objective]: readonly [PlanKeyName, PlanKeyName, PlanKeyName, PlanKeyName, PlanKeyName] } = {
  levels: ['totalLevels', 'maxStepLevels', 'xpPoints', 'finalPriorWorkPenalty', 'inputsUsed'],
  xp: ['xpPoints', 'totalLevels', 'maxStepLevels', 'finalPriorWorkPenalty', 'inputsUsed'],
  finalPwp: ['finalPriorWorkPenalty', 'totalLevels', 'maxStepLevels', 'xpPoints', 'inputsUsed'],
}

/** The subtree count grows steeply: 8 inputs with renaming take about 1 second and 300 MB. */
export const ORACLE_MAX_INPUTS = 8

/** Throws for a problem that would not pass the engine's validation. */
export function bruteForceSolve(problem: Problem, settings: Settings, options: OracleOptions = {}): OracleResult {
  const edition = settings.edition
  assertWithinContract(problem, edition)
  const normalized = oracleNormalize(problem)
  if (normalized.inputs.length > ORACLE_MAX_INPUTS) {
    throw new Error(`oracle: ${normalized.inputs.length} inputs is more than the oracle can enumerate (${ORACLE_MAX_INPUTS})`)
  }
  const levelCap = options.levelCapOverride === undefined ? settings.levelCap : options.levelCapOverride

  const ids = [...normalized.inputs.flatMap((input) => presentIds(input.enchantments)), ...presentIds(normalized.goal ?? {})]
  const table = createRuleTable(edition, ids)
  const search = new Enumeration(table, normalized, levelCap, settings.rename)
  search.run()

  const reachable = reachableLevels(normalized.inputs)
  const eligible = eligibleEnchantments(edition, normalized)
  const selection = normalized.goal === null
    ? search.selectMaximal(reachable, eligible)
    : search.selectWithGoal(levelsToVector(table, normalized.goal))

  const chosen = selection.best
  const best = chosen === null ? null : mapObjectives((objective) => search.choice(chosen[objective]))
  return {
    status: best === null ? 'infeasible' : 'ok',
    objective: settings.objective,
    keys: best === null ? null : best[settings.objective].keys,
    best,
    maximal: selection.maximal === null ? null : sortMaximal(selection.maximal, settings.objective),
    reachesAllReachable: selection.reachesAllReachable,
    problem: normalized,
    reachable,
    eligible,
    stats: search.stats(),
  }
}

/** The target, then spare items, then books (one entry per copy). */
export function oracleNormalize(problem: Problem): OracleProblem {
  return problem.mode === 'simple' ? normalizeSimple(problem) : normalizeAdvanced(problem)
}

function normalizeSimple(problem: SimpleProblem): OracleProblem {
  const bookOnly = isBookType(problem.item)
  const inputs: OracleInput[] = bookOnly ? [] : [{ kind: 'item', itemType: problem.item, enchantments: {}, anvilUses: 0 }]
  const goal: EnchantLevels = {}
  for (const request of problem.enchantments) {
    goal[request.id] = request.level
    for (const stack of request.sources ?? [{ level: request.level, count: 1 }]) {
      for (let copy = 0; copy < stack.count; copy++) {
        inputs.push({ kind: 'book', itemType: null, enchantments: { [request.id]: stack.level }, anvilUses: 0 })
      }
    }
  }
  return { inputs, targetIndex: bookOnly ? null : 0, goal, useOnlyNeeded: true }
}

function normalizeAdvanced(problem: AdvancedProblem): OracleProblem {
  const { target } = problem
  const inputs: OracleInput[] = []
  if (target !== null) inputs.push({ kind: 'item', itemType: target.itemType, enchantments: target.enchantments, anvilUses: target.anvilUses })
  for (const extra of problem.extraItems) {
    inputs.push({ kind: 'item', itemType: target?.itemType ?? null, enchantments: extra.enchantments, anvilUses: extra.anvilUses })
  }
  for (const book of problem.books) {
    for (let copy = 0; copy < (book.count ?? 1); copy++) {
      inputs.push({ kind: 'book', itemType: null, enchantments: book.enchantments, anvilUses: book.anvilUses })
    }
  }
  return {
    inputs,
    targetIndex: target === null ? null : 0,
    goal: problem.goal,
    useOnlyNeeded: problem.goal !== null && problem.useOnlyNeeded,
  }
}

/**
 * Fails loudly so that a generator bug cannot silently skip the cross-check. The LIMITS caps (10 anvil uses, 32 books) are
 * engine choices and are not checked.
 */
function assertWithinContract(problem: Problem, edition: Edition): void {
  const fail = (message: string): never => {
    throw new Error(`oracle: invalid problem: ${message}`)
  }
  // Exclusive enchantments make an input invalid, but in a goal they only make the goal unreachable
  const checkLevels = (levels: EnchantLevels, where: string, itemType: ItemTypeId | null, isInput = true): void => {
    const ids = Object.keys(levels) as EnchantmentId[]
    for (const id of ids) {
      const level = levels[id]
      if (level === undefined) continue
      if (enchantmentIn(edition, id) === null) fail(`${where}: ${id} is not in ${edition}`)
      if (!Number.isInteger(level) || level < 1 || level > maxLevelOf(id)) fail(`${where}: ${id} level ${level}`)
      if (itemType !== null && !canApply(edition, itemType, id)) fail(`${where}: ${id} cannot go on ${itemType}`)
      if (!isInput) continue
      for (const other of ids) {
        if (levels[other] !== undefined && areExclusive(edition, id, other)) fail(`${where}: ${id} conflicts with ${other}`)
      }
    }
  }
  const checkCount = (value: number, where: string, min: number): void => {
    if (!Number.isInteger(value) || value < min) fail(`${where}: ${value}`)
  }
  const checkItem = (itemType: ItemTypeId, where: string): void => {
    if (itemIn(edition, itemType) === null) fail(`${where}: ${itemType} is not in ${edition}`)
  }

  if (problem.mode === 'simple') {
    checkItem(problem.item, 'item')
    const seen = new Set<EnchantmentId>()
    for (const request of problem.enchantments) {
      if (seen.has(request.id)) fail(`duplicate request ${request.id}`)
      seen.add(request.id)
      checkLevels({ [request.id]: request.level }, 'request', null, false)
      for (const stack of request.sources ?? []) {
        checkLevels({ [request.id]: stack.level }, 'source', null)
        checkCount(stack.count, 'source count', 1)
      }
    }
    return
  }

  const { target } = problem
  if (target !== null) {
    checkItem(target.itemType, 'target')
    if (isBookType(target.itemType)) fail('the target is a book (use target: null)')
    checkLevels(target.enchantments, 'target', target.itemType)
    checkCount(target.anvilUses, 'target anvil uses', 0)
  }
  if (problem.extraItems.length > 0) {
    if (target === null) fail('extra items without a target')
    else if (!isDamageable(target.itemType)) fail(`extra items of ${target.itemType}, which has no durability`)
  }
  problem.extraItems.forEach((extra, index) => {
    checkLevels(extra.enchantments, `extra item ${index}`, target?.itemType ?? null)
    checkCount(extra.anvilUses, `extra item ${index} anvil uses`, 0)
  })
  problem.books.forEach((book, index) => {
    if (presentIds(book.enchantments).length === 0) fail(`book ${index} has no enchantment`)
    checkLevels(book.enchantments, `book ${index}`, null)
    checkCount(book.anvilUses, `book ${index} anvil uses`, 0)
    if (book.count !== undefined) checkCount(book.count, `book ${index} count`, 1)
  })
  if (problem.goal !== null) checkLevels(problem.goal, 'goal', null, false)
}

/**
 * U(E): the highest level of E that the inputs can reach, ignoring cost and other enchantments. Two copies of level L make
 * L + 1 and different levels keep the higher one, so copies pair up from the lowest level and an unpaired copy does not
 * carry over.
 */
export function reachableLevelOf(levels: readonly number[], maxLevel: number): number {
  const copiesAt = new Array<number>(maxLevel + 1).fill(0)
  for (const level of levels) if (level >= 1) copiesAt[Math.min(level, maxLevel)] += 1
  let highest = 0
  for (let level = 1; level <= maxLevel; level++) {
    if (copiesAt[level] === 0) continue
    highest = level
    if (level < maxLevel) copiesAt[level + 1] += Math.floor(copiesAt[level] / 2)
  }
  return highest
}

function reachableLevels(inputs: readonly OracleInput[]): EnchantLevels {
  const ids = [...new Set(inputs.flatMap((input) => presentIds(input.enchantments)))]
  const result: EnchantLevels = {}
  for (const id of sortByData(ids)) {
    const levels = inputs.map((input) => input.enchantments[id] ?? 0).filter((level) => level > 0)
    result[id] = reachableLevelOf(levels, maxLevelOf(id))
  }
  return result
}

function eligibleEnchantments(edition: Edition, problem: OracleProblem): EnchantmentId[] {
  if (problem.targetIndex === null) return enchantmentsOf(edition)
  const target = problem.inputs[problem.targetIndex]
  const itemType = target.itemType
  if (itemType === null) throw new Error('oracle: the target must be an item')
  const existing = presentIds(target.enchantments)
  return enchantmentsOf(edition).filter((id) => canApply(edition, itemType, id) && existing.every((other) => !areExclusive(edition, id, other)))
}

function sortByData(ids: readonly EnchantmentId[]): EnchantmentId[] {
  return [...ids].sort((a, b) => dataPosition(a) - dataPosition(b))
}

/**
 * A leaf has null left and right and its input index; a combination has both subtrees and input -1. rename means a
 * rename-only step on a leaf and renaming in this step on a combination.
 */
interface Entry {
  readonly total: number
  readonly max: number
  readonly xp: number
  readonly left: Entry | null
  readonly right: Entry | null
  readonly input: number
  readonly rename: boolean
}

/** Subtrees over one subset that produce the same object, with duplicate values merged. */
interface Bucket {
  readonly obj: SimObject
  readonly entries: Entry[]
  /** valueKey of each entry; null once the subset is finished. */
  seen: Set<number | string> | null
}

interface Candidate {
  readonly keys: KeyVector
  readonly planKeys: PlanKeys
  readonly mask: number
  readonly bucket: Bucket
  readonly entry: Entry
}

type BestPerObjective = { readonly [O in Objective]: Candidate }
/** Empty or complete: the first candidate fills all three objectives. */
type BestSoFar = { [O in Objective]?: Candidate }

interface Selection {
  readonly best: BestPerObjective | null
  readonly maximal: OracleMaximal[] | null
  readonly reachesAllReachable: boolean | null
}

class Enumeration {
  private readonly table: RuleTable
  private readonly problem: OracleProblem
  private readonly levelCap: number | null
  private readonly rename: boolean
  private readonly leaves: readonly SimObject[]
  private readonly targetBit: number
  private readonly fullMask: number
  private readonly subsets: Array<Map<string, Bucket>> = []
  private combineCount = 0
  private entryCount = 0
  private rootCount = 0

  constructor(table: RuleTable, problem: OracleProblem, levelCap: number | null, rename: boolean) {
    this.table = table
    this.problem = problem
    this.levelCap = levelCap
    this.rename = rename
    this.leaves = problem.inputs.map((input): SimObject => ({
      kind: input.kind,
      itemType: input.itemType,
      levels: levelsToVector(table, input.enchantments),
      uses: input.anvilUses,
      named: false,
    }))
    this.targetBit = problem.targetIndex === null ? 0 : 1 << problem.targetIndex
    this.fullMask = (1 << problem.inputs.length) - 1
  }

  run(): void {
    this.leaves.forEach((leaf, index) => this.addLeaf(index, leaf))
    for (const mask of masksBySize(this.problem.inputs.length)) {
      if (bitCount(mask) >= 2) this.subsets[mask] = this.buildSubset(mask)
    }
  }

  /** Adds a rename-only variant when the input can be the base: the target, or any book when there is none. */
  private addLeaf(index: number, leaf: SimObject): void {
    const buckets = new Map<string, Bucket>()
    this.add(this.bucketFor(buckets, leaf), { total: 0, max: 0, xp: 0, left: null, right: null, input: index, rename: false })
    const canBeBase = this.targetBit === 0 ? leaf.kind === 'book' : index === this.problem.targetIndex
    if (this.rename && canBeBase) {
      this.combineCount++
      const renamed = simRenameOnly(this.table, leaf, this.levelCap)
      if (renamed.ok) {
        const { cost } = renamed
        this.add(this.bucketFor(buckets, renamed.result), { total: cost, max: cost, xp: xpForLevels(cost), left: null, right: null, input: index, rename: true })
      }
    }
    this.subsets[1 << index] = finished(buckets)
  }

  private buildSubset(mask: number): Map<string, Bucket> {
    const buckets = new Map<string, Bucket>()
    const hasTarget = (mask & this.targetBit) !== 0
    for (let left = (mask - 1) & mask; left > 0; left = (left - 1) & mask) {
      if (hasTarget && (left & this.targetBit) === 0) continue
      const right = mask ^ left
      // The rename +1 belongs on the target's line. With books only, the base is not known until the root, so every step may
      // rename; never placing a renamed object on the right still keeps the rename on the base's line
      const renameHere = this.rename && (this.targetBit === 0 || (left & this.targetBit) !== 0)
      for (const leftBucket of this.subsets[left].values()) {
        for (const rightBucket of this.subsets[right].values()) {
          if (rightBucket.obj.named) continue
          this.step(buckets, leftBucket, rightBucket, false)
          if (renameHere && !leftBucket.obj.named) this.step(buckets, leftBucket, rightBucket, true)
        }
      }
    }
    return finished(buckets)
  }

  private step(into: Map<string, Bucket>, left: Bucket, right: Bucket, rename: boolean): void {
    this.combineCount++
    const outcome = simCombine(this.table, left.obj, right.obj, this.levelCap, rename)
    if (!outcome.ok) return
    const cost = outcome.cost
    const xp = xpForLevels(cost)
    const bucket = this.bucketFor(into, outcome.result)
    for (const l of left.entries) {
      for (const r of right.entries) {
        this.add(bucket, { total: l.total + r.total + cost, max: Math.max(l.max, r.max, cost), xp: l.xp + r.xp + xp, left: l, right: r, input: -1, rename })
      }
    }
  }

  private bucketFor(into: Map<string, Bucket>, obj: SimObject): Bucket {
    const key = `${obj.kind}|${obj.itemType ?? ''}|${obj.uses}|${obj.named ? 1 : 0}|${obj.levels.join(',')}`
    let bucket = into.get(key)
    if (bucket === undefined) {
      bucket = { obj, entries: [], seen: new Set() }
      into.set(key, bucket)
    }
    return bucket
  }

  private add(bucket: Bucket, entry: Entry): void {
    const { seen } = bucket
    if (seen === null) throw new Error('oracle: a finished subset was extended')
    const key = valueKey(entry.total, entry.max, entry.xp)
    if (seen.has(key)) return
    seen.add(key)
    bucket.entries.push(entry)
    this.entryCount++
  }

  private isValidFinal(obj: SimObject): boolean {
    const wantKind = this.targetBit === 0 ? 'book' : 'item'
    return obj.kind === wantKind && obj.named === this.rename
  }

  selectWithGoal(goal: readonly number[]): Selection {
    const roots: number[] = []
    if (this.problem.useOnlyNeeded) {
      for (let mask = 1; mask <= this.fullMask; mask++) if ((mask & this.targetBit) === this.targetBit) roots.push(mask)
    } else {
      roots.push(this.fullMask)
    }
    const best: BestSoFar = {}
    for (const mask of roots) {
      for (const bucket of this.subsets[mask].values()) {
        if (!this.isValidFinal(bucket.obj)) continue
        if (!goal.every((level, position) => bucket.obj.levels[position] >= level)) continue
        for (const entry of bucket.entries) this.consider(best, mask, bucket, entry)
      }
    }
    return { best: completed(best), maximal: null, reachesAllReachable: null }
  }

  /**
   * Groups the final objects of plans that use every input by their enchantments and keeps the groups no other group beats
   * (at least as high on every enchantment and higher on one).
   */
  selectMaximal(reachable: EnchantLevels, eligible: readonly EnchantmentId[]): Selection {
    const groups = new Map<string, { readonly levels: readonly number[]; readonly best: BestSoFar }>()
    for (const bucket of this.subsets[this.fullMask].values()) {
      if (!this.isValidFinal(bucket.obj)) continue
      const key = bucket.obj.levels.join(',')
      let group = groups.get(key)
      if (group === undefined) {
        group = { levels: bucket.obj.levels, best: {} }
        groups.set(key, group)
      }
      for (const entry of bucket.entries) this.consider(group.best, this.fullMask, bucket, entry)
    }
    const all = [...groups.values()].map((group) => {
      // Every group got at least one entry, so all three objectives are filled
      const groupBest = completed(group.best)
      if (groupBest === null) throw new Error('oracle: a final object without any plan')
      return { levels: group.levels, best: groupBest }
    })
    const maximal = all.filter((group) => !all.some((other) => other !== group && dominates(other.levels, group.levels)))

    const best: BestSoFar = {}
    for (const group of maximal) {
      for (const objective of OBJECTIVES) keepSmaller(best, objective, group.best[objective])
    }

    const targets = eligible.flatMap((id) => {
      const position = this.table.position.get(id)
      const level = reachable[id] ?? 0
      return position === undefined || level === 0 ? [] : [[position, level] as const]
    })
    const reachesAllReachable = all.some((group) => targets.every(([position, level]) => group.levels[position] >= level))

    return {
      best: completed(best),
      maximal: maximal.map((group) => ({
        enchantments: vectorToLevels(this.table, group.levels),
        best: mapObjectives((objective) => ({ keys: group.best[objective].keys, planKeys: group.best[objective].planKeys })),
      })),
      reachesAllReachable,
    }
  }

  private consider(best: BestSoFar, mask: number, bucket: Bucket, entry: Entry): void {
    this.rootCount++
    const planKeys: PlanKeys = {
      totalLevels: entry.total,
      maxStepLevels: entry.max,
      xpPoints: entry.xp,
      finalPriorWorkPenalty: priorWorkPenalty(bucket.obj.uses),
      inputsUsed: bitCount(mask),
    }
    for (const objective of OBJECTIVES) keepSmaller(best, objective, { keys: keyVector(planKeys, objective), planKeys, mask, bucket, entry })
  }

  /** Replays the chosen tree as a self-check: a mismatch is a bug in the oracle. */
  choice(candidate: Candidate): OracleChoice {
    const tree = toTree(candidate.entry)
    const stepCosts: number[] = []
    const final = this.replay(tree, stepCosts)
    const total = stepCosts.reduce((sum, cost) => sum + cost, 0)
    const max = stepCosts.reduce((highest, cost) => Math.max(highest, cost), 0)
    const xp = stepCosts.reduce((sum, cost) => sum + xpForLevels(cost), 0)
    const { planKeys } = candidate
    if (total !== planKeys.totalLevels || max !== planKeys.maxStepLevels || xp !== planKeys.xpPoints
      || final.uses !== candidate.bucket.obj.uses || final.named !== candidate.bucket.obj.named
      || final.levels.join(',') !== candidate.bucket.obj.levels.join(',')) {
      throw new Error(`oracle: replaying the chosen tree does not reproduce its keys (${JSON.stringify(planKeys)} vs total ${total}, max ${max}, xp ${xp})`)
    }
    return {
      keys: candidate.keys,
      planKeys,
      tree,
      usedInputs: maskIndices(candidate.mask),
      final: fromSimObject(this.table, final),
      stepCosts,
    }
  }

  private replay(node: PlanNode, costs: number[]): SimObject {
    if (node.t === 'leaf') {
      const leaf = this.leaves[node.input]
      if (!node.preRename) return leaf
      const renamed = simRenameOnly(this.table, leaf, this.levelCap)
      if (!renamed.ok) throw new Error('oracle: a chosen rename-only step is refused on replay')
      costs.push(renamed.cost)
      return renamed.result
    }
    const left = this.replay(node.left, costs)
    const right = this.replay(node.right, costs)
    const outcome = simCombine(this.table, left, right, this.levelCap, node.rename)
    if (!outcome.ok) throw new Error(`oracle: a chosen step is refused on replay (${outcome.reason})`)
    costs.push(outcome.cost)
    return outcome.result
  }

  stats(): OracleStats {
    return { combines: this.combineCount, entries: this.entryCount, rootEntries: this.rootCount }
  }
}

function toTree(entry: Entry): PlanNode {
  if (entry.left === null || entry.right === null) return { t: 'leaf', input: entry.input, preRename: entry.rename }
  return { t: 'combine', left: toTree(entry.left), right: toTree(entry.right), rename: entry.rename }
}

/**
 * A number when the values fit in 52 bits (always, under a cap of 39), a string otherwise. A number never equals a string,
 * so merging stays exact either way.
 */
function valueKey(total: number, max: number, xp: number): number | string {
  return total < 2 ** 14 && max < 2 ** 14 && xp < 2 ** 24 ? (total * 2 ** 14 + max) * 2 ** 24 + xp : `${total}:${max}:${xp}`
}

/** Nothing is added to a finished subset, so its merge keys can go to free memory. */
function finished(buckets: Map<string, Bucket>): Map<string, Bucket> {
  for (const bucket of buckets.values()) bucket.seen = null
  return buckets
}

function mapObjectives<T>(make: (objective: Objective) => T): { [O in Objective]: T } {
  return { levels: make('levels'), xp: make('xp'), finalPwp: make('finalPwp') }
}

function keyVector(planKeys: PlanKeys, objective: Objective): KeyVector {
  const [a, b, c, d, e] = ORACLE_KEY_ORDER[objective]
  return [planKeys[a], planKeys[b], planKeys[c], planKeys[d], planKeys[e]]
}

export function compareKeys(a: KeyVector, b: KeyVector): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

function keepSmaller(best: BestSoFar, objective: Objective, candidate: Candidate): void {
  const current = best[objective]
  if (current === undefined || compareKeys(candidate.keys, current.keys) < 0) best[objective] = candidate
}

function completed(best: BestSoFar): BestPerObjective | null {
  const { levels, xp, finalPwp } = best
  return levels === undefined || xp === undefined || finalPwp === undefined ? null : { levels, xp, finalPwp }
}

function dominates(a: readonly number[], b: readonly number[]): boolean {
  let greater = false
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return false
    if (a[i] > b[i]) greater = true
  }
  return greater
}

function sortMaximal(maximal: readonly OracleMaximal[], objective: Objective): OracleMaximal[] {
  return [...maximal].sort((a, b) => compareKeys(a.best[objective].keys, b.best[objective].keys))
}

function bitCount(mask: number): number {
  let count = 0
  for (let rest = mask; rest !== 0; rest &= rest - 1) count++
  return count
}

function maskIndices(mask: number): number[] {
  const indices: number[] = []
  for (let index = 0; 1 << index <= mask; index++) if ((mask & (1 << index)) !== 0) indices.push(index)
  return indices
}

/** Ordered by size, so every subset comes after its own subsets. */
const MASK_ORDERS = new Map<number, readonly number[]>()
function masksBySize(n: number): readonly number[] {
  let order = MASK_ORDERS.get(n)
  if (order === undefined) {
    order = Array.from({ length: (1 << n) - 1 }, (_, i) => i + 1).sort((a, b) => bitCount(a) - bitCount(b) || a - b)
    MASK_ORDERS.set(n, order)
  }
  return order
}
