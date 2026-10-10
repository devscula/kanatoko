import { applicableEnchantments, areCompatible, enchantmentsInEdition, getItem, isItemInEdition, maxLevel } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import {
  COMBINE_OK,
  combineCompiled,
  compileProblem,
  createCombineOut,
  KIND_BOOK,
  KIND_ITEM,
  renameOnlyCompiled,
  unpackObject,
  type PackedObject,
} from './compile.ts'
import { compareKeyVectors, planKeyVector, solveExactSync, type ExactOutcome, type ExactSearchOptions } from './exactSearch.ts'
import { normalizeProblem } from './normalize.ts'
import { anvilObjectOf, canonicalLevels, combine, levelEntries, pwp, renameOnly, type AnvilObject } from './rules.ts'
import type {
  AdvancedProblem,
  BookInput,
  EnchantLevels,
  ItemInput,
  KeyVector,
  NormalizedProblem,
  PlanKeys,
  PlanNode,
  Problem,
  Settings,
} from './types.ts'
import { validateProblem } from './validate.ts'
import { stepXp } from './xp.ts'

export const JAVA: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }

export function settingsFor(edition: Edition, overrides: Partial<Settings> = {}): Settings {
  return { ...JAVA, edition, ...overrides }
}

export function advanced(overrides: Partial<AdvancedProblem>): AdvancedProblem {
  return { mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides }
}

export function books(...levels: EnchantLevels[]): BookInput[] {
  return levels.map((enchantments) => ({ enchantments, anvilUses: 0 }))
}

/** Throws for a problem that fails validation. */
export function normalized(problem: Problem, settings: Settings): NormalizedProblem {
  const issues = validateProblem(problem, settings)
  if (issues.length > 0) throw new Error(`invalid test problem: ${JSON.stringify(issues)}`)
  return normalizeProblem(problem, settings)
}

export function solve(problem: Problem, settings: Settings, options?: ExactSearchOptions): { np: NormalizedProblem; outcome: ExactOutcome } {
  const np = normalized(problem, settings)
  return { np, outcome: solveExactSync(np, settings, options) }
}

export function scenarioKeys(keys: PlanKeys): [number, number, number, number] {
  return [keys.totalLevels, keys.maxStepLevels, keys.xpPoints, keys.finalPriorWorkPenalty]
}

export interface Replay {
  readonly keys: PlanKeys
  readonly final: AnvilObject
  readonly stepCosts: readonly number[]
  readonly leaves: readonly number[]       // left to right
}

/**
 * Replays with rules.ts. Throws on a refused step (over the cap included), a named object on the right, a renamed leaf
 * other than the base, or a second rename.
 */
export function replayPlan(tree: PlanNode, np: NormalizedProblem, settings: Settings, levelCap: number | null = settings.levelCap): Replay {
  const stepCosts: number[] = []
  const leaves: number[] = []
  const visit = (node: PlanNode, isBase: boolean): AnvilObject => {
    if (node.t === 'leaf') {
      leaves.push(node.input)
      const obj = anvilObjectOf(np.inputs[node.input])
      if (!node.preRename) return obj
      if (!isBase) throw new Error(`input ${node.input} is renamed but is not the base`)
      const outcome = renameOnly(obj, { edition: settings.edition, levelCap })
      if (!outcome.ok) throw new Error(`rename-only step refused: ${outcome.reason}`)
      stepCosts.push(outcome.cost)
      return outcome.result
    }
    const left = visit(node.left, isBase)
    const right = visit(node.right, false)
    if (right.named) throw new Error('a renamed object is used as a right input')
    if (node.rename && left.named) throw new Error('the object is renamed twice')
    const outcome = combine(left, right, { edition: settings.edition, levelCap, rename: node.rename })
    if (!outcome.ok) throw new Error(`step refused: ${outcome.reason}`)
    stepCosts.push(outcome.cost)
    return outcome.result
  }
  const final = visit(tree, true)
  return {
    keys: {
      totalLevels: stepCosts.reduce((sum, cost) => sum + cost, 0),
      maxStepLevels: stepCosts.reduce((max, cost) => Math.max(max, cost), 0),
      xpPoints: stepCosts.reduce((sum, cost) => sum + stepXp(cost), 0),
      finalPriorWorkPenalty: pwp(final.anvilUses),
      inputsUsed: leaves.length,
    },
    final,
    stepCosts,
    leaves,
  }
}

