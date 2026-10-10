// Valid random problems small enough for ./bruteForce.ts to enumerate. The weights make every CaseFeature common enough to
// bring out rule differences (generators.test.ts checks the frequencies). Each problem draws its books from a few
// enchantments (a theme), so the same IDs recur across books and exclusive pairs are likely.

import fc from 'fast-check'
import type { Edition, EnchantmentId, ItemTypeId } from '../../data/types.ts'
import type {
  AdvancedProblem,
  BookInput,
  BookStack,
  EnchantLevels,
  ItemInput,
  Objective,
  Problem,
  Settings,
  SimpleEnchantmentRequest,
  SimpleProblem,
} from '../../engine/types.ts'
import { presentIds } from './anvil.ts'
import { oracleNormalize, reachableLevelOf } from './bruteForce.ts'
import { areExclusive, canApply, enchantmentsOf, isBookType, isDamageable, itemTypesOf, maxLevelOf } from './gameFacts.ts'

export interface OracleCase {
  readonly problem: Problem
  readonly settings: Settings
}

export interface CaseOptions {
  readonly editions?: readonly Edition[]
  /** Counted after normalization: the target, spare items and every book copy. */
  readonly minInputs?: number
  /** The default of 7 keeps the oracle at tens of milliseconds per case. */
  readonly maxInputs?: number
}

interface ResolvedOptions {
  readonly editions: readonly Edition[]
  readonly minInputs: number
  readonly maxInputs: number
}

function resolve(options: CaseOptions): ResolvedOptions {
  const editions = options.editions ?? ['java', 'bedrock']
  const minInputs = options.minInputs ?? 2
  const maxInputs = options.maxInputs ?? 7
  if (editions.length === 0 || minInputs < 1 || maxInputs < minInputs) throw new Error(`bad generator options: ${JSON.stringify(options)}`)
  return { editions, minInputs, maxInputs }
}

export function oracleCaseArb(options: CaseOptions = {}): fc.Arbitrary<OracleCase> {
  return fc.oneof({ weight: 1, arbitrary: simpleCaseArb(options) }, { weight: 2, arbitrary: advancedCaseArb(options) })
}

export function sampleOracleCases(count: number, seed: number, options: CaseOptions = {}): OracleCase[] {
  return fc.sample(oracleCaseArb(options), { numRuns: count, seed })
}

export function countInputs(problem: Problem): number {
  return oracleNormalize(problem).inputs.length
}

const weighted = <T>(...options: ReadonlyArray<readonly [number, fc.Arbitrary<T>]>): fc.Arbitrary<T> =>
  fc.oneof(...options.map(([weight, arbitrary]) => ({ weight, arbitrary })))

export function settingsArb(edition: Edition): fc.Arbitrary<Settings> {
  return fc.record({
    edition: fc.constant(edition),
    levelCap: weighted<39 | null>([3, fc.constant(39)], [1, fc.constant(null)]),
    objective: weighted<Objective>([2, fc.constant('levels')], [1, fc.constant('xp')], [1, fc.constant('finalPwp')]),
    rename: weighted([3, fc.constant(false)], [1, fc.constant(true)]),
  })
}

function itemTypeArb(edition: Edition): fc.Arbitrary<ItemTypeId> {
  const types = itemTypesOf(edition)
  const damageable = types.filter((type) => !isBookType(type) && isDamageable(type))
  const plain = types.filter((type) => !isBookType(type) && !isDamageable(type))
  const book = types.filter((type) => isBookType(type))
  return weighted([12, fc.constantFrom(...damageable)], [3, fc.constantFrom(...book)], [1, fc.constantFrom(...plain)])
}

