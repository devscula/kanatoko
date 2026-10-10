// The slow cross-checks are in fastPath.perf.test.ts.
import fc from 'fast-check'
import { applicableEnchantments, areCompatible, enchantmentsInEdition, itemsInEdition, maxLevel, multiplier } from '../data/gameData.ts'
import type { Edition, EnchantmentId, ItemTypeId } from '../data/types.ts'
import { additiveDpKeys, bruteForceKeys, type AdditiveMode, type Keys } from './__fixtures__/additiveBruteForce.ts'
import {
  checkAdditive,
  ineligibleFastPathStats,
  solveTreeTable,
  solveWeights,
  type AdditiveCheck,
  type AdditiveIneligibility,
  type FastPathOutcome,
  type TreeTablePlan,
} from './fastPath.ts'
import { normalizeProblem } from './normalize.ts'
import { anvilObjectOf, combine, levelEntries, renameOnly, type AnvilObject } from './rules.ts'
import { clearTreeTableCache } from './treeTables.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, NormalizedProblem, PlanNode, Problem, Settings, SimpleProblem, TargetInput } from './types.ts'
import { validateProblem } from './validate.ts'

const SEED = 20260927

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const target = (itemType: ItemTypeId, enchantments: EnchantLevels = {}, anvilUses = 0): TargetInput => ({ itemType, enchantments, anvilUses })
const books = (...levels: EnchantLevels[]): BookInput[] => levels.map((enchantments) => ({ enchantments, anvilUses: 0 }))

/** Java weights 12, 12, 4, 6, 4, 3, 2. */
const MAX_BOOTS_BOOKS = books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }, { unbreaking: 3 }, { mending: 1 })
const BOOTS_WITH_MAX_BOOKS = advanced({ target: target('boots'), books: MAX_BOOTS_BOOKS })

function normalized(problem: Problem, settings: Settings): NormalizedProblem {
  expect(validateProblem(problem, settings)).toEqual([])
  return normalizeProblem(problem, settings)
}

function check(problem: Problem, settings: Settings = java): AdditiveCheck {
  return checkAdditive(normalized(problem, settings), settings)
}

function because(problem: Problem, settings: Settings = java): AdditiveIneligibility | null {
  const result = check(problem, settings)
  return result.eligible ? null : result.because
}

function solve(problem: Problem, settings: Settings = java, opts: Parameters<typeof solveTreeTable>[2] = {}): FastPathOutcome {
  return solveTreeTable(normalized(problem, settings), settings, opts)
}

function solvedPlan(outcome: FastPathOutcome): TreeTablePlan {
  if (outcome.status !== 'solved') throw new Error(`expected solved, got ${outcome.status} (${outcome.cause})`)
  return outcome.plan
}

const keysOf = (plan: TreeTablePlan): Keys =>
  [plan.keys.totalLevels, plan.keys.maxStepLevels, plan.keys.xpPoints, plan.keys.finalPriorWorkPenalty]

function leavesInOrder(node: PlanNode): Extract<PlanNode, { t: 'leaf' }>[] {
  return node.t === 'leaf' ? [node] : [...leavesInOrder(node.left), ...leavesInOrder(node.right)]
}

/**
 * Replays with rules.ts in planBuilder's order (post-order, with a rename-only step first) and expects every step at the
 * cost the tree table computed.
 */
function replay(np: NormalizedProblem, plan: TreeTablePlan, settings: Settings, levelCap: number | null = settings.levelCap): AnvilObject {
  const costs: number[] = []
  const walk = (node: PlanNode): AnvilObject => {
    if (node.t === 'leaf') {
      const leaf = anvilObjectOf(np.inputs[node.input])
      if (!node.preRename) return leaf
      const renamed = renameOnly(leaf, { edition: settings.edition, levelCap })
      if (!renamed.ok) throw new Error(`rename-only refused: ${renamed.reason}`)
      costs.push(renamed.cost)
      return renamed.result
    }
    const left = walk(node.left)
    const right = walk(node.right)
    const out = combine(left, right, { edition: settings.edition, levelCap, rename: node.rename })
    if (!out.ok) throw new Error(`step refused: ${out.reason}`)
    costs.push(out.cost)
    return out.result
  }
  const final = walk(plan.tree)
  expect(costs).toEqual(plan.stepCosts)
  expect(costs.reduce((a, b) => a + b, 0)).toBe(plan.keys.totalLevels)
  expect(Math.max(0, ...costs)).toBe(plan.keys.maxStepLevels)
  expect(final.anvilUses).toBe(plan.finalAnvilUses)
  expect(2 ** final.anvilUses - 1).toBe(plan.keys.finalPriorWorkPenalty)
  expect(final.named).toBe(settings.rename)
  return final
}

/** In an additive problem every enchantment of the used inputs reaches the final object at its input level. */
function expectAllTransferred(np: NormalizedProblem, plan: TreeTablePlan, final: AnvilObject): void {
  const expected: EnchantLevels = {}
  for (const input of plan.usedInputs) for (const [id, level] of levelEntries(np.inputs[input].enchantments)) expected[id] = level
  expect(final.enchantments).toEqual(expected)
}

