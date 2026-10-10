import { applicableEnchantments, areCompatible, enchantmentsInEdition, getItem, maxLevel } from '../data/gameData.ts'
import type { Edition, EnchantmentId } from '../data/types.ts'
import { canonicalLevels, levelEntries } from './rules.ts'
import type {
  AdvancedProblem,
  EnchantLevels,
  EngineInput,
  NormalizedProblem,
  Problem,
  Settings,
  SimpleProblem,
} from './types.ts'

type NormalizedInputs = Pick<NormalizedProblem, 'inputs' | 'targetIndex' | 'goal' | 'useOnlyNeeded'>

/** Expects a validated problem. Inputs are ordered target, extra items, then books with their copies expanded. */
export function normalizeProblem(problem: Problem, settings: Pick<Settings, 'edition'>): NormalizedProblem {
  const base = problem.mode === 'simple' ? normalizeSimple(problem) : normalizeAdvanced(problem)
  return {
    ...base,
    reachable: reachableLevels(base.inputs),
    eligible: eligibleEnchantments(settings.edition, base.targetIndex === null ? null : base.inputs[base.targetIndex]),
    excludedInputs: excludedInputs(settings.edition, base),
  }
}

function normalizeSimple(problem: SimpleProblem): NormalizedInputs {
  const inputs: EngineInput[] = []
  const bookOnly = getItem(problem.item).isBook
  if (!bookOnly) {
    inputs.push({ kind: 'item', itemType: problem.item, enchantments: {}, anvilUses: 0, origin: { source: 'simple-item', itemType: problem.item } })
  }
  const goal: EnchantLevels = {}
  for (const request of problem.enchantments) {
    goal[request.id] = request.level
    // Copies of the same level are numbered for the input labels
    const copies = new Map<number, number>()
    for (const stack of request.sources ?? [{ level: request.level, count: 1 }]) {
      for (let i = 0; i < stack.count; i++) {
        const copy = copies.get(stack.level) ?? 0
        copies.set(stack.level, copy + 1)
        inputs.push({
          kind: 'book',
          itemType: null,
          enchantments: { [request.id]: stack.level },
          anvilUses: 0,
          origin: { source: 'simple-book', enchantment: request.id, level: stack.level, copy },
        })
      }
    }
  }
  return { inputs, targetIndex: bookOnly ? null : 0, goal: canonicalLevels(goal), useOnlyNeeded: true }
}

function normalizeAdvanced(problem: AdvancedProblem): NormalizedInputs {
  const { target } = problem
  const inputs: EngineInput[] = []
  if (target !== null) {
    inputs.push({ kind: 'item', itemType: target.itemType, enchantments: canonicalLevels(target.enchantments), anvilUses: target.anvilUses, origin: { source: 'target' } })
  }
  problem.extraItems.forEach((extra, index) => {
    if (target === null) throw new Error('extra items need a target: run validateProblem before normalizeProblem')
    inputs.push({ kind: 'item', itemType: target.itemType, enchantments: canonicalLevels(extra.enchantments), anvilUses: extra.anvilUses, origin: { source: 'extra-item', index } })
  })
  problem.books.forEach((book, index) => {
    const enchantments = canonicalLevels(book.enchantments)
    for (let copy = 0; copy < (book.count ?? 1); copy++) {
      inputs.push({ kind: 'book', itemType: null, enchantments, anvilUses: book.anvilUses, origin: { source: 'book', index, copy } })
    }
  })
  const goal = problem.goal === null ? null : canonicalLevels(problem.goal)
  return { inputs, targetIndex: target === null ? null : 0, goal, useOnlyNeeded: goal !== null && problem.useOnlyNeeded }
}

/**
 * The reachable level U(E): the highest level that merging every copy of E on the inputs could give. Two copies of
 * level L merge into L + 1 and unequal levels keep the higher one, so a leftover copy never helps: I x3 -> II, but I x3
 * and II -> III. Cost, conflicts and the other enchantments on the same inputs are ignored, so this is an upper bound,
 * and several enchantments may not reach theirs together.
 *
 * levels holds the level of E on each input that carries it; levels above max count as max. 0 when there are none.
 */