/** For books only, the theme comes from what some real item can take, so conflicts happen in realistic combinations. */
function themeArb(edition: Edition, itemType: ItemTypeId): fc.Arbitrary<EnchantmentId[]> {
  const all = enchantmentsOf(edition)
  const poolFor = (type: ItemTypeId): EnchantmentId[] => all.filter((id) => canApply(edition, type, id))
  const reference = isBookType(itemType)
    ? fc.constantFrom(...itemTypesOf(edition).filter((type) => !isBookType(type) && isDamageable(type)))
    : fc.constant(itemType)
  return reference.chain((type) => {
    const applicable = poolFor(type)
    const pool = applicable.length > 0 ? applicable : all
    const foreign = all.filter((id) => !pool.includes(id))
    return fc.record({
      picked: fc.shuffledSubarray(pool, { minLength: 1, maxLength: Math.min(4, pool.length) }),
      partner: weighted<number | null>([1, fc.constant(null)], [2, fc.nat()]),
      stranger: weighted<number | null>([4, fc.constant(null)], [1, fc.nat()]),
    }).map(({ picked, partner, stranger }) => {
      const theme = [...picked]
      // Prefer an applicable partner. An inapplicable one checks that Java still charges for the conflict
      const exclusive = all.filter((id) => areExclusive(edition, picked[0], id))
      const partners = exclusive.some((id) => pool.includes(id)) ? exclusive.filter((id) => pool.includes(id)) : exclusive
      if (partner !== null && partners.length > 0) theme.push(partners[partner % partners.length])
      if (stranger !== null && foreign.length > 0) theme.push(foreign[stranger % foreign.length])
      return [...new Set(theme)]
    })
  })
}

/** Extra weight on level 1 and the max, so stacking low levels and combining max levels both come up often. */
function levelArb(max: number): fc.Arbitrary<number> {
  return weighted([2, fc.integer({ min: 1, max })], [1, fc.constant(max)], [1, fc.constant(1)])
}

function withoutSelfConflicts(edition: Edition, ids: readonly EnchantmentId[]): EnchantmentId[] {
  const kept: EnchantmentId[] = []
  for (const id of ids) if (!kept.some((other) => areExclusive(edition, id, other))) kept.push(id)
  return kept
}

/** Dropping self-conflicts can go below minCount, but never to zero: the first pick always stays. */
function levelsArb(edition: Edition, ids: readonly EnchantmentId[], minCount: number, maxCount: number): fc.Arbitrary<EnchantLevels> {
  if (ids.length === 0) return fc.constant({})
  return fc.shuffledSubarray([...ids], { minLength: Math.min(minCount, ids.length), maxLength: Math.min(maxCount, ids.length) })
    .map((picked) => withoutSelfConflicts(edition, picked))
    .chain((picked) => fc.tuple(...picked.map((id) => levelArb(maxLevelOf(id)))).map((levels) => {
      const result: EnchantLevels = {}
      picked.forEach((id, index) => { result[id] = levels[index] })
      return result
    }))
}

/** Weighted toward the upper half: small problems cover their variations in fewer samples. */
function budgetArb(minInputs: number, maxInputs: number): fc.Arbitrary<number> {
  const middle = Math.ceil((minInputs + maxInputs) / 2)
  return weighted([1, fc.integer({ min: minInputs, max: maxInputs })], [2, fc.integer({ min: middle, max: maxInputs })])
}

function usesArb(max: number): fc.Arbitrary<number> {
  return weighted([1, fc.constant(0)], [1, fc.integer({ min: 1, max })])
}

interface GoalPick {
  readonly pick: number
  readonly levelPick: number
  /** One level above U(E), which is out of reach. */
  readonly beyond: boolean
}

interface AdvancedDraft {
  readonly settings: Settings
  readonly target: ItemInput
  readonly extras: readonly ItemInput[]
  readonly books: readonly (BookInput & { readonly count: number })[]
  readonly budget: number
  readonly goal: { readonly picks: readonly GoalPick[]; readonly missing: number | null } | null
  /** Swaps one copy of the last book for a level 1 book whose only enchantment is exclusive with another input's. */
  readonly blocker: number | null
  readonly useOnlyNeeded: boolean
}