describe('checkAdditive: weights and used books', () => {
  it('computes w = sum of book multiplier * level for each of the seven boots books, in input order', () => {
    const result = check(BOOTS_WITH_MAX_BOOKS)
    expect(result).toEqual({
      eligible: true,
      books: [
        { input: 1, weight: 12 },   // Soul Speed III: 4 x 3
        { input: 2, weight: 12 },   // Thorns III: 4 x 3
        { input: 3, weight: 4 },    // Feather Falling IV: 1 x 4
        { input: 4, weight: 6 },    // Depth Strider III: 2 x 3
        { input: 5, weight: 4 },    // Protection IV: 1 x 4
        { input: 6, weight: 3 },    // Unbreaking III: 1 x 3
        { input: 7, weight: 2 },    // Mending: 2 x 1
      ],
      droppedBooks: [],
    })
  })

  it('sums the weights of every enchantment on a multi-enchantment book, with the edition multipliers', () => {
    const problem = advanced({ target: target('trident'), books: books({ impaling: 5, unbreaking: 3 }, { mending: 1 }) })
    // Impaling book multiplier: Java 2, Bedrock 1
    expect(check(problem, java)).toMatchObject({ eligible: true, books: [{ input: 1, weight: 2 * 5 + 3 }, { input: 2, weight: 2 }] })
    expect(check(problem, bedrock)).toMatchObject({ eligible: true, books: [{ input: 1, weight: 1 * 5 + 3 }, { input: 2, weight: 2 }] })
  })

  it('drops books without a goal enchantment when useOnlyNeeded, and keeps every book otherwise', () => {
    const inputs = { target: target('sword'), books: books({ looting: 3 }, { unbreaking: 3 }, { mending: 1, sweeping_edge: 3 }) }
    // A book without goal enchantments that shares none with another input and conflicts with none is left out of the search, so it is not counted
    expect(check(advanced({ ...inputs, goal: { looting: 3 } }))).toEqual({ eligible: true, books: [{ input: 1, weight: 6 }], droppedBooks: [] })
    expect(normalized(advanced({ ...inputs, goal: { looting: 3 } }), java).excludedInputs).toEqual([2, 3])
    expect(check(advanced({ ...inputs, goal: { looting: 3 }, useOnlyNeeded: false }))).toMatchObject({ eligible: true, droppedBooks: [] })
    expect(check(advanced({ ...inputs, goal: null }))).toMatchObject({ eligible: true, droppedBooks: [] })
    // Dropped books that only share an enchantment with a used book (no conflict) change nothing
    expect(check(advanced({ target: target('sword'), books: books({ looting: 3 }, { looting: 2 }, { unbreaking: 1, looting: 1 }), goal: { unbreaking: 1 } })))
      .toEqual({ eligible: true, books: [{ input: 3, weight: 1 + 2 }], droppedBooks: [1, 2] })
  })

  it('accepts a goal met by the target itself or by exactly one book at a level ≥ the goal', () => {
    expect(check(advanced({ target: target('sword', { sharpness: 5 }), books: books({ looting: 3 }), goal: { sharpness: 4, looting: 3 } })))
      .toMatchObject({ eligible: true, books: [{ input: 1 }] })
    expect(check(advanced({ target: target('sword'), books: books({ sharpness: 5 }), goal: { sharpness: 4 } }))).toMatchObject({ eligible: true })
  })

  it('treats simple-mode problems (goal = the wanted levels, useOnlyNeeded)', () => {
    const simple: SimpleProblem = { mode: 'simple', item: 'boots', enchantments: [{ id: 'protection', level: 4 }, { id: 'mending', level: 1 }] }
    expect(check(simple)).toEqual({ eligible: true, books: [{ input: 1, weight: 4 }, { input: 2, weight: 2 }], droppedBooks: [] })
    expect(check({ ...simple, item: 'enchanted_book' })).toEqual({ eligible: true, books: [{ input: 0, weight: 4 }, { input: 1, weight: 2 }], droppedBooks: [] })
  })
})