export function vectorKey(levels: EnchantLevels): string {
  return levelEntries(levels).map(([id, level]) => `${id}=${level}`).join(',')
}

interface Outcome {
  readonly obj: PackedObject
  readonly t: number
  readonly m: number
  readonly x: number
}

export interface ReferenceResult {
  /** In objective order; null when there is no plan. */
  readonly best: KeyVector | null
  /** Without a goal, the sorted vectorKey of each maximal result; empty with a goal. */
  readonly maximal: readonly string[]
  /**
   * When every input must be used and there is no plan: the size of the largest subset that can make a result, and the
   * best key among subsets of that size (each subset selected by the goal or maximal-result rule). Otherwise null.
   */
  readonly partial: { readonly size: number; readonly best: KeyVector } | null
}

/**
 * Lists every result (object and (t, m, x)) of every plan over each subset of inputs, merging only exact duplicates, to
 * check that the search's shortcuts (minimum t, Pareto fronts, bounds, groups) never lose the optimum. It uses
 * combineCompiled, which compile.test.ts checks against rules.combine. A few seconds at most for n <= 7.
 */
export function referenceSolve(np: NormalizedProblem, settings: Settings, levelCap: number | null = settings.levelCap): ReferenceResult {
  const n = np.inputs.length
  if (n > 7) throw new Error('the reference enumeration is for at most 7 inputs')
  // Enumerate every input, including those the search leaves out, which checks that leaving them out is safe
  const cp = compileProblem({ ...np, excludedInputs: [] }, settings)
  const target = np.targetIndex
  const has = (mask: number, input: number): boolean => ((mask >> input) & 1) === 1
  const results: Outcome[][] = [[]]
  for (let mask = 1; mask < 1 << n; mask++) {
    const found = new Map<string, Outcome>()
    const add = (obj: PackedObject, t: number, m: number, x: number): void => {
      const key = `${obj.kind},${obj.itemType},${obj.w0},${obj.w1},${obj.w2},${obj.uses},${obj.named}|${t},${m},${x}`
      if (!found.has(key)) found.set(key, { obj: { ...obj }, t, m, x })
    }
    if ((mask & (mask - 1)) === 0) {
      const input = 31 - Math.clz32(mask)
      const leaf = cp.inputs[input]
      if (leaf === null) throw new Error(`input ${input} was not compiled`)
      add(leaf, 0, 0, 0)
      // A base candidate (the target, or any book in book-only mode) may be renamed first
      if (settings.rename && (target === null || input === target)) {
        const out = createCombineOut()
        if (renameOnlyCompiled(cp, leaf, levelCap, out) === COMBINE_OK) add(out.result, out.cost, out.cost, stepXp(out.cost))
      }
    } else {
      for (let left = (mask - 1) & mask; left > 0; left = (left - 1) & mask) {
        const right = mask & ~left
        // The target is always the leftmost leaf
        if (target !== null && has(mask, target) && !has(left, target)) continue
        for (const a of results[left]) {
          for (const b of results[right]) {
            if (b.obj.named === 1) continue
            for (const rename of settings.rename && a.obj.named === 0 ? [false, true] : [false]) {
              const out = createCombineOut()
              if (combineCompiled(cp, a.obj, b.obj, rename, levelCap, out) !== COMBINE_OK) continue
              const cost = out.cost
              add(out.result, a.t + b.t + cost, Math.max(a.m, b.m, cost), a.x + b.x + stepXp(cost))
            }
          }
        }
      }
    }
    results[mask] = [...found.values()]
  }

  const full = (1 << n) - 1
  const bitCount = (mask: number): number => { let c = 0; for (let v = mask; v !== 0; v &= v - 1) c++; return c }
  const levelsOf = (obj: PackedObject): EnchantLevels => unpackObject(cp, obj).enchantments
  const valid = (r: Outcome): boolean =>
    r.obj.kind === (target === null ? KIND_BOOK : KIND_ITEM)
    && r.obj.named === (settings.rename ? 1 : 0)
    && levelEntries(np.goal ?? {}).every(([id, level]) => (levelsOf(r.obj)[id] ?? 0) >= level)
  const keyOf = (r: Outcome, mask: number): KeyVector => planKeyVector({
    totalLevels: r.t, maxStepLevels: r.m, xpPoints: r.x, finalPriorWorkPenalty: pwp(r.obj.uses), inputsUsed: bitCount(mask),
  }, settings.objective)

  type Root = { readonly r: Outcome; readonly mask: number }
  const select = (roots: readonly Root[]): { best: KeyVector | null; maximal: string[] } => {
    let qualifying = roots
    let maximal: string[] = []
    if (np.goal === null) {
      const vectors = new Map<string, EnchantLevels>()
      for (const { r } of roots) vectors.set(vectorKey(levelsOf(r.obj)), levelsOf(r.obj))
      maximal = [...vectors.entries()].filter(([, v]) => ![...vectors.values()].some((w) => dominates(w, v))).map(([key]) => key).sort()
      const maximalSet = new Set(maximal)
      qualifying = roots.filter(({ r }) => maximalSet.has(vectorKey(levelsOf(r.obj))))
    }
    let best: KeyVector | null = null
    for (const { r, mask } of qualifying) {
      const key = keyOf(r, mask)
      if (best === null || compareKeyVectors(key, best) < 0) best = key
    }
    return { best, maximal }
  }
  const rootsOf = (mask: number): Root[] => results[mask].filter(valid).map((r) => ({ r, mask }))
  const containsBase = (mask: number): boolean => target === null || has(mask, target)

  const allowed: Root[] = []
  for (let mask = 1; mask <= full; mask++) {
    if (np.useOnlyNeeded ? containsBase(mask) : mask === full) for (const root of rootsOf(mask)) allowed.push(root)
  }
  const { best, maximal } = select(allowed)

  let partial: ReferenceResult['partial'] = null
  if (best === null && !np.useOnlyNeeded) {
    for (let size = n - 1; size >= 1 && partial === null; size--) {
      let sizeBest: KeyVector | null = null
      for (let mask = 1; mask < full; mask++) {
        if (bitCount(mask) !== size || !containsBase(mask)) continue
        const choice = select(rootsOf(mask)).best
        if (choice !== null && (sizeBest === null || compareKeyVectors(choice, sizeBest) < 0)) sizeBest = choice
      }
      if (sizeBest !== null) partial = { size, best: sizeBest }
    }
  }
  return { best, maximal: np.goal === null ? maximal : [], partial }
}