export function advancedCaseArb(options: CaseOptions = {}): fc.Arbitrary<AdvancedProblemCase> {
  const { editions, minInputs, maxInputs } = resolve(options)
  return fc.constantFrom(...editions).chain((edition) => itemTypeArb(edition).chain((itemType) => themeArb(edition, itemType).chain((theme) => {
    const bookOnly = isBookType(itemType)
    const onItem = bookOnly ? [] : theme.filter((id) => canApply(edition, itemType, id))
    const itemInputArb = (maxUses: number): fc.Arbitrary<ItemInput> =>
      fc.record({ enchantments: levelsArb(edition, onItem, 0, 2), anvilUses: usesArb(maxUses) })
    const bookArb = fc.record({
      enchantments: levelsArb(edition, theme, 1, 3),
      anvilUses: weighted([2, fc.constant(0)], [1, fc.integer({ min: 1, max: 2 })]),
      count: weighted([3, fc.constant(1)], [1, fc.integer({ min: 2, max: 3 })]),
    })
    const canHaveExtras = !bookOnly && isDamageable(itemType)
    return fc.record({
      settings: settingsArb(edition),
      target: itemInputArb(3),
      extras: canHaveExtras
        ? weighted<ItemInput[]>([3, fc.constant([])], [1, fc.array(itemInputArb(2), { minLength: 1, maxLength: 2 })])
        : fc.constant<ItemInput[]>([]),
      books: fc.array(bookArb, { minLength: maxInputs, maxLength: maxInputs }),
      budget: budgetArb(minInputs, maxInputs),
      goal: weighted<AdvancedDraft['goal']>(
        [1, fc.constant(null)],
        [2, fc.record({
          picks: fc.array(fc.record({ pick: fc.nat(), levelPick: fc.nat(), beyond: weighted([7, fc.constant(false)], [1, fc.constant(true)]) }), { minLength: 1, maxLength: 3 }),
          missing: weighted<number | null>([9, fc.constant(null)], [1, fc.nat()]),
        })],
      ),
      blocker: weighted<number | null>([3, fc.constant(null)], [1, fc.nat()]),
      useOnlyNeeded: fc.boolean(),
    }).map((draft) => assembleAdvanced(edition, bookOnly ? null : itemType, theme, draft))
  })))
}

export interface AdvancedProblemCase extends OracleCase {
  readonly problem: AdvancedProblem
}

function assembleAdvanced(edition: Edition, itemType: ItemTypeId | null, theme: readonly EnchantmentId[], draft: AdvancedDraft): AdvancedProblemCase {
  let slots = draft.budget - (itemType === null ? 0 : 1)
  // Spare items only up to the point where at least one book still fits
  const extras = itemType === null ? [] : draft.extras.slice(0, Math.max(0, Math.min(draft.extras.length, slots - 1)))
  slots -= extras.length
  const books: BookInput[] = []
  for (const book of draft.books) {
    const count = Math.min(book.count, slots)
    if (count <= 0) break
    books.push(count === 1 ? { enchantments: book.enchantments, anvilUses: book.anvilUses } : { ...book, count })
    slots -= count
  }
  const target = itemType === null ? null : { itemType, enchantments: draft.target.enchantments, anvilUses: draft.target.anvilUses }
  const inputsOf = (list: readonly BookInput[]): ItemInput[] =>
    [...(target === null ? [] : [target]), ...extras, ...list.flatMap((book) => Array<ItemInput>(book.count ?? 1).fill(book))]

  // Swapping keeps the input count. The goal comes from the inputs before the swap, so the blocker carries no goal
  // enchantment unless it happens to share an ID with another input
  let finalBooks = books
  let goalInputs = inputsOf(books)
  const withoutLast = withoutLastCopy(books)
  if (draft.blocker !== null && withoutLast !== null) {
    const present = [...new Set(inputsOf(withoutLast).flatMap((input) => presentIds(input.enchantments)))]
    const partners = enchantmentsOf(edition).filter((id) => present.some((other) => areExclusive(edition, id, other)))
    if (partners.length > 0) {
      finalBooks = [...withoutLast, { enchantments: { [partners[draft.blocker % partners.length]]: 1 }, anvilUses: 0 }]
      goalInputs = inputsOf(withoutLast)
    }
  }
  const goal = draft.goal === null ? null : goalFor(edition, theme, goalInputs, draft.goal)
  const problem: AdvancedProblem = { mode: 'advanced', target, extraItems: extras, books: finalBooks, goal, useOnlyNeeded: draft.useOnlyNeeded }
  return { problem, settings: draft.settings }
}

