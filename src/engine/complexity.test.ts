import type { EnchantmentId } from '../data/types.ts'
import { enchantmentUniverse } from './compile.ts'
import { estimateComplexity, estimateNormalizedComplexity, INSTANT_COMPLEXITY, subsetComplexity } from './complexity.ts'
import { LIMITS } from './limits.ts'
import { normalizeProblem } from './normalize.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, Problem, Settings, SimpleProblem } from './types.ts'

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const book = (enchantments: EnchantLevels, count = 1): BookInput => ({ enchantments, anvilUses: 0, count })
const simple = (item: SimpleProblem['item'], ids: readonly EnchantmentId[]): SimpleProblem =>
  ({ mode: 'simple', item, enchantments: ids.map((id) => ({ id, level: 1 })) })

/** No two alike, and they overlap, so the problem is not additive. */
function distinctBooks(n: number): BookInput[] {
  const levels: EnchantLevels[] = [
    ...[1, 2, 3, 4, 5].map((level) => ({ sharpness: level })),
    ...[1, 2, 3].map((level) => ({ looting: level })),
    ...[1, 2, 3].map((level) => ({ unbreaking: level })),
    { mending: 1 },
    ...[1, 2].map((level) => ({ fire_aspect: level })),
    ...[1, 2].map((level) => ({ knockback: level })),
  ]
  if (n > levels.length) throw new Error('not enough distinct books')
  return levels.slice(0, n).map((enchantments) => book(enchantments))
}
const sword = { itemType: 'sword', enchantments: {}, anvilUses: 0 } as const
/**
 * Keeps every book in the search: a book without goal enchantments that neither shares an enchantment with another input
 * nor conflicts with one is left out of C.
 */
const everyBookInGoal = (n: number): EnchantLevels =>
  Object.fromEntries(distinctBooks(n).flatMap((b) => Object.entries(b.enchantments))) as EnchantLevels
const boots = { itemType: 'boots', enchantments: {}, anvilUses: 0 } as const

/** Nine boots enchantments that are pairwise compatible, the most boots can hold in Java. */
const BOOTS_NINE: EnchantmentId[] = ['protection', 'feather_falling', 'thorns', 'depth_strider', 'soul_speed', 'unbreaking', 'mending', 'binding_curse', 'vanishing_curse']

describe('subsetComplexity', () => {
  it('is 2 * 3^n with a target and 3^n without for n distinct inputs', () => {
    for (const n of [0, 1, 5, 12]) {
      expect(subsetComplexity(normalizeProblem(advanced({ target: sword, books: distinctBooks(n) }), java))).toBe(2 * 3 ** n)
      expect(subsetComplexity(normalizeProblem(advanced({ books: distinctBooks(n) }), java))).toBe(3 ** n)
    }
  })

  it('counts a group of c identical inputs as (c + 1)(c + 2) / 2', () => {
    // Wind Burst I x4: 5 subsets and 15 (subset, left part) pairs
    const np = normalizeProblem({ mode: 'simple', item: 'mace', enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }] }, java)
    expect(subsetComplexity(np)).toBe(2 * 15)
    // Identical extra items form a group too; the target never does
    const extras = normalizeProblem(advanced({ target: sword, extraItems: [{ enchantments: {}, anvilUses: 0 }, { enchantments: {}, anvilUses: 0 }] }), java)
    expect(subsetComplexity(extras)).toBe(2 * 6)
  })
})

