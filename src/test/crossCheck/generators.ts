// Shapes that the oracle's generators (src/test/oracle/generators.ts) rarely produce.

import fc from 'fast-check'
import { applicableEnchantments, areCompatible, enchantmentsInEdition, isApplicable, itemsInEdition, maxLevel } from '../../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, Objective, Settings, SimpleProblem, TargetInput } from '../../engine/types.ts'
import { validateProblem } from '../../engine/validate.ts'
import type { OracleCase } from '../oracle/generators.ts'

const weighted = <T>(...options: ReadonlyArray<readonly [number, fc.Arbitrary<T>]>): fc.Arbitrary<T> =>
  fc.oneof(...options.map(([weight, arbitrary]) => ({ weight, arbitrary })))

/** weights[n] is the weight of length n; fc.array alone leans toward short arrays. */
function countedArb<T>(item: fc.Arbitrary<T>, weights: readonly number[]): fc.Arbitrary<T[]> {
  return weighted(...weights.map((weight, length) => [weight, fc.array(item, { minLength: length, maxLength: length })] as const))
}

function damageableItems(edition: Edition, minApplicable: number): ItemTypeId[] {
  return itemsInEdition(edition)
    .filter((item) => !item.isBook && item.damageable && applicableEnchantments(edition, item.id).length >= minApplicable)
    .map((item) => item.id)
}

function compatibleSubset(edition: Edition, ids: readonly EnchantmentId[], chosen: readonly EnchantmentId[] = []): EnchantmentId[] {
  const kept: EnchantmentId[] = []
  for (const id of ids) if (![...chosen, ...kept].some((other) => !areCompatible(edition, id, other))) kept.push(id)
  return kept
}

function levelsOf(ids: readonly EnchantmentId[], levels: readonly number[]): EnchantLevels {
  const result: EnchantLevels = {}
  ids.forEach((id, i) => { result[id] = 1 + (levels[i] % maxLevel(id)) })
  return result
}

function isValid(testCase: OracleCase): boolean {
  return validateProblem(testCase.problem, testCase.settings).length === 0
}

const objectiveArb: fc.Arbitrary<Objective> = weighted<Objective>([4, fc.constant('levels')], [1, fc.constant('xp')], [1, fc.constant('finalPwp')])

export interface PipelineCaseOptions {
  readonly editions?: readonly Edition[]
  readonly maxBooks?: number                // not counting the target
}

interface PipelineDraft {
  readonly settings: Settings
  readonly itemType: ItemTypeId
  readonly bookOnly: boolean
  readonly goalIds: readonly EnchantmentId[]
  readonly goalLevels: readonly number[]
  /** Goal book level: the goal level when false, the max level when true. */
  readonly goalBookHigh: readonly boolean[]
  /** Splits a goal enchantment into two lower-level books that stack up to it. */
  readonly splitGoal: readonly boolean[]
  readonly extraPicks: readonly (readonly number[])[]
  readonly foreignExtra: number | null
  readonly targetEnchant: number | null
  readonly targetUses: number
  readonly blockers: readonly number[]
  readonly sharers: readonly number[]
  readonly bookUses: readonly number[]
  readonly useOnlyNeeded: boolean
}

/**
 * Goal problems that catch the pipeline wrongly choosing the tree-table method: goal books carry extra enchantments,
 * blockers (books without goal enchantments) conflict with those extras or the target, some books only share an ID with a
 * used book, and some enchantments do not fit the target.
 */