/** Null when there is only one book copy. */
function withoutLastCopy(books: readonly BookInput[]): BookInput[] | null {
  const copies = books.reduce((sum, book) => sum + (book.count ?? 1), 0)
  if (copies < 2) return null
  const last = books[books.length - 1]
  const count = (last.count ?? 1) - 1
  const rest = books.slice(0, -1)
  if (count === 0) return rest
  return [...rest, count === 1 ? { enchantments: last.enchantments, anvilUses: last.anvilUses } : { ...last, count }]
}

function goalFor(edition: Edition, theme: readonly EnchantmentId[], inputs: readonly ItemInput[], draft: NonNullable<AdvancedDraft['goal']>): EnchantLevels {
  const present = [...new Set(inputs.flatMap((input) => presentIds(input.enchantments)))]
  const goal: EnchantLevels = {}
  if (present.length > 0) {
    for (const { pick, levelPick, beyond } of draft.picks) {
      const id = present[pick % present.length]
      const max = maxLevelOf(id)
      const reachable = reachableLevelOf(inputs.map((input) => input.enchantments[id] ?? 0), max)
      goal[id] = beyond && reachable < max ? reachable + 1 : 1 + (levelPick % reachable)
    }
  }
  const absent = theme.filter((id) => !present.includes(id))
  const fallback = enchantmentsOf(edition).filter((id) => !present.includes(id))
  const missingPool = absent.length > 0 ? absent : fallback
  if ((draft.missing !== null || present.length === 0) && missingPool.length > 0) {
    goal[missingPool[(draft.missing ?? 0) % missingPool.length]] = 1
  }
  return goal
}

interface RequestDraft {
  readonly level: number
  /** null leaves out sources, meaning one book at the requested level. */
  readonly stacks: readonly { readonly levelPick: number; readonly count: number; readonly anyLevel: boolean }[] | null
}

export function simpleCaseArb(options: CaseOptions = {}): fc.Arbitrary<SimpleProblemCase> {
  const { editions, minInputs, maxInputs } = resolve(options)
  return fc.constantFrom(...editions).chain((edition) => itemTypeArb(edition).chain((itemType) => themeArb(edition, itemType).chain((theme) =>
    fc.record({
      settings: settingsArb(edition),
      ids: fc.shuffledSubarray(theme, { minLength: 1, maxLength: Math.min(4, theme.length) }),
      allowConflicts: weighted([4, fc.constant(false)], [1, fc.constant(true)]),
      budget: budgetArb(minInputs, maxInputs),
    }).chain(({ settings, ids, allowConflicts, budget }) => {
      const chosen = allowConflicts ? ids : withoutSelfConflicts(edition, ids)
      const requestArb = (id: EnchantmentId): fc.Arbitrary<RequestDraft> => fc.record({
        level: levelArb(maxLevelOf(id)),
        stacks: weighted<RequestDraft['stacks']>(
          [1, fc.constant(null)],
          [1, fc.array(fc.record({
            levelPick: fc.nat(),
            count: fc.integer({ min: 1, max: 4 }),
            anyLevel: weighted([5, fc.constant(false)], [1, fc.constant(true)]),
          }), { minLength: 1, maxLength: 2 })],
        ),
      })
      return fc.tuple(...chosen.map(requestArb)).map((drafts) => assembleSimple(itemType, chosen, drafts, settings, budget, minInputs))
    }),
  )))
}

export interface SimpleProblemCase extends OracleCase {
  readonly problem: SimpleProblem
}