describe('checkAdditive: the first failing condition', () => {
  it.each<[string, Problem, Settings, AdditiveIneligibility]>([
    ['objective xp', BOOTS_WITH_MAX_BOOKS, { ...java, objective: 'xp' }, 'objective'],
    ['objective finalPwp', BOOTS_WITH_MAX_BOOKS, { ...java, objective: 'finalPwp' }, 'objective'],
    ['a spare item', advanced({ target: target('sword'), extraItems: [{ enchantments: { looting: 3 }, anvilUses: 0 }], books: books({ unbreaking: 3 }) }), java, 'extra-items'],
    ['a book with prior work', advanced({ target: target('sword'), books: [{ enchantments: { looting: 3 }, anvilUses: 1 }] }), java, 'book-prior-work'],
    ['a dropped book with prior work', advanced({ target: target('sword'), books: [{ enchantments: { looting: 3 }, anvilUses: 0 }, { enchantments: { looting: 1, unbreaking: 3 }, anvilUses: 2 }], goal: { looting: 3 } }), java, 'book-prior-work'],
    ['the same enchantment on two books', advanced({ books: books({ sharpness: 4 }, { sharpness: 4 }, { unbreaking: 3 }) }), java, 'overlap'],
    ['the same enchantment on the target and a book', advanced({ target: target('sword', { unbreaking: 1 }), books: books({ unbreaking: 3 }) }), java, 'overlap'],
    ['the target below the goal and a book', advanced({ target: target('sword', { sharpness: 2 }), books: books({ sharpness: 5 }), goal: { sharpness: 5 } }), java, 'overlap'],
    ['conflicting books', advanced({ target: target('sword'), books: books({ sharpness: 5 }, { smite: 5 }) }), java, 'conflict'],
    ['a book conflicting with the target', advanced({ target: target('sword', { sharpness: 5 }), books: books({ smite: 5 }) }), java, 'conflict'],
    ['a book that does not apply to the target', advanced({ target: target('sword'), books: books({ efficiency: 5 }) }), java, 'inapplicable'],
    ['rename on a target with prior work', advanced({ target: target('boots', {}, 1), books: books({ mending: 1 }) }), { ...java, rename: true }, 'rename-prior-work'],
    ['goal above the only book', advanced({ target: target('sword'), books: books({ sharpness: 4 }), goal: { sharpness: 5 } }), java, 'goal'],
    ['goal enchantment on no input', advanced({ target: target('sword'), books: books({ looting: 3 }), goal: { sharpness: 1 } }), java, 'goal'],
    ['goal above the target', advanced({ target: target('sword', { sharpness: 3 }), books: books({ looting: 3 }), goal: { sharpness: 4 } }), java, 'goal'],
    ['no used book in book-only mode', advanced({ books: books({ unbreaking: 3 }), goal: {} }), java, 'no-books'],
    ['the objective before spare items', advanced({ target: target('sword'), extraItems: [{ enchantments: {}, anvilUses: 0 }], books: books({ looting: 3 }) }), { ...java, objective: 'xp' }, 'objective'],
    ['overlaps before conflicts', advanced({ target: target('sword'), books: books({ sharpness: 4 }, { sharpness: 4 }, { smite: 1 }) }), java, 'overlap'],
  ])('%s', (_label, problem, settings, expected) => {
    expect(because(problem, settings)).toBe(expected)
  })

  it('does not count the inputs left out of the search: their prior work and their conflicts with each other', () => {
    const goal = { looting: 3 }
    const withPriorWork = advanced({ target: target('sword'), books: [{ enchantments: { looting: 3 }, anvilUses: 0 }, { enchantments: { unbreaking: 3 }, anvilUses: 2 }], goal })
    expect(check(withPriorWork)).toEqual({ eligible: true, books: [{ input: 1, weight: 6 }], droppedBooks: [] })
    const conflictingEachOther = advanced({ target: target('sword'), books: books({ looting: 3 }, { protection: 4 }, { blast_protection: 4 }), goal })
    expect(check(conflictingEachOther)).toMatchObject({ eligible: true, books: [{ input: 1 }] })
    // A book exclusive with a kept input stays in the search and makes the problem non-additive (the Smite book blocks Sharpness)
    const blocking = advanced({ target: target('sword'), books: books({ sharpness: 5, looting: 3 }, { smite: 1 }), goal })
    expect(normalized(blocking, java).excludedInputs).toEqual([])
    expect(because(blocking, java)).toBe('conflict')
  })

  it('allows at most LIMITS.fastPathMaxBooks used books (and the override)', () => {
    const np = normalized(advanced({ target: target('boots'), books: MAX_BOOTS_BOOKS }), java)
    expect(checkAdditive(np, java, { fastPathMaxBooks: 7 }).eligible).toBe(true)
    expect(checkAdditive(np, java, { fastPathMaxBooks: 6 })).toEqual({ eligible: false, because: 'too-many-books' })
    // 25 pairwise compatible books without a target: more than the default limit of 24
    const pool = compatibleEnchantments('java', null).slice(0, 25)
    expect(pool).toHaveLength(25)
    const many = normalized(advanced({ books: books(...pool.map((id) => ({ [id]: 1 }))) }), java)
    expect(checkAdditive(many, java)).toEqual({ eligible: false, because: 'too-many-books' })
    expect(checkAdditive(normalized(advanced({ books: books(...pool.slice(0, 24).map((id) => ({ [id]: 1 }))) }), java), java).eligible).toBe(true)
  })

  it('checks conflicts with the books dropped for the goal too, since such a book can block an expensive enchantment', () => {
    const smiteBlocksSharpness = advanced({ target: target('sword'), books: books({ smite: 1 }, { sharpness: 5, looting: 3 }), goal: { looting: 3 } })
    expect(because(smiteBlocksSharpness, java)).toBe('conflict')
    expect(because(smiteBlocksSharpness, bedrock)).toBe('conflict')
    expect(because(advanced({ books: books({ sharpness: 5, looting: 3 }, { smite: 1 }), goal: { looting: 3 } }))).toBe('conflict')
    expect(because(advanced({ target: target('boots'), books: books({ frost_walker: 1 }, { depth_strider: 3, feather_falling: 4 }), goal: { feather_falling: 4 } }))).toBe('conflict')
  })

  it('follows the edition: Impaling conflicts with Sharpness in Java but not in Bedrock', () => {
    const problem = advanced({ books: books({ sharpness: 5 }, { impaling: 5 }) })
    expect(because(problem, java)).toBe('conflict')
    expect(because(problem, bedrock)).toBeNull()
  })
})