describe('estimateComplexity: measured reference problems', () => {
  it('boots + 7 books (additive): C = 4 374, instant through the tree-table method', () => {
    const estimate = estimateComplexity(simple('boots', BOOTS_NINE.slice(0, 7)), java)
    expect(estimate).toEqual({ complexity: 4374, effectiveComplexity: 4374, fastPathEligible: true, level: 'instant', hardLimit: LIMITS.exactComplexityHard })
  })

  it('boots + 9 books without a cap: C = 39 366, C_eff doubled', () => {
    const estimate = estimateComplexity(simple('boots', BOOTS_NINE), { ...java, levelCap: null })
    expect(estimate).toMatchObject({ complexity: 39_366, effectiveComplexity: 78_732, fastPathEligible: true, level: 'instant' })
  })

  it('sword stacking, 10 inputs, goal: C = 17 496 (exact search, instant)', () => {
    const problem = advanced({
      target: sword,
      books: [book({ sharpness: 4 }, 2), book({ looting: 2 }, 2), book({ unbreaking: 3 }), book({ mending: 1 }), book({ fire_aspect: 2 }), book({ knockback: 2 }), book({ sweeping_edge: 3 })],
      goal: { sharpness: 5, looting: 3, unbreaking: 3, mending: 1, fire_aspect: 2, knockback: 2, sweeping_edge: 3 },
    })
    expect(estimateComplexity(problem, java)).toMatchObject({ complexity: 17_496, fastPathEligible: false, level: 'instant', hardLimit: LIMITS.exactComplexityHard })
    // With the goal {Sharpness V, Looting III} alone, the other five books are left out of the search: C = 2 * 6 * 6
    expect(estimateComplexity({ ...problem, goal: { sharpness: 5, looting: 3 } }, java)).toMatchObject({ complexity: 72, level: 'instant' })
  })

  it('target + 11 distinct inputs, every input used: C = 354 294, slow (use-all hard limit 360 000)', () => {
    const problem = advanced({ target: sword, books: distinctBooks(11), goal: null, useOnlyNeeded: false })
    expect(estimateComplexity(problem, java)).toEqual({
      complexity: 354_294, effectiveComplexity: 354_294, fastPathEligible: false, level: 'slow', hardLimit: LIMITS.exactComplexityHardUseAll,
    })
    // Rename and a missing cap each double C_eff past the limit; target + 10 still fits with one of them
    expect(estimateComplexity(problem, { ...java, rename: true })).toMatchObject({ effectiveComplexity: 708_588, level: 'too-complex' })
    expect(estimateComplexity(problem, { ...java, levelCap: null })).toMatchObject({ effectiveComplexity: 708_588, level: 'too-complex' })
    const ten = advanced({ target: sword, books: distinctBooks(10), goal: null, useOnlyNeeded: false })
    expect(estimateComplexity(ten, { ...java, rename: true })).toMatchObject({ effectiveComplexity: 236_196, level: 'slow' })
    expect(estimateComplexity(ten, { ...java, rename: true, levelCap: null })).toMatchObject({ effectiveComplexity: 472_392, level: 'too-complex' })
  })

  it('a goal with useOnlyNeeded false also uses the use-all hard limit', () => {
    const problem = advanced({ target: sword, books: distinctBooks(11), goal: { sharpness: 5 }, useOnlyNeeded: false })
    expect(estimateComplexity(problem, java)).toMatchObject({ hardLimit: LIMITS.exactComplexityHardUseAll, level: 'slow' })
  })

  it('12 distinct books without a target: C = 531 441', () => {
    const useAll = advanced({ books: distinctBooks(12), goal: null, useOnlyNeeded: false })
    expect(estimateComplexity(useAll, java)).toMatchObject({ complexity: 531_441, fastPathEligible: false, level: 'too-complex', hardLimit: 360_000 })
    const withGoal = advanced({ books: distinctBooks(12), goal: everyBookInGoal(12) })
    expect(estimateComplexity(withGoal, java)).toMatchObject({ complexity: 531_441, level: 'slow', hardLimit: 1_200_000 })
  })

  it('boots + 16 stacked books: C = 546 750, admitted with a goal and useOnlyNeeded', () => {
    const problem = advanced({
      target: boots,
      books: [book({ protection: 2 }, 4), book({ feather_falling: 2 }, 4), book({ unbreaking: 1 }, 4), book({ thorns: 3 }), book({ depth_strider: 3 }), book({ soul_speed: 3 }), book({ mending: 1 })],
      goal: { protection: 4, feather_falling: 4, unbreaking: 3, thorns: 3, depth_strider: 3, soul_speed: 3, mending: 1 },
    })
    expect(estimateComplexity(problem, java)).toMatchObject({ complexity: 546_750, fastPathEligible: false, level: 'slow' })
  })

  it('target + 12 distinct inputs with a goal: C = 1 062 882 is slow, too complex with rename', () => {
    const problem = advanced({ target: sword, books: distinctBooks(12), goal: everyBookInGoal(12) })
    expect(estimateComplexity(problem, java)).toMatchObject({ complexity: 1_062_882, level: 'slow', hardLimit: 1_200_000 })
    expect(estimateComplexity(problem, { ...java, rename: true })).toMatchObject({ effectiveComplexity: 2_125_764, level: 'too-complex' })
  })

  it('target + 12 multi-enchantment books, every input used, no cap: rejected without searching', () => {
    const books = distinctBooks(12).map((b, i) => ({ ...b, enchantments: { ...b.enchantments, ...(i % 2 === 0 ? {} : { mending: 1 }) } }))
    const problem = advanced({ target: sword, books, goal: null, useOnlyNeeded: false })
    expect(estimateComplexity(problem, { ...java, levelCap: null })).toMatchObject({ complexity: 1_062_882, effectiveComplexity: 2_125_764, level: 'too-complex' })
  })
})