function assembleSimple(
  itemType: ItemTypeId,
  ids: readonly EnchantmentId[],
  drafts: readonly RequestDraft[],
  settings: Settings,
  budget: number,
  minInputs: number,
): SimpleProblemCase {
  const base = isBookType(itemType) ? 0 : 1
  let slots = budget - base
  const requests: SimpleEnchantmentRequest[] = []
  ids.forEach((id, index) => {
    if (slots <= 0) return
    const { level, stacks } = drafts[index]
    const max = maxLevelOf(id)
    if (stacks === null) {
      requests.push({ id, level })
      slots -= 1
      return
    }
    const sources: BookStack[] = []
    for (const stack of stacks) {
      const count = Math.min(stack.count, slots)
      if (count <= 0) break
      // Mostly at or below the requested level, so they stack up
      sources.push({ level: 1 + (stack.levelPick % (stack.anyLevel ? max : level)), count })
      slots -= count
    }
    if (sources.length > 0) requests.push({ id, level, sources })
  })
  const total = base + requests.reduce((sum, request) => sum + (request.sources?.reduce((n, stack) => n + stack.count, 0) ?? 1), 0)
  if (total < minInputs && requests.length > 0) {
    const last = requests[requests.length - 1]
    const extra: BookStack = { level: last.level, count: minInputs - total }
    requests[requests.length - 1] = { ...last, sources: [...(last.sources ?? [{ level: last.level, count: 1 }]), extra] }
  }
  return { problem: { mode: 'simple', item: itemType, enchantments: requests }, settings }
}

export type CaseFeature =
  | 'java' | 'bedrock' | 'simple' | 'advanced' | 'book-only' | 'non-damageable-target'
  | 'conflict'
  | 'blocker'               // a book without goal enchantments is exclusive with another input's enchantment
  | 'inapplicable'
  | 'stacking'              // the same enchantment is on two or more inputs
  | 'duplicate-inputs'
  | 'prior-work'
  | 'extra-item'
  | 'goal' | 'no-goal' | 'use-only-needed' | 'use-all-with-goal'
  | 'rename' | 'no-cap' | 'objective-levels' | 'objective-xp' | 'objective-finalPwp'

export function caseFeatures({ problem, settings }: OracleCase): Set<CaseFeature> {
  const { edition } = settings
  const features = new Set<CaseFeature>([edition, problem.mode, `objective-${settings.objective}`])
  const normalized = oracleNormalize(problem)
  const { inputs, goal } = normalized
  const target = normalized.targetIndex === null ? null : inputs[normalized.targetIndex]
  if (target === null) features.add('book-only')
  else if (target.itemType !== null && !isDamageable(target.itemType)) features.add('non-damageable-target')

  const idsOf = inputs.map((input) => presentIds(input.enchantments))
  const allIds = idsOf.flat()
  if (allIds.some((a) => allIds.some((b) => areExclusive(edition, a, b)))) features.add('conflict')
  const targetType = target?.itemType ?? null
  if (targetType !== null && allIds.some((id) => !canApply(edition, targetType, id))) features.add('inapplicable')
  if (new Set(allIds).size < allIds.length) features.add('stacking')
  const keys = inputs.map((input) => JSON.stringify([input.kind, input.anvilUses, presentIds(input.enchantments).map((id) => [id, input.enchantments[id]])]))
  if (new Set(keys).size < keys.length) features.add('duplicate-inputs')
  if (inputs.some((input) => input.anvilUses > 0)) features.add('prior-work')
  if (inputs.some((input, index) => input.kind === 'item' && index !== normalized.targetIndex)) features.add('extra-item')

  if (goal === null) features.add('no-goal')
  else {
    features.add('goal')
    features.add(normalized.useOnlyNeeded ? 'use-only-needed' : 'use-all-with-goal')
    const goalIds = presentIds(goal)
    const blocker = inputs.some((input, index) => input.kind === 'book'
      && idsOf[index].every((id) => !goalIds.includes(id))
      && idsOf[index].some((id) => idsOf.some((others, other) => other !== index && others.some((o) => areExclusive(edition, id, o)))))
    if (blocker) features.add('blocker')
  }
  if (settings.rename) features.add('rename')
  if (settings.levelCap === null) features.add('no-cap')
  return features
}