function dominates(p: EnchantLevels, q: EnchantLevels): boolean {
  const ids = new Set([...levelEntries(p), ...levelEntries(q)].map(([id]) => id))
  let greater = false
  for (const id of ids) {
    if ((p[id] ?? 0) < (q[id] ?? 0)) return false
    if ((p[id] ?? 0) > (q[id] ?? 0)) greater = true
  }
  return greater
}

// mulberry32
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ITEM_TYPES: readonly ItemTypeId[] = [
  'sword', 'boots', 'helmet', 'pickaxe', 'axe', 'trident', 'bow', 'crossbow', 'mace', 'fishing_rod', 'shears', 'carved_pumpkin', 'spear',
]

const CONFLICT_HEAVY: readonly EnchantmentId[] = [
  'sharpness', 'smite', 'bane_of_arthropods', 'impaling', 'density', 'breach', 'protection', 'blast_protection', 'fire_protection',
  'riptide', 'loyalty', 'channeling', 'infinity', 'mending', 'fortune', 'silk_touch', 'depth_strider', 'frost_walker', 'unbreaking',
  'efficiency', 'looting', 'thorns', 'feather_falling', 'multishot', 'piercing',
]

export interface RandomProblemOptions {
  readonly minInputs: number
  readonly maxInputs: number
  readonly noGoalRate?: number
}

export interface RandomCase {
  readonly problem: AdvancedProblem
  readonly settings: Settings
}