describe('estimateComplexity: inputs left out of the search', () => {
  // Sword, goal {Sharpness V, Looting III, Unbreaking III, Mending}: the four goal books plus books without goal enchantments
  const relevant = [book({ sharpness: 5 }), book({ looting: 3 }), book({ unbreaking: 3 }), book({ mending: 1 })]
  const goal = { sharpness: 5, looting: 3, unbreaking: 3, mending: 1 }
  const unrelated = [
    book({ protection: 4 }), book({ feather_falling: 4 }), book({ efficiency: 5 }), book({ fortune: 3 }), book({ power: 5 }),
    book({ respiration: 3 }), book({ lure: 3 }), book({ quick_charge: 3 }), book({ aqua_affinity: 1 }),
  ]

  it('counts neither the unrelated books in C nor their enchantments in the 30-enchantment limit', () => {
    const problem = advanced({ target: sword, books: [...relevant, ...unrelated], goal })
    const np = normalizeProblem(problem, java)
    expect(np.excludedInputs).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(subsetComplexity(np)).toBe(2 * 3 ** 4)
    expect(enchantmentUniverse(np)).toEqual(['looting', 'mending', 'sharpness', 'unbreaking'])
    // Nothing is left out without a goal or when every input must be used
    expect(normalizeProblem({ ...problem, useOnlyNeeded: false }, java).excludedInputs).toEqual([])
    expect(normalizeProblem({ ...problem, goal: null }, java).excludedInputs).toEqual([])
  })

  it('keeps a book that shares an enchantment with, or conflicts with, a kept input, and what that book pulls in', () => {
    const sharing = advanced({ target: sword, books: [...relevant, book({ looting: 1, protection: 4 }), book({ protection: 3 }), book({ fire_protection: 2 }), book({ power: 5 })], goal })
    // The Looting I book (5) stays, so the book sharing its Protection (6) and the one exclusive with it (7) stay too; only Power (8) is left out
    expect(normalizeProblem(sharing, java).excludedInputs).toEqual([8])
    const conflicting = advanced({ target: sword, books: [...relevant, book({ smite: 1 })], goal })
    expect(normalizeProblem(conflicting, java).excludedInputs).toEqual([])
    // The target's enchantments count as kept, and extra items are never left out
    const onTarget = advanced({ target: { ...sword, enchantments: { knockback: 1 } }, extraItems: [{ enchantments: {}, anvilUses: 0 }], books: [...relevant, book({ knockback: 2 })], goal })
    expect(normalizeProblem(onTarget, java).excludedInputs).toEqual([])
  })
})