describe('checkAdditive: which known scenarios are tree-table eligible', () => {
  const bootsSimpleMode: SimpleProblem = {
    mode: 'simple',
    item: 'boots',
    enchantments: [
      { id: 'soul_speed', level: 3 }, { id: 'thorns', level: 3 }, { id: 'feather_falling', level: 4 }, { id: 'depth_strider', level: 3 },
      { id: 'protection', level: 4 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 },
    ],
  }
  const sharpnessSwordSmiteLooting = advanced({ target: target('sword', { sharpness: 5 }), books: books({ smite: 5 }, { looting: 3 }) })
  const unbreakingBoots = (...levels: number[]): AdvancedProblem =>
    advanced({ target: target('boots'), books: books(...levels.map((unbreaking) => ({ unbreaking }))), goal: { unbreaking: 3 } })

  it.each<[string, Problem, Settings, AdditiveIneligibility | null]>([
    ['boots + 7 max books (advanced, no goal)', BOOTS_WITH_MAX_BOOKS, java, null],
    ['boots + 7 max books (simple mode)', bootsSimpleMode, java, null],
    ['boots + 7 max books, Bedrock', BOOTS_WITH_MAX_BOOKS, bedrock, null],
    ['boots + 7 max books, rename', BOOTS_WITH_MAX_BOOKS, { ...java, rename: true }, null],
    ['boots + 7 max books, no cap', BOOTS_WITH_MAX_BOOKS, { ...java, levelCap: null }, null],
    ['boots + 7 max books, objective xp', BOOTS_WITH_MAX_BOOKS, { ...java, objective: 'xp' }, 'objective'],
    ['boots + 7 max books, objective finalPwp', BOOTS_WITH_MAX_BOOKS, { ...java, objective: 'finalPwp' }, 'objective'],
    ['helmet with 2 anvil uses + 6 books', advanced({ target: target('helmet', {}, 2), books: books({ protection: 4 }, { thorns: 3 }, { respiration: 3 }, { aqua_affinity: 1 }, { unbreaking: 3 }, { mending: 1 }) }), java, null],
    ['boots with 2 anvil uses + 7 max books', advanced({ target: target('boots', {}, 2), books: MAX_BOOTS_BOOKS }), java, null],
    ['books only, Sharpness IV x2 + Unbreaking III', advanced({ books: books({ sharpness: 4 }, { sharpness: 4 }, { unbreaking: 3 }) }), java, 'overlap'],
    ['sword + Sharpness IV x2, Looting III, Unbreaking III', advanced({ target: target('sword'), books: books({ sharpness: 4 }, { sharpness: 4 }, { looting: 3 }, { unbreaking: 3 }) }), java, 'overlap'],
    ['trident{Loyalty III, Channeling} + {Riptide III, Unbreaking III} + Mending', advanced({ target: target('trident', { loyalty: 3, channeling: 1 }), books: books({ riptide: 3, unbreaking: 3 }, { mending: 1 }) }), java, 'conflict'],
    ['sword{Sharpness V} + Smite V + Looting III', sharpnessSwordSmiteLooting, java, 'conflict'],
    ['the same with goal Looting III', { ...sharpnessSwordSmiteLooting, goal: { looting: 3 } }, java, 'conflict'],
    ['pickaxe + Efficiency III x2, IV, Unbreaking III, Mending', advanced({ target: target('pickaxe'), books: books({ efficiency: 3 }, { efficiency: 3 }, { efficiency: 4 }, { unbreaking: 3 }, { mending: 1 }) }), java, 'overlap'],
    ['mace + Wind Burst I x4, Density V, Unbreaking III, Mending', advanced({ target: target('mace'), books: books({ wind_burst: 1 }, { wind_burst: 1 }, { wind_burst: 1 }, { wind_burst: 1 }, { density: 5 }, { unbreaking: 3 }, { mending: 1 }), goal: { wind_burst: 3, density: 5, unbreaking: 3, mending: 1 } }), java, 'overlap'],
    ['boots + Unbreaking I x4, goal III', unbreakingBoots(1, 1, 1, 1), java, 'overlap'],
    ['boots with 5 anvil uses + Thorns III', advanced({ target: target('boots', {}, 5), books: books({ thorns: 3 }) }), java, null],
    ['boots + Unbreaking I, II, II, goal III', unbreakingBoots(1, 2, 2), java, 'overlap'],
    ['boots + Unbreaking I x3, II, goal III', unbreakingBoots(1, 1, 1, 2), java, 'overlap'],
    ['boots + Unbreaking I x4, no goal', advanced({ target: target('boots'), books: books({ unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 1 }, { unbreaking: 1 }) }), java, 'overlap'],
    ['boots + three Unbreaking and Feather Falling books', advanced({ target: target('boots'), books: books({ unbreaking: 1, feather_falling: 1 }, { unbreaking: 1, feather_falling: 2 }, { unbreaking: 2, feather_falling: 1 }) }), java, 'overlap'],
    ['the 7 boots books combined into one book', advanced({ books: MAX_BOOTS_BOOKS }), java, null],
    ['boots with 6 anvil uses, rename, Bedrock', advanced({ target: target('boots', { unbreaking: 3 }, 6), goal: { unbreaking: 3 } }), { ...bedrock, rename: true }, 'rename-prior-work'],
    ['sword + Sharpness V, Smite V, Looting III', advanced({ target: target('sword'), books: books({ sharpness: 5 }, { smite: 5 }, { looting: 3 }) }), java, 'conflict'],
  ])('%s -> %s', (_label, problem, settings, expected) => {
    expect(because(problem, settings)).toBe(expected)
  })
})