export function reachableLevel(levels: readonly number[], max: number): number {
  const count = new Array<number>(max + 1).fill(0)
  for (const level of levels) if (level >= 1) count[Math.min(level, max)]++
  for (let level = 1; level < max; level++) count[level + 1] += Math.floor(count[level] / 2)
  for (let level = max; level >= 1; level--) if (count[level] > 0) return level
  return 0
}

function reachableLevels(inputs: readonly EngineInput[]): EnchantLevels {
  const levelsById = new Map<EnchantmentId, number[]>()
  for (const input of inputs) {
    for (const [id, level] of levelEntries(input.enchantments)) {
      const levels = levelsById.get(id)
      if (levels === undefined) levelsById.set(id, [level])
      else levels.push(level)
    }
  }
  const reachable: EnchantLevels = {}
  for (const [id, levels] of levelsById) reachable[id] = reachableLevel(levels, maxLevel(id))
  return canonicalLevels(reachable)
}

function eligibleEnchantments(edition: Edition, target: EngineInput | null): EnchantmentId[] {
  if (target === null || target.itemType === null) return enchantmentsInEdition(edition).map((e) => e.id)
  const existing = levelEntries(target.enchantments).map(([id]) => id)
  return applicableEnchantments(edition, target.itemType).filter((id) => existing.every((other) => areCompatible(edition, id, other)))
}

/**
 * Books with no goal enchantment that share no enchantment with, and conflict with none on, a kept input. Removing them
 * from a plan tree (drop the leaf, drop any step through which nothing transfers any more together with its right part,
 * and move the name to a rename-only step of the base, which costs less than the dropped steps) keeps every remaining
 * level and conflict and only lowers prior work penalties. No step costs more and the goal is still met with fewer
 * inputs, so an optimal plan never uses these books.
 *
 * Books that share an enchantment with a kept input stay, because Bedrock charges only for the levels gained and a
 * higher base can absorb the same enchantment more cheaply. Books with an exclusive enchantment stay too: blocking
 * another enchantment can make a plan cheaper (a Smite book that blocks Sharpness). Sharing or conflicts among the
 * left-out books do not matter.
 *
 * Computes the largest such set: start from every candidate and move back any that shares or conflicts with a kept
 * input, until nothing changes.
 */
function excludedInputs(edition: Edition, base: NormalizedInputs): number[] {
  const { inputs, goal } = base
  if (goal === null || !base.useOnlyNeeded) return []
  const goalIds = new Set(levelEntries(goal).map(([id]) => id))
  const idsOf = (index: number): EnchantmentId[] => levelEntries(inputs[index].enchantments).map(([id]) => id)
  const excluded = new Set<number>()
  inputs.forEach((input, index) => {
    if (input.kind === 'book' && idsOf(index).every((id) => !goalIds.has(id))) excluded.add(index)
  })
  for (let changed = excluded.size > 0; changed;) {
    changed = false
    const kept = new Set<EnchantmentId>()
    inputs.forEach((_, index) => {
      if (!excluded.has(index)) for (const id of idsOf(index)) kept.add(id)
    })
    for (const index of excluded) {
      const interacts = idsOf(index).some((id) => kept.has(id) || [...kept].some((other) => !areCompatible(edition, id, other)))
      if (interacts) {
        excluded.delete(index)
        changed = true
      }
    }
  }
  return [...excluded].sort((a, b) => a - b)
}

/** Inputs with identical contents. The target is never in a group. */
export interface InputGroup {
  /** Ascending; plan reconstruction assigns the used copies in this order. */
  readonly inputs: readonly number[]
}

/**
 * Identical inputs are interchangeable, so counting subsets as "how many of each group" removes symmetric duplicates.
 * Groups are ordered by their first input.
 */
export function groupInputs(np: NormalizedProblem): InputGroup[] {
  const groups = new Map<string, number[]>()
  const excluded = new Set(np.excludedInputs)
  np.inputs.forEach((input, index) => {
    if (index === np.targetIndex || excluded.has(index)) return
    const key = inputKey(input)
    const members = groups.get(key)
    if (members === undefined) groups.set(key, [index])
    else members.push(index)
  })
  return [...groups.values()].map((inputs) => ({ inputs }))
}

function inputKey(input: EngineInput): string {
  const levels = levelEntries(input.enchantments).map(([id, level]) => `${id}=${level}`).join(',')
  return `${input.kind}|${input.itemType ?? ''}|${input.anvilUses}|${levels}`
}