export function randomProblem(random: () => number, options: RandomProblemOptions): RandomCase {
  for (;;) {
    const candidate = draftProblem(random, options)
    if (validateProblem(candidate.problem, candidate.settings).length > 0) continue
    const inputs = normalizeProblem(candidate.problem, candidate.settings).inputs.length
    if (inputs >= options.minInputs && inputs <= options.maxInputs) return candidate
  }
}

function draftProblem(random: () => number, options: RandomProblemOptions): RandomCase {
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1))
  const chance = (p: number): boolean => random() < p
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]
  const shuffled = <T>(values: readonly T[]): T[] => {
    const copy = [...values]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  const edition: Edition = chance(0.5) ? 'java' : 'bedrock'
  const all = enchantmentsInEdition(edition).map((e) => e.id)
  const bookOnly = chance(0.2)
  const itemType = pick(ITEM_TYPES.filter((type) => isItemInEdition(edition, type)))
  const applicable = bookOnly ? [] : applicableEnchantments(edition, itemType)

  // Mostly applicable enchantments, with a few conflicting or inapplicable ones mixed in
  const pool = bookOnly
    ? shuffled(CONFLICT_HEAVY.filter((id) => all.includes(id))).slice(0, int(3, 6))
    : [...shuffled(applicable).slice(0, int(2, 5)), ...(chance(0.4) ? shuffled(all).slice(0, int(1, 2)) : [])]
  const distinctPool = [...new Set(pool)]
  const levelFor = (id: EnchantmentId): number => (chance(0.4) ? maxLevel(id) : int(1, Math.min(3, maxLevel(id))))
  const compatibleSet = (candidates: readonly EnchantmentId[], count: number): EnchantLevels => {
    const chosen: EnchantmentId[] = []
    for (const id of shuffled(candidates)) {
      if (chosen.length >= count) break
      if (chosen.every((other) => areCompatible(edition, id, other))) chosen.push(id)
    }
    return canonicalLevels(Object.fromEntries(chosen.map((id) => [id, levelFor(id)])))
  }

  const targetPool = distinctPool.filter((id) => applicable.includes(id))
  const target = bookOnly ? null : {
    itemType,
    enchantments: compatibleSet(targetPool, chance(0.5) ? 0 : int(1, 2)),
    anvilUses: chance(0.6) ? 0 : int(1, 3),
  }
  const extraItems: ItemInput[] = []
  if (target !== null && getItem(itemType).damageable && chance(0.25)) {
    extraItems.push({ enchantments: compatibleSet(targetPool, int(0, 2)), anvilUses: chance(0.6) ? 0 : int(1, 2) })
  }
  const bookList: BookInput[] = []
  let inputs = (target === null ? 0 : 1) + extraItems.length
  const wanted = int(options.minInputs, options.maxInputs)
  while (inputs < wanted) {
    const count = chance(0.2) && inputs + 2 <= wanted ? 2 : 1
    const enchantments = compatibleSet(distinctPool, int(1, 3))
    if (levelEntries(enchantments).length === 0) continue
    bookList.push({ enchantments, anvilUses: chance(0.7) ? 0 : int(1, 2), ...(count > 1 ? { count } : {}) })
    inputs += count
  }

  let goal: EnchantLevels | null = null
  if (!chance(options.noGoalRate ?? 0.35)) {
    const present = [...new Set([target, ...extraItems, ...bookList].flatMap((input) => (input === null ? [] : levelEntries(input.enchantments).map(([id]) => id))))]
    const goalIds = shuffled(present).slice(0, int(1, Math.min(3, Math.max(1, present.length))))
    goal = goalIds.length === 0 ? null : canonicalLevels(Object.fromEntries(goalIds.map((id) => [id, int(1, maxLevel(id))])))
  }

  const problem = advanced({ target, extraItems, books: bookList, goal, useOnlyNeeded: chance(0.7) })
  const settings: Settings = {
    edition,
    levelCap: chance(0.7) ? 39 : null,
    objective: pick(['levels', 'levels', 'levels', 'xp', 'finalPwp'] as const),
    rename: chance(0.25),
  }
  return { problem, settings }
}