describe('solveTreeTable: known scenarios (replayed with rules.ts step by step)', () => {
  function solvedKeys(problem: Problem, settings: Settings = java): Keys {
    const np = normalized(problem, settings)
    const plan = solvedPlan(solveTreeTable(np, settings))
    expectAllTransferred(np, plan, replay(np, plan, settings))
    return keysOf(plan)
  }

  it('boots + 7 max books = [66, 16, 1246, 15] in both editions, with and without a cap', () => {
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, java)).toEqual([66, 16, 1246, 15])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, bedrock)).toEqual([66, 16, 1246, 15])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...java, levelCap: null })).toEqual([66, 16, 1246, 15])
    expect(solvedKeys(BOOTS_WITH_MAX_BOOKS, { ...bedrock, levelCap: null })).toEqual([66, 16, 1246, 15])
  })

  it('evaluates all 72 total-optimal plans for boots + 7 max books and reports the stats', () => {
    const outcome = solve(BOOTS_WITH_MAX_BOOKS)
    expect(outcome.stats).toEqual({ eligible: true, ineligibleBecause: null, classes: 5, shapesAtOptimum: 1, tieBreakEvaluations: 72, tieBreakComplete: true })
    const plan = solvedPlan(outcome)
    expect(plan.keys.inputsUsed).toBe(8)
    expect(plan.usedInputs).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('boots + 7 max books with rename: [67, 16, 1253, 15] with a rename-only step of cost 1 on the fresh target', () => {
    for (const settings of [{ ...java, rename: true }, { ...bedrock, rename: true }]) {
      const np = normalized(BOOTS_WITH_MAX_BOOKS, settings)
      const plan = solvedPlan(solveTreeTable(np, settings))
      expect(keysOf(plan)).toEqual([67, 16, 1253, 15])
      expect(plan.stepCosts[0]).toBe(1)
      expect(leavesInOrder(plan.tree)[0]).toEqual({ t: 'leaf', input: 0, preRename: true })
      expect(replay(np, plan, settings).named).toBe(true)
    }
  })

  it('helmet with 0 / 1 / 2 prior anvil uses -> 45 / 50 / 58', () => {
    const helmet = (uses: number) =>
      advanced({ target: target('helmet', {}, uses), books: books({ protection: 4 }, { thorns: 3 }, { respiration: 3 }, { aqua_affinity: 1 }, { unbreaking: 3 }, { mending: 1 }) })
    expect([0, 1, 2].map((uses) => solvedKeys(helmet(uses))[0])).toEqual([45, 50, 58])
  })

  it('boots (uses 2) + the 7 max books -> 83', () => {
    expect(solvedKeys(advanced({ target: target('boots', {}, 2), books: MAX_BOOTS_BOOKS }))[0]).toBe(83)
  })

  it('boots (uses 3) + 5 books -> [79, 32, 3423, 31]', () => {
    const problem = advanced({ target: target('boots', {}, 3), books: books({ soul_speed: 3 }, { thorns: 3 }, { feather_falling: 4 }, { depth_strider: 3 }, { protection: 4 }) })
    expect(solvedKeys(problem)).toEqual([79, 32, 3423, 31])
  })

  it('boots (uses 5) + Thorns III costs 43 -> falls back (over the cap); + Mending instead -> 33', () => {
    const problem = advanced({ target: target('boots', {}, 5), books: books({ thorns: 3 }) })
    const outcome = solve(problem)
    expect(outcome).toMatchObject({ status: 'fallback', cause: 'over-cap', bestWithinCap: null, stats: { tieBreakComplete: true } })
    if (outcome.status !== 'fallback') return
    // 31 + 0 + 4 * 3 = 43, XP xpAtLevel(43) = 3553, 6 anvil uses -> PWP 63
    expect(keysOf(outcome.best)).toEqual([43, 43, 3553, 63])
    expect(solvedKeys(problem, { ...java, levelCap: null })[0]).toBe(43)
    expect(solvedKeys(advanced({ target: target('boots', {}, 5), books: books({ mending: 1 }) }))).toEqual([33, 33, 1758, 63])
  })

  it('the 7 boots books combined into one book -> [49, 12, 793, 15] in both editions; the sword books -> [31, 10, 435, 7]', () => {
    expect(solvedKeys(advanced({ books: MAX_BOOTS_BOOKS }), java)).toEqual([49, 12, 793, 15])
    expect(solvedKeys(advanced({ books: MAX_BOOTS_BOOKS }), bedrock)).toEqual([49, 12, 793, 15])
    const swordBooks = advanced({ books: books({ sharpness: 5 }, { looting: 3 }, { unbreaking: 3 }, { mending: 1 }, { fire_aspect: 2 }, { sweeping_edge: 3 }) })
    expect(solvedKeys(swordBooks, java)).toEqual([31, 10, 435, 7])
  })

  it('the 7 boots books with rename: the base book gets the rename-only step', () => {
    const settings: Settings = { ...java, rename: true }
    const np = normalized(advanced({ books: MAX_BOOTS_BOOKS }), settings)
    const plan = solvedPlan(solveTreeTable(np, settings))
    expect(keysOf(plan)).toEqual([50, 12, 800, 15])
    expect(leavesInOrder(plan.tree)[0]).toEqual({ t: 'leaf', input: 0, preRename: true })
    expect(replay(np, plan, settings).kind).toBe('book')
  })

  it('uses only the goal books when useOnlyNeeded, and leaves the dropped books out of the tree', () => {
    const problem = advanced({ target: target('sword'), books: books({ looting: 3 }, { unbreaking: 3 }, { sharpness: 5 }), goal: { looting: 3, sharpness: 5 } })
    const np = normalized(problem, java)
    const plan = solvedPlan(solveTreeTable(np, java))
    expect(plan.usedInputs).toEqual([0, 1, 3])
    expect(leavesInOrder(plan.tree).map((leaf) => leaf.input).sort()).toEqual([0, 1, 3])
    expect(plan.keys.inputsUsed).toBe(3)
    expectAllTransferred(np, plan, replay(np, plan, java))
  })

  it('handles a single leaf (no combine step) and a single book', () => {
    const lone = solvedPlan(solve(advanced({ target: target('sword'), books: books({ looting: 3 }), goal: {} })))
    expect(lone).toEqual({
      tree: { t: 'leaf', input: 0, preRename: false },
      stepCosts: [],
      keys: { totalLevels: 0, maxStepLevels: 0, xpPoints: 0, finalPriorWorkPenalty: 0, inputsUsed: 1 },
      finalAnvilUses: 0,
      usedInputs: [0],
    })
    const renamed = solvedPlan(solve(advanced({ target: target('sword'), books: books({ looting: 3 }), goal: {} }), { ...java, rename: true }))
    expect(renamed.stepCosts).toEqual([1])
    expect(keysOf(renamed)).toEqual([1, 1, 7, 0])
    const one = solvedPlan(solve(advanced({ target: target('sword'), books: books({ looting: 3 }) })))
    expect(one.tree).toEqual({ t: 'combine', left: { t: 'leaf', input: 0, preRename: false }, right: { t: 'leaf', input: 1, preRename: false }, rename: false })
    expect(keysOf(one)).toEqual([6, 6, 72, 1])
  })

  it('throws on a problem that is not additive (forceMethod tree-table on an ineligible problem)', () => {
    const np = normalized(advanced({ books: books({ sharpness: 4 }, { sharpness: 4 }) }), java)
    expect(() => solveTreeTable(np, java)).toThrow(/overlap/)
    expect(() => solveTreeTable(normalized(BOOTS_WITH_MAX_BOOKS, java), { ...java, objective: 'xp' })).toThrow(/objective/)
  })

  it('reports the stats of an ineligible problem', () => {
    expect(ineligibleFastPathStats('overlap')).toEqual({ eligible: false, ineligibleBecause: 'overlap', classes: 0, shapesAtOptimum: 0, tieBreakEvaluations: 0, tieBreakComplete: true })
  })
})