export function pipelineCaseArb(options: PipelineCaseOptions = {}): fc.Arbitrary<OracleCase> {
  const editions = options.editions ?? ['java', 'bedrock']
  const maxBooks = options.maxBooks ?? 7
  return fc.constantFrom(...editions).chain((edition) => {
    // Items that accept many enchantments, so that books can conflict with the extras on goal books
    const items = damageableItems(edition, 5)
    return fc.record({
      settings: fc.record({
        edition: fc.constant(edition),
        levelCap: weighted<39 | null>([3, fc.constant(39)], [1, fc.constant(null)]),
        // The tree-table method applies only to the levels objective, so favor it
        objective: weighted<Objective>([8, fc.constant('levels')], [1, fc.constant('xp')], [1, fc.constant('finalPwp')]),
        rename: weighted([3, fc.constant(false)], [1, fc.constant(true)]),
      }),
      itemType: fc.constantFrom(...items),
      bookOnly: weighted([9, fc.constant(false)], [1, fc.constant(true)]),
      goalLevels: fc.array(fc.nat(), { minLength: 3, maxLength: 3 }),
      goalBookHigh: fc.array(fc.boolean(), { minLength: 3, maxLength: 3 }),
      splitGoal: fc.array(weighted([5, fc.constant(false)], [1, fc.constant(true)]), { minLength: 3, maxLength: 3 }),
      extraPicks: fc.array(countedArb(fc.nat(), [1, 2, 1]), { minLength: 3, maxLength: 3 }),
      foreignExtra: weighted<number | null>([3, fc.constant(null)], [1, fc.nat()]),
      targetEnchant: weighted<number | null>([2, fc.constant(null)], [1, fc.nat()]),
      targetUses: fc.integer({ min: 0, max: 2 }),
      blockers: countedArb(fc.nat(), [1, 2, 1]),
      sharers: countedArb(fc.nat(), [2, 1, 1]),
      bookUses: fc.array(weighted([11, fc.constant(0)], [1, fc.constant(1)]), { minLength: 12, maxLength: 12 }),
      useOnlyNeeded: weighted([6, fc.constant(true)], [1, fc.constant(false)]),
    }).chain((draft) => {
      const pool = applicableEnchantments(edition, draft.itemType)
      return fc.shuffledSubarray([...pool], { minLength: 1, maxLength: Math.min(3, pool.length) })
        .map((ids) => assemblePipeline(edition, { ...draft, goalIds: compatibleSubset(edition, ids) }, maxBooks))
    })
  }).filter(isValid)
}

function assemblePipeline(edition: Edition, draft: PipelineDraft, maxBooks: number): OracleCase {
  const pool = applicableEnchantments(edition, draft.itemType)
  const all = enchantmentsInEdition(edition).map((e) => e.id)
  const goal: EnchantLevels = levelsOf(draft.goalIds, draft.goalLevels)

  // Target: 0 or 1 enchantment compatible with the goal, which may block an extra from transferring
  const targetCandidates = compatibleSubset(edition, pool.filter((id) => !draft.goalIds.includes(id)), draft.goalIds)
  const targetIds = draft.targetEnchant === null || targetCandidates.length === 0 ? [] : [targetCandidates[draft.targetEnchant % targetCandidates.length]]
  const targetLevels = levelsOf(targetIds, [draft.targetEnchant ?? 0])

  const books: EnchantLevels[] = []
  const extrasOnGoalBooks: EnchantmentId[] = []
  draft.goalIds.forEach((id, i) => {
    const level = goal[id] ?? 1
    const candidates = pool.filter((other) => !draft.goalIds.includes(other))
    const picked = draft.extraPicks[i].map((pick) => candidates[pick % Math.max(1, candidates.length)]).filter((other) => other !== undefined)
    if (i === 0 && draft.foreignExtra !== null) {
      const foreign = all.filter((other) => !isApplicable(edition, draft.itemType, other))
      if (foreign.length > 0) picked.push(foreign[draft.foreignExtra % foreign.length])
    }
    const extras = compatibleSubset(edition, [...new Set(picked)], [id])
    extrasOnGoalBooks.push(...extras)
    const extraLevels = levelsOf(extras, draft.extraPicks[i])
    if (draft.splitGoal[i] && level >= 2) {
      books.push({ [id]: level - 1, ...extraLevels }, { [id]: level - 1 })
    } else {
      books.push({ [id]: draft.goalBookHigh[i] ? maxLevel(id) : level, ...extraLevels })
    }
  })
  // Blockers conflict with an extra or with the target's enchantment
  const blockTargets = [...new Set([...extrasOnGoalBooks, ...targetIds])]
  for (const pick of draft.blockers) {
    if (blockTargets.length === 0) break
    const victim = blockTargets[pick % blockTargets.length]
    const partners = all.filter((id) => !areCompatible(edition, id, victim) && !draft.goalIds.includes(id))
    if (partners.length === 0) continue
    const id = partners[pick % partners.length]
    books.push({ [id]: 1 + (pick % maxLevel(id)) })
  }
  // Books that only share an ID with a used book, without conflicting
  for (const pick of draft.sharers) {
    if (extrasOnGoalBooks.length === 0) break
    const id = extrasOnGoalBooks[pick % extrasOnGoalBooks.length]
    books.push({ [id]: 1 + (pick % maxLevel(id)) })
  }

  const bookInputs: BookInput[] = books.slice(0, maxBooks).map((enchantments, i) => ({ enchantments, anvilUses: draft.bookUses[i % draft.bookUses.length] }))
  const target: TargetInput | null = draft.bookOnly ? null : { itemType: draft.itemType, enchantments: targetLevels, anvilUses: draft.targetUses }
  const problem: AdvancedProblem = { mode: 'advanced', target, extraItems: [], books: bookInputs, goal, useOnlyNeeded: draft.useOnlyNeeded }
  return { problem, settings: draft.settings }
}