describe('estimateComplexity: levels', () => {
  it('is instant up to C_eff = 40 000 and ok up to the soft limit', () => {
    // 2 * 3^9 = 39366 <= 40000, 2 * 3^10 = 118098 <= 200000
    expect(estimateComplexity(advanced({ target: sword, books: distinctBooks(9) }), java)).toMatchObject({ effectiveComplexity: 39_366, level: 'instant' })
    expect(estimateComplexity(advanced({ target: sword, books: distinctBooks(10) }), java)).toMatchObject({ effectiveComplexity: 118_098, level: 'ok' })
    expect(INSTANT_COMPLEXITY).toBe(40_000)
  })

  it('is instant for the tree-table method with at most 10 used books, even when C_eff is large', () => {
    const ten: EnchantmentId[] = ['protection', 'feather_falling', 'thorns', 'depth_strider', 'soul_speed', 'unbreaking', 'mending', 'binding_curse', 'vanishing_curse', 'aqua_affinity']
    const tenBooks = estimateComplexity(simple('enchanted_book', ten), java)
    expect(tenBooks).toMatchObject({ complexity: 59_049, fastPathEligible: true, level: 'instant' })
    const twelve = estimateComplexity(simple('enchanted_book', [...ten, 'respiration', 'swift_sneak']), java)
    expect(twelve).toMatchObject({ complexity: 531_441, fastPathEligible: true, level: 'slow' })
  })

  it('never calls an additive problem too complex, however large (the tree-table method has no C limit)', () => {
    const ids: EnchantmentId[] = [
      'protection', 'feather_falling', 'thorns', 'depth_strider', 'soul_speed', 'unbreaking', 'mending', 'binding_curse',
      'vanishing_curse', 'aqua_affinity', 'respiration', 'swift_sneak', 'sharpness', 'looting', 'fire_aspect', 'knockback',
    ]
    const estimate = estimateComplexity(simple('enchanted_book', ids), { ...java, rename: true, levelCap: null })
    expect(estimate.fastPathEligible).toBe(true)
    expect(estimate.effectiveComplexity).toBeGreaterThan(LIMITS.exactComplexityHard)
    expect(estimate.level).toBe('slow')
  })

  it('is too complex when more than 30 enchantments appear and the problem is not additive', () => {
    const groups: EnchantmentId[][] = [
      ['protection', 'feather_falling', 'thorns', 'depth_strider', 'soul_speed', 'swift_sneak', 'respiration', 'aqua_affinity'],
      ['sharpness', 'looting', 'fire_aspect', 'knockback', 'sweeping_edge', 'unbreaking', 'mending', 'vanishing_curse'],
      ['efficiency', 'fortune', 'power', 'punch', 'flame', 'infinity', 'quick_charge', 'multishot'],
      ['lure', 'luck_of_the_sea', 'loyalty', 'impaling', 'channeling', 'wind_burst', 'binding_curse', 'lunge'],
    ]
    const books = groups.map((ids) => book(Object.fromEntries(ids.map((id) => [id, 1])) as EnchantLevels))
    const many: Problem = advanced({ books, goal: null, useOnlyNeeded: false })
    const np = normalizeProblem(many, java)
    expect(enchantmentUniverse(np)).toHaveLength(32)
    expect(estimateNormalizedComplexity(np, java)).toMatchObject({ complexity: 81, fastPathEligible: false, level: 'too-complex' })
    // With 30 or fewer, a problem with a small C is instant
    const fewer = advanced({ books: books.slice(0, 3), goal: null, useOnlyNeeded: false })
    expect(estimateComplexity(fewer, java)).toMatchObject({ complexity: 27, level: 'instant' })
  })

  it('returns an instant zero estimate for an invalid problem (the solver only validates it)', () => {
    const invalid = advanced({ target: { itemType: 'boots', enchantments: { efficiency: 5 }, anvilUses: 0 }, books: [book({ mending: 1 })], goal: null })
    expect(estimateComplexity(invalid, java)).toEqual({ complexity: 0, effectiveComplexity: 0, fastPathEligible: false, level: 'instant', hardLimit: LIMITS.exactComplexityHardUseAll })
    // Extra items without a target cannot be normalized, but the estimate does not throw
    expect(estimateComplexity(advanced({ extraItems: [{ enchantments: {}, anvilUses: 0 }] }), java).level).toBe('instant')
  })

  it('honors overridden limits (SolveOptions.limits)', () => {
    const problem = advanced({ target: sword, books: distinctBooks(9) })
    const limits = { ...LIMITS, exactComplexitySoft: 10, exactComplexityHard: 30_000, exactComplexityHardUseAll: 30_000 }
    expect(estimateComplexity(problem, java, limits)).toMatchObject({ level: 'too-complex', hardLimit: 30_000 })
  })
})