describe('solveTreeTable: cap check and fallback signaling', () => {
  it('is solved when the winner fits the cap exactly, and falls back over the cap when every optimal plan exceeds it', () => {
    expect(solve(BOOTS_WITH_MAX_BOOKS, java, { levelCap: 16 }).status).toBe('solved')
    const over = solve(BOOTS_WITH_MAX_BOOKS, java, { levelCap: 15 })
    expect(over).toMatchObject({ status: 'fallback', cause: 'over-cap', bestWithinCap: null })
    if (over.status === 'fallback') expect(keysOf(over.best)).toEqual([66, 16, 1246, 15])
  })

  it('marks the tie-break partial exactly when the needed evaluations exceed the budget', () => {
    expect(solve(BOOTS_WITH_MAX_BOOKS, java, { limits: { tieBreakMaxEvaluations: 72 } })).toMatchObject({ status: 'solved', stats: { tieBreakEvaluations: 72, tieBreakComplete: true } })
    const partial = solve(BOOTS_WITH_MAX_BOOKS, java, { limits: { tieBreakMaxEvaluations: 71 } })
    expect(partial).toMatchObject({ status: 'fallback', cause: 'tie-break-partial', stats: { tieBreakEvaluations: 71, tieBreakComplete: false } })
  })

  it('keeps the proven total in a partial tie-break and offers the winner as bestWithinCap when it fits', () => {
    const partial = solve(BOOTS_WITH_MAX_BOOKS, java, { limits: { tieBreakMaxEvaluations: 3 } })
    if (partial.status !== 'fallback') throw new Error('expected a fallback')
    expect(partial.best.keys.totalLevels).toBe(66)
    expect(partial.best.keys.maxStepLevels).toBeGreaterThanOrEqual(16)
    expect(partial.bestWithinCap).toBe(partial.best)
    const np = normalized(BOOTS_WITH_MAX_BOOKS, java)
    expectAllTransferred(np, partial.best, replay(np, partial.best, java))
  })

  it('has no bestWithinCap when the partial winner exceeds the cap', () => {
    const outcome = solve(BOOTS_WITH_MAX_BOOKS, java, { levelCap: 10, limits: { tieBreakMaxEvaluations: 1 } })
    expect(outcome).toMatchObject({ status: 'fallback', cause: 'tie-break-partial', bestWithinCap: null, stats: { tieBreakEvaluations: 1 } })
  })

  it('evaluates at least one plan even with a zero budget', () => {
    expect(solve(BOOTS_WITH_MAX_BOOKS, java, { limits: { tieBreakMaxEvaluations: 0 } })).toMatchObject({ status: 'fallback', stats: { tieBreakEvaluations: 1 } })
  })

  it('accepts a precomputed check and the fastPathMaxBooks override', () => {
    const np = normalized(BOOTS_WITH_MAX_BOOKS, java)
    const precomputed = checkAdditive(np, java)
    expect(solveTreeTable(np, java, { check: precomputed })).toEqual(solveTreeTable(np, java))
    expect(() => solveTreeTable(np, java, { limits: { fastPathMaxBooks: 3 } })).toThrow(/too-many-books/)
  })
})

describe('determinism', () => {
  it('returns identical outcomes on repeated calls and after rebuilding the tables', () => {
    const problems: [Problem, Settings][] = [
      [BOOTS_WITH_MAX_BOOKS, java],
      [advanced({ books: MAX_BOOTS_BOOKS }), { ...java, rename: true }],
      [advanced({ target: target('helmet', {}, 2), books: books({ protection: 4 }, { thorns: 3 }, { respiration: 3 }, { aqua_affinity: 1 }, { unbreaking: 3 }, { mending: 1 }) }), bedrock],
      [BOOTS_WITH_MAX_BOOKS, { ...java, levelCap: null }],
    ]
    const first = problems.map(([problem, settings]) => solve(problem, settings))
    expect(problems.map(([problem, settings]) => solve(problem, settings))).toEqual(first)
    clearTreeTableCache()
    solveWeights(new Array<number>(20).fill(3), 'book-only', 0)   // extend another table first
    expect(problems.map(([problem, settings]) => solve(problem, settings))).toEqual(first)
  })

  it('assigns books with equal weight in input order along the in-order leaves', () => {
    for (const [problem, settings] of [[BOOTS_WITH_MAX_BOOKS, java], [advanced({ books: MAX_BOOTS_BOOKS }), java]] as const) {
      const np = normalized(problem, settings)
      const result = checkAdditive(np, settings)
      if (!result.eligible) throw new Error('eligible expected')
      const weightOf = new Map(result.books.map((b) => [b.input, b.weight]))
      const plan = solvedPlan(solveTreeTable(np, settings, { check: result }))
      const leaves = leavesInOrder(plan.tree).map((leaf) => leaf.input).filter((input) => input !== np.targetIndex)
      for (const weight of new Set(weightOf.values())) {
        const order = leaves.filter((input) => weightOf.get(input) === weight)
        expect(order).toEqual([...order].sort((a, b) => a - b))
      }
    }
  })

  it('puts the target on the leftmost leaf, and in book-only mode the heaviest book with the lowest index', () => {
    expect(leavesInOrder(solvedPlan(solve(BOOTS_WITH_MAX_BOOKS)).tree)[0].input).toBe(0)
    // Books only: Soul Speed III (input 0) and Thorns III (input 1) both weigh 12
    expect(leavesInOrder(solvedPlan(solve(advanced({ books: MAX_BOOTS_BOOKS }))).tree)[0].input).toBe(0)
    const reversed = advanced({ books: [...MAX_BOOTS_BOOKS].reverse() })   // Thorns III is input 5, Soul Speed III input 6
    expect(leavesInOrder(solvedPlan(solve(reversed)).tree)[0].input).toBe(5)
  })
})