export interface AdditiveCaseOptions {
  readonly editions?: readonly Edition[]
  readonly minBooks?: number
  readonly maxBooks?: number
}

/**
 * Additive problems (nothing conflicts and no level merges, so each book's cost simply adds up), built from a random
 * maximal set of mutually compatible enchantments in the real data.
 */
export function additiveCaseArb(options: AdditiveCaseOptions = {}): fc.Arbitrary<OracleCase> {
  const editions = options.editions ?? ['java', 'bedrock']
  const minBooks = options.minBooks ?? 1
  const maxBooks = options.maxBooks ?? 10
  return fc.constantFrom(...editions).chain((edition) => {
    const items = itemsInEdition(edition).filter((item) => !item.isBook && applicableEnchantments(edition, item.id).length >= 1).map((item) => item.id)
    return fc.record({
      bookOnly: weighted([4, fc.constant(false)], [1, fc.constant(true)]),
      itemType: fc.constantFrom(...items),
      order: fc.array(fc.nat(), { minLength: 43, maxLength: 43 }),
      levels: fc.array(fc.nat(), { minLength: 43, maxLength: 43 }),
      books: fc.integer({ min: minBooks, max: maxBooks }),
      pairs: fc.array(fc.boolean(), { minLength: 43, maxLength: 43 }),
      targetUses: weighted([2, fc.constant(0)], [1, fc.integer({ min: 1, max: 3 })]),
      targetHas: fc.boolean(),
      shape: fc.constantFrom('no-goal', 'simple', 'goal'),
      rename: weighted([3, fc.constant(false)], [1, fc.constant(true)]),
    }).map((draft): OracleCase => {
      // With books only, the set comes from every enchantment, which allows problems with more than 10 books
      const pool = draft.bookOnly ? enchantmentsInEdition(edition).map((e) => e.id) : applicableEnchantments(edition, draft.itemType)
      const shuffled = pool.map((id, i) => [id, draft.order[i]] as const).sort((a, b) => a[1] - b[1]).map(([id]) => id)
      const set = compatibleSubset(edition, shuffled)
      const levels = levelsOf(set, draft.levels)
      const targetIds = !draft.bookOnly && draft.targetHas && set.length > 1 ? [set[set.length - 1]] : []
      const bookIds = set.filter((id) => !targetIds.includes(id))
      // Where pairs[i] is set, the next enchantment shares the book
      const groups: EnchantmentId[][] = []
      for (let i = 0; i < bookIds.length && groups.length < draft.books; i++) {
        const group = [bookIds[i]]
        if (draft.pairs[i] && i + 1 < bookIds.length && groups.length + 1 < draft.books) group.push(bookIds[++i])
        groups.push(group)
      }
      const bookLevels = groups.map((group) => Object.fromEntries(group.map((id) => [id, levels[id] ?? 1])) as EnchantLevels)
      const simple = draft.shape === 'simple' && !draft.bookOnly && groups.every((group) => group.length === 1)
      // Rename only when the base has 0 anvil uses; otherwise the problem goes to the exact search
      const freshBase = simple || draft.bookOnly || draft.targetUses === 0
      const settings: Settings = { edition, levelCap: null, objective: 'levels', rename: draft.rename && freshBase }
      if (simple) {
        const problem: SimpleProblem = { mode: 'simple', item: draft.itemType, enchantments: groups.map(([id]) => ({ id, level: levels[id] ?? 1 })) }
        return { problem, settings }
      }
      const target: TargetInput | null = draft.bookOnly ? null : { itemType: draft.itemType, enchantments: levelsOf(targetIds, draft.levels), anvilUses: draft.targetUses }
      const goal: EnchantLevels | null = draft.shape === 'goal' ? Object.assign({}, ...bookLevels) as EnchantLevels : null
      const problem: AdvancedProblem = {
        mode: 'advanced',
        target,
        extraItems: [],
        books: bookLevels.map((enchantments) => ({ enchantments, anvilUses: 0 })),
        goal,
        useOnlyNeeded: goal !== null,
      }
      return { problem, settings }
    })
  }).filter(isValid)
}