// Weights only

function weightsArb(minLength: number, maxLength: number): fc.Arbitrary<number[]> {
  return fc.integer({ min: minLength, max: maxLength }).chain((length) => {
    const of = (value: fc.Arbitrary<number>) => fc.array(value, { minLength: length, maxLength: length })
    return fc.oneof(
      fc.integer({ min: 1, max: 12 }).map((w) => new Array<number>(length).fill(w)),
      fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 })).chain(([a, b]) => of(fc.constantFrom(a, b))),
      of(fc.constantFrom(1, 2, 3, 4, 6, 8, 12)),
      of(fc.integer({ min: 1, max: 20 })),
      of(fc.integer({ min: 1, max: 40 })),
    )
  })
}

const modeArb = fc.oneof(
  fc.record({ mode: fc.constant<AdditiveMode>('item'), targetUses: fc.integer({ min: 0, max: 3 }) }),
  fc.record({ mode: fc.constant<AdditiveMode>('book-only'), targetUses: fc.constant(0) }),
)

function weightKeys(weights: readonly number[], mode: AdditiveMode, targetUses: number): Keys {
  const solution = solveWeights(weights, mode, targetUses)
  expect(solution.tieBreakComplete).toBe(true)
  const { best } = solution
  expect(best.totalLevels).toBe(solution.optimalTotal)
  return [best.totalLevels, best.maxStepLevels, best.xpPoints, best.finalPriorWorkPenalty]
}

/** These usually take 2-5 s, too close to the default 5 s on a busy machine. */
const HEAVY_TEST_TIMEOUT_MS = 60_000

describe('solveWeights vs every combination of shape and assignment (exhaustive, up to 8 leaves)', () => {
  it('matches on random weights, 2-7 leaves, item mode (u = 0-3) and book-only mode', () => {
    fc.assert(
      fc.property(modeArb, weightsArb(1, 6), ({ mode, targetUses }, weights) => {
        const bookOnlyWeights = mode === 'book-only' ? [...weights, weights[0]] : weights   // book-only mode gets 2-7 leaves
        expect(weightKeys(bookOnlyWeights, mode, targetUses)).toEqual(bruteForceKeys(bookOnlyWeights, mode, targetUses))
      }),
      { numRuns: 400, seed: SEED },
    )
  }, HEAVY_TEST_TIMEOUT_MS)

  it.each<[string, number[], AdditiveMode, number]>([
    ['boots + 7 max books', [12, 12, 6, 4, 4, 3, 2], 'item', 0],
    ['boots (uses 2) + 7 max books', [12, 12, 6, 4, 4, 3, 2], 'item', 2],
    ['8 books of 1-4', [4, 1, 3, 3, 2, 4, 1, 2], 'book-only', 0],
    ['8 equal books', [5, 5, 5, 5, 5, 5, 5, 5], 'book-only', 0],
    ['7 books of two values, target uses 1', [8, 3, 8, 3, 3, 8, 3], 'item', 1],
    ['8 books of the realistic pool', [12, 8, 6, 6, 4, 3, 2, 1], 'book-only', 0],
  ])('matches at 8 leaves: %s', (_label, weights, mode, targetUses) => {
    expect(weightKeys(weights, mode, targetUses)).toEqual(bruteForceKeys(weights, mode, targetUses))
  }, HEAVY_TEST_TIMEOUT_MS)
})

describe('solveWeights vs the additive subset DP on synthetic weights', () => {
  it('matches on tie-heavy and random weights, 1-9 books, both modes, u = 0-3', () => {
    fc.assert(
      fc.property(modeArb, weightsArb(1, 9), ({ mode, targetUses }, weights) => {
        expect(weightKeys(weights, mode, targetUses)).toEqual(additiveDpKeys(weights, mode, targetUses))
      }),
      { numRuns: 400, seed: SEED + 1 },
    )
  })

  it('agrees with the exhaustive enumeration itself (the two references check each other)', () => {
    fc.assert(
      fc.property(modeArb, weightsArb(1, 5), ({ mode, targetUses }, weights) => {
        expect(additiveDpKeys(weights, mode, targetUses)).toEqual(bruteForceKeys(weights, mode, targetUses))
      }),
      { numRuns: 150, seed: SEED + 2 },
    )
  })
})