export interface ExpensiveCaseOptions {
  readonly editions?: readonly Edition[]
  /** The oracle accepts up to 8. */
  readonly maxInputs?: number
}

/**
 * Near-max books on a target with prior work, under a cap of 39, to bring out too-expensive diagnoses, smallest workable
 * caps and suggestions.
 */
export function expensiveCaseArb(options: ExpensiveCaseOptions = {}): fc.Arbitrary<OracleCase> {
  const editions = options.editions ?? ['java', 'bedrock']
  const maxInputs = options.maxInputs ?? 7
  return fc.constantFrom(...editions).chain((edition) => {
    const items = damageableItems(edition, 2)
    return fc.record({
      itemType: fc.constantFrom(...items),
      targetUses: fc.integer({ min: 2, max: 5 }),
      bookCount: fc.integer({ min: 2, max: Math.min(6, maxInputs - 1) }),
      picks: fc.array(fc.array(fc.nat(), { minLength: 1, maxLength: 2 }), { minLength: 6, maxLength: 6 }),
      bookUses: fc.array(weighted([2, fc.constant(0)], [1, fc.integer({ min: 1, max: 2 })]), { minLength: 6, maxLength: 6 }),
      high: fc.array(weighted([3, fc.constant(true)], [1, fc.constant(false)]), { minLength: 6, maxLength: 6 }),
      goal: weighted<number | null>([1, fc.constant(null)], [1, fc.nat()]),
      useOnlyNeeded: fc.boolean(),
      objective: objectiveArb,
      rename: weighted([4, fc.constant(false)], [1, fc.constant(true)]),
    }).map((draft): OracleCase => {
      const pool = applicableEnchantments(edition, draft.itemType)
      const books: BookInput[] = []
      for (let i = 0; i < draft.bookCount; i++) {
        const ids = compatibleSubset(edition, [...new Set(draft.picks[i].map((pick) => pool[pick % pool.length]))])
        const enchantments: EnchantLevels = {}
        for (const id of ids) enchantments[id] = draft.high[i] ? maxLevel(id) : Math.max(1, maxLevel(id) - 1)
        books.push({ enchantments, anvilUses: draft.bookUses[i] })
      }
      let goal: EnchantLevels | null = null
      if (draft.goal !== null) {
        const present = compatibleSubset(edition, [...new Set(books.flatMap((book) => Object.keys(book.enchantments) as EnchantmentId[]))])
        const chosen = present.filter((_, i) => ((draft.goal ?? 0) >> i) % 2 === 1)
        const ids = chosen.length > 0 ? chosen : present.slice(0, 1)
        goal = Object.fromEntries(ids.map((id) => [id, Math.max(1, maxLevel(id) - 1)])) as EnchantLevels
      }
      const problem: AdvancedProblem = {
        mode: 'advanced',
        target: { itemType: draft.itemType, enchantments: {}, anvilUses: draft.targetUses },
        extraItems: [],
        books,
        goal,
        useOnlyNeeded: goal !== null && draft.useOnlyNeeded,
      }
      return { problem, settings: { edition, levelCap: 39, objective: draft.objective, rename: draft.rename } }
    })
  }).filter(isValid)
}

export function sample<T>(arbitrary: fc.Arbitrary<T>, count: number, seed: number): T[] {
  return fc.sample(arbitrary, { numRuns: count, seed })
}