describe('solveWeights: arguments and results', () => {
  it('validates the weights and the leaf count', () => {
    expect(() => solveWeights([], 'book-only', 0)).toThrow(RangeError)
    expect(() => solveWeights([1.5], 'item', 0)).toThrow(RangeError)
    expect(() => solveWeights([-1], 'item', 0)).toThrow(RangeError)
  })

  it('returns one book per non-target leaf, each book exactly once', () => {
    const weights = [3, 12, 3, 6, 12, 1, 3, 2]
    for (const mode of ['item', 'book-only'] as const) {
      const { best } = solveWeights(weights, mode, 0)
      const books = best.leafBooks.filter((b) => b >= 0)
      expect([...books].sort((a, b) => a - b)).toEqual(weights.map((_, i) => i))
      if (mode === 'item') expect(best.leafBooks[0]).toBe(-1)
    }
  })
})

// Random additive problems from real data

/** Picked greedily; a null itemType means any item. */
function compatibleEnchantments(edition: Edition, itemType: ItemTypeId | null, order?: readonly EnchantmentId[]): EnchantmentId[] {
  const pool = order ?? (itemType === null ? itemsInEdition(edition).flatMap((i) => applicableEnchantments(edition, i.id)) : applicableEnchantments(edition, itemType))
  const chosen: EnchantmentId[] = []
  for (const id of pool) if (!chosen.includes(id) && chosen.every((other) => areCompatible(edition, id, other))) chosen.push(id)
  return chosen
}

interface RealCase {
  readonly problem: AdvancedProblem
  readonly settings: Settings
}

function realCaseArb(): fc.Arbitrary<RealCase> {
  return fc.record({
    edition: fc.constantFrom<Edition>('java', 'bedrock'),
    seed: fc.integer({ min: 0, max: 2 ** 30 }),
    bookOnly: fc.boolean(),
    targetUses: fc.integer({ min: 0, max: 3 }),
    rename: fc.boolean(),
    levelCap: fc.constantFrom<39 | null>(39, null),
  }).map(({ edition, seed, bookOnly, targetUses, rename, levelCap }) => {
    const random = mulberry32(seed)
    const items = itemsInEdition(edition).filter((i) => !i.isBook && applicableEnchantments(edition, i.id).length > 0)
    const itemType = items[Math.floor(random() * items.length)].id
    const shuffled = shuffle(bookOnly ? enchantmentsInEdition(edition).map((e) => e.id) : [...applicableEnchantments(edition, itemType)], random)
    const chosen = compatibleEnchantments(edition, itemType, shuffled).slice(0, 1 + Math.floor(random() * 10))
    const bookList: EnchantLevels[] = []
    for (let i = 0; i < chosen.length; ) {
      const size = random() < 0.3 ? 2 : 1
      const book: EnchantLevels = {}
      for (const id of chosen.slice(i, i + size)) book[id] = 1 + Math.floor(random() * maxLevel(id))
      bookList.push(book)
      i += size
    }
    const problem = advanced({ target: bookOnly ? null : target(itemType, {}, rename ? 0 : targetUses), books: books(...bookList) })
    return { problem, settings: { edition, levelCap, objective: 'levels', rename } }
  })
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

describe('real data: random additive problems (without the exact search)', () => {
  it('are eligible, replay exactly with rules.ts, keep every enchantment, and match the additive DP', () => {
    fc.assert(
      fc.property(realCaseArb(), ({ problem, settings }) => {
        const np = normalized(problem, settings)
        const result = checkAdditive(np, settings)
        expect(result.eligible).toBe(true)
        if (!result.eligible) return
        // The weight is the sum of book multiplier * level
        for (const { input, weight } of result.books) {
          const expected = levelEntries(np.inputs[input].enchantments).reduce((sum, [id, level]) => sum + multiplier(settings.edition, id, 'book') * level, 0)
          expect(weight).toBe(expected)
        }
        const outcome = solveTreeTable(np, settings, { check: result })
        const plan = outcome.status === 'solved' ? outcome.plan : outcome.best
        expectAllTransferred(np, plan, replay(np, plan, settings, outcome.status === 'solved' ? settings.levelCap : null))
        // Keys from the independent DP; a rename-only step adds 1 level and 7 XP points
        const mode: AdditiveMode = np.targetIndex === null ? 'book-only' : 'item'
        const uses = np.targetIndex === null ? 0 : np.inputs[np.targetIndex].anvilUses
        const [total, maxStep, xp, finalPwp] = additiveDpKeys(result.books.map((b) => b.weight), mode, uses)
        const renameCost = settings.rename ? 1 : 0
        const expected: Keys = [total + renameCost, Math.max(maxStep, renameCost), xp + 7 * renameCost, finalPwp]
        if (outcome.status === 'solved' || outcome.cause === 'over-cap') expect(keysOf(plan)).toEqual(expected)
        else expect(plan.keys.totalLevels).toBe(expected[0])   // a partial tie-break still has the optimal total
        if (outcome.status === 'fallback' && outcome.cause === 'over-cap') expect(expected[1]).toBeGreaterThan(39)
      }),
      { numRuns: 300, seed: SEED + 3 },
    )
  })

  it('gives equal totals in Java and Bedrock when no Impaling is involved', () => {
    fc.assert(
      fc.property(realCaseArb(), ({ problem, settings }) => {
        const hasImpaling = problem.books.some((b) => b.enchantments.impaling !== undefined)
        fc.pre(!hasImpaling && settings.edition === 'java')
        const other: Settings = { ...settings, edition: 'bedrock', levelCap: null }
        fc.pre(validateProblem(problem, other).length === 0)
        const np = normalizeProblem(problem, other)
        fc.pre(checkAdditive(np, other).eligible)
        const totalOf = (outcome: FastPathOutcome) => (outcome.status === 'solved' ? outcome.plan : outcome.best).keys.totalLevels
        expect(totalOf(solve(problem, { ...settings, levelCap: null }))).toBe(totalOf(solveTreeTable(np, other)))
      }),
      { numRuns: 200, seed: SEED + 4 },
    )
  })
})
