import type { EnchantmentId, ItemTypeId } from '../../data/types.ts'
import {
  OBJECTIVE_KEYS,
  type AdvancedProblem,
  type BookInput,
  type EnchantLevels,
  type ItemInput,
  type KeyVector,
  type Objective,
  type Problem,
  type Settings,
  type SimpleEnchantmentRequest,
  type SimpleProblem,
  type TargetInput,
} from '../../engine/types.ts'
import {
  createRuleTable,
  levelsToVector,
  presentIds,
  priorWorkPenalty,
  simCombine,
  simRenameOnly,
  vectorToLevels,
  xpForLevels,
  type SimObject,
} from './anvil.ts'
import {
  bruteForceSolve,
  compareKeys,
  OBJECTIVES,
  ORACLE_KEY_ORDER,
  oracleNormalize,
  type OracleResult,
} from './bruteForce.ts'
import { sampleOracleCases } from './generators.ts'

const settings = (overrides: Partial<Settings> = {}): Settings =>
  ({ edition: 'java', levelCap: 39, objective: 'levels', rename: false, ...overrides })
const target = (itemType: ItemTypeId, enchantments: EnchantLevels = {}, anvilUses = 0): TargetInput => ({ itemType, enchantments, anvilUses })
const book = (enchantments: EnchantLevels, count = 1, anvilUses = 0): BookInput =>
  (count === 1 ? { enchantments, anvilUses } : { enchantments, anvilUses, count })
const spare = (enchantments: EnchantLevels, anvilUses = 0): ItemInput => ({ enchantments, anvilUses })

function advanced(
  targetInput: TargetInput | null,
  books: readonly BookInput[],
  options: { goal?: EnchantLevels; useOnlyNeeded?: boolean; extraItems?: readonly ItemInput[] } = {},
): AdvancedProblem {
  return {
    mode: 'advanced',
    target: targetInput,
    extraItems: options.extraItems ?? [],
    books,
    goal: options.goal ?? null,
    useOnlyNeeded: options.useOnlyNeeded ?? true,
  }
}

const simple = (item: ItemTypeId, enchantments: readonly SimpleEnchantmentRequest[]): SimpleProblem => ({ mode: 'simple', item, enchantments })

const BOOTS_BOOKS: readonly BookInput[] = [
  book({ soul_speed: 3 }), book({ thorns: 3 }), book({ feather_falling: 4 }), book({ depth_strider: 3 }),
  book({ protection: 4 }), book({ unbreaking: 3 }), book({ mending: 1 }),
]

/** For levels: [total, max, xp, final prior work penalty]. */
function head4(result: OracleResult, objective: Objective = result.objective): number[] {
  if (result.best === null) throw new Error('expected a plan, got infeasible')
  return result.best[objective].keys.slice(0, 4)
}

function totalOf(result: OracleResult): number {
  if (result.best === null) throw new Error('expected a plan, got infeasible')
  return result.best.levels.planKeys.totalLevels
}

function maximalSets(result: OracleResult): EnchantLevels[] {
  if (result.maximal === null) throw new Error('expected the maximal results of a problem without a goal')
  return result.maximal.map((entry) => entry.enchantments)
}

describe('comparison keys', () => {
  it('uses the same key order as OBJECTIVE_KEYS in engine/types.ts', () => {
    expect(ORACLE_KEY_ORDER).toEqual(OBJECTIVE_KEYS)
  })

  it('compares lexicographically', () => {
    expect(compareKeys([1, 9, 9, 9, 9], [2, 0, 0, 0, 0])).toBeLessThan(0)
    expect(compareKeys([2, 3, 4, 5, 6], [2, 3, 4, 5, 6])).toBe(0)
    expect(compareKeys([2, 3, 4, 5, 7], [2, 3, 4, 5, 6])).toBeGreaterThan(0)
  })
})

/** These take 2-5 seconds, too close to the default 5-second timeout on a busy machine. */
const HEAVY_TEST_TIMEOUT_MS = 60_000

describe('worked examples (oracle)', () => {
  it('finds [66, 16, 1246, 15] for boots + 7 max-level books', () => {
    const result = bruteForceSolve(advanced(target('boots'), BOOTS_BOOKS), settings())
    expect(result.keys).toEqual([66, 16, 1246, 15, 8])
    expect(result.best?.levels.final.enchantments).toEqual({
      depth_strider: 3, feather_falling: 4, mending: 1, protection: 4, soul_speed: 3, thorns: 3, unbreaking: 3,
    })
  })

  it('ranks the same plans by experience points and final prior work penalty, and with rename, Bedrock and no cap', () => {
    const result = bruteForceSolve(advanced(target('boots'), BOOTS_BOOKS), settings())
    expect(result.best?.xp.keys).toEqual([1246, 66, 16, 15, 8])
    // [finalPwp, total, max, xp]
    expect(result.best?.finalPwp.keys.slice(0, 4)).toEqual([7, 68, 21, 1456])
    expect(head4(bruteForceSolve(advanced(target('boots'), BOOTS_BOOKS), settings({ rename: true })))).toEqual([67, 16, 1253, 15])
    expect(head4(bruteForceSolve(advanced(target('boots'), BOOTS_BOOKS), settings({ edition: 'bedrock' })))).toEqual([66, 16, 1246, 15])
    expect(head4(bruteForceSolve(advanced(target('boots'), BOOTS_BOOKS), settings({ levelCap: null })))).toEqual([66, 16, 1246, 15])
  }, HEAVY_TEST_TIMEOUT_MS)

  it('charges more for a target with more anvil uses (helmet with 0 / 1 / 2 uses + 6 books = 45 / 50 / 58)', () => {
    const books = [book({ protection: 4 }), book({ thorns: 3 }), book({ respiration: 3 }), book({ aqua_affinity: 1 }), book({ unbreaking: 3 }), book({ mending: 1 })]
    expect([0, 1, 2].map((uses) => totalOf(bruteForceSolve(advanced(target('helmet', {}, uses), books), settings())))).toEqual([45, 50, 58])
  })

  it('finds 83 for boots with 2 anvil uses + the same 7 books', () => {
    expect(totalOf(bruteForceSolve(advanced(target('boots', {}, 2), BOOTS_BOOKS), settings()))).toBe(83)
  })

  it('finds [79, 32, 3423, 31] for boots with 3 anvil uses + 5 books', () => {
    expect(head4(bruteForceSolve(advanced(target('boots', {}, 3), BOOTS_BOOKS.slice(0, 5)), settings()))).toEqual([79, 32, 3423, 31])
  })

  it('merges books into one book (Sharpness IV x2 + Unbreaking III = [9, 5, 95, 3])', () => {
    const result = bruteForceSolve(advanced(null, [book({ sharpness: 4 }, 2), book({ unbreaking: 3 })]), settings())
    expect(head4(result)).toEqual([9, 5, 95, 3])
    expect(result.best?.levels.final.kind).toBe('book')
  })

  it('finds [24, 7, 290, 7] for a sword + Sharpness IV x2, Looting III, Unbreaking III', () => {
    const books = [book({ sharpness: 4 }, 2), book({ looting: 3 }), book({ unbreaking: 3 })]
    expect(head4(bruteForceSolve(advanced(target('sword'), books), settings()))).toEqual([24, 7, 290, 7])
  })

  it('uses a book that partly conflicts with the target (trident{Loyalty III, Channeling} + book{Riptide III, Unbreaking III} + book{Mending} = 8)', () => {
    const problem = advanced(target('trident', { loyalty: 3, channeling: 1 }), [book({ riptide: 3, unbreaking: 3 }), book({ mending: 1 })])
    expect(totalOf(bruteForceSolve(problem, settings()))).toBe(8)
  })

  it('leaves out a book the goal does not need (sword{Sharpness V} + Smite V + Looting III = 13, or 6 with goal {Looting III})', () => {
    const books = [book({ smite: 5 }), book({ looting: 3 })]
    expect(totalOf(bruteForceSolve(advanced(target('sword', { sharpness: 5 }), books), settings()))).toBe(13)
    const withGoal = bruteForceSolve(advanced(target('sword', { sharpness: 5 }), books, { goal: { looting: 3 } }), settings())
    expect(totalOf(withGoal)).toBe(6)
    expect(withGoal.best?.levels.usedInputs).toEqual([0, 2])
  })

  it('merges Efficiency III x2 and IV into V (pickaxe + Unbreaking III, Mending = Java [26, 9, 322, 7] / Bedrock [19, 7, 209, 7])', () => {
    const problem = advanced(target('pickaxe'), [book({ efficiency: 3 }, 2), book({ efficiency: 4 }), book({ unbreaking: 3 }), book({ mending: 1 })])
    for (const [edition, expected] of [['java', [26, 9, 322, 7]], ['bedrock', [19, 7, 209, 7]]] as const) {
      const result = bruteForceSolve(problem, settings({ edition }))
      expect(head4(result)).toEqual(expected)
      expect(result.best?.levels.final.enchantments.efficiency).toBe(5)
      expect(maximalSets(result)).toEqual([{ efficiency: 5, mending: 1, unbreaking: 3 }])
      expect(result.reachesAllReachable).toBe(true)
    }
  })

  it('would stop at Efficiency IV without the maximal-result rule (Java 24 / Bedrock 18)', () => {
    // A goal turns the maximal-result rule off; useOnlyNeeded is off so that every input is still used
    const problem = advanced(target('pickaxe'), [book({ efficiency: 3 }, 2), book({ efficiency: 4 }), book({ unbreaking: 3 }), book({ mending: 1 })], {
      goal: { efficiency: 4 },
      useOnlyNeeded: false,
    })
    expect(totalOf(bruteForceSolve(problem, settings()))).toBe(24)
    expect(totalOf(bruteForceSolve(problem, settings({ edition: 'bedrock' })))).toBe(18)
  })

  it('finds [42, 12, 570, 7] for a mace + Wind Burst I x4, Density V, Unbreaking III, Mending, with or without a goal', () => {
    const problem = simple('mace', [
      { id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] },
      { id: 'density', level: 5 },
      { id: 'unbreaking', level: 3 },
      { id: 'mending', level: 1 },
    ])
    expect(head4(bruteForceSolve(problem, settings()))).toEqual([42, 12, 570, 7])
    const noGoal = advanced(target('mace'), [book({ wind_burst: 1 }, 4), book({ density: 5 }), book({ unbreaking: 3 }), book({ mending: 1 })], { useOnlyNeeded: false })
    const result = bruteForceSolve(noGoal, settings())
    expect(totalOf(result)).toBe(42)
    expect(result.best?.levels.final.enchantments.wind_burst).toBe(3)
  })

  it('reports Unbreaking III as out of reach from Unbreaking I x3; x4 reaches it (Java 13 / Bedrock 9)', () => {
    const three = simple('boots', [{ id: 'unbreaking', level: 3, sources: [{ level: 1, count: 3 }] }])
    const result = bruteForceSolve(three, settings())
    expect(result.status).toBe('infeasible')
    expect(result.best).toBeNull()
    expect(result.reachable).toEqual({ unbreaking: 2 })
    const four = simple('boots', [{ id: 'unbreaking', level: 3, sources: [{ level: 1, count: 4 }] }])
    expect(totalOf(bruteForceSolve(four, settings()))).toBe(13)
    expect(totalOf(bruteForceSolve(four, settings({ edition: 'bedrock' })))).toBe(9)
  })

  it('uses a Smite I book to block Sharpness V when that is cheaper (Java [9, 8, 119, 3] / Bedrock [8, 7, 98, 3]); keeping it costs 11', () => {
    const books = [book({ smite: 1 }), book({ sharpness: 5, looting: 3 })]
    for (const [edition, expected] of [['java', [9, 8, 119, 3]], ['bedrock', [8, 7, 98, 3]]] as const) {
      const result = bruteForceSolve(advanced(target('sword'), books, { goal: { looting: 3 } }), settings({ edition }))
      expect(head4(result)).toEqual(expected)
      expect(result.best?.levels.usedInputs).toEqual([0, 1, 2])
      expect(result.best?.levels.final.enchantments.sharpness).toBeUndefined()
      const keep = bruteForceSolve(advanced(target('sword'), books, { goal: { looting: 3, sharpness: 5 } }), settings({ edition }))
      expect(keep.best?.levels.planKeys).toMatchObject({ totalLevels: 11, maxStepLevels: 11 })
    }
  })

  it('uses Frost Walker I to block Depth Strider III (boots + book{Depth Strider III, Feather Falling IV}, goal {Feather Falling IV} = Java 8, not 10)', () => {
    const problem = advanced(target('boots'), [book({ frost_walker: 1 }), book({ depth_strider: 3, feather_falling: 4 })], { goal: { feather_falling: 4 } })
    expect(totalOf(bruteForceSolve(problem, settings()))).toBe(8)
  })

  it('refuses a step over the cap (boots with 5 anvil uses + Thorns III = 43) but accepts Mending for 33', () => {
    const thorns = advanced(target('boots', {}, 5), [book({ thorns: 3 })], { useOnlyNeeded: false })
    expect(bruteForceSolve(thorns, settings()).status).toBe('infeasible')
    expect(totalOf(bruteForceSolve(thorns, settings({ levelCap: null })))).toBe(43)
    expect(totalOf(bruteForceSolve(thorns, settings(), { levelCapOverride: 43 }))).toBe(43)
    expect(bruteForceSolve(thorns, settings(), { levelCapOverride: 42 }).status).toBe('infeasible')
    expect(totalOf(bruteForceSolve(advanced(target('boots', {}, 5), [book({ mending: 1 })], { useOnlyNeeded: false }), settings()))).toBe(33)
  })

  it('reaches Unbreaking III from I, II, II (Java [6, 4, 56, 3] / Bedrock [4, 2, 32, 3])', () => {
    const problem = advanced(target('boots'), [book({ unbreaking: 1 }), book({ unbreaking: 2 }, 2)], { goal: { unbreaking: 3 } })
    expect(head4(bruteForceSolve(problem, settings()))).toEqual([6, 4, 56, 3])
    expect(head4(bruteForceSolve(problem, settings({ edition: 'bedrock' })))).toEqual([4, 2, 32, 3])
  })

  it('reaches Unbreaking III from I x3 and II (Java [9, 5, 87, 3] / Bedrock [6, 3, 50, 3])', () => {
    const problem = advanced(target('boots'), [book({ unbreaking: 1 }, 3), book({ unbreaking: 2 })], { goal: { unbreaking: 3 } })
    expect(head4(bruteForceSolve(problem, settings()))).toEqual([9, 5, 87, 3])
    expect(head4(bruteForceSolve(problem, settings({ edition: 'bedrock' })))).toEqual([6, 3, 50, 3])
  })

  it('reaches Unbreaking III from I x4 without a goal (Java [13, 7, 141, 7] / Bedrock [9, 5, 85, 7])', () => {
    const problem = advanced(target('boots'), [book({ unbreaking: 1 }, 4)], { useOnlyNeeded: false })
    for (const [edition, expected] of [['java', [13, 7, 141, 7]], ['bedrock', [9, 5, 85, 7]]] as const) {
      const result = bruteForceSolve(problem, settings({ edition }))
      expect(head4(result)).toEqual(expected)
      expect(maximalSets(result)).toEqual([{ unbreaking: 3 }])
    }
  })

  it('reports two maximal results when two enchantments cannot both reach III (Java [14, 7, 158, 3] / Bedrock [8, 4, 74, 3])', () => {
    const books = [book({ unbreaking: 1, feather_falling: 1 }), book({ unbreaking: 1, feather_falling: 2 }), book({ unbreaking: 2, feather_falling: 1 })]
    const problem = advanced(target('boots'), books, { useOnlyNeeded: false })
    for (const [edition, expected] of [['java', [14, 7, 158, 3]], ['bedrock', [8, 4, 74, 3]]] as const) {
      for (const levelCap of [39, null] as const) {
        const result = bruteForceSolve(problem, settings({ edition, levelCap }))
        expect(head4(result)).toEqual(expected)
        expect(result.reachesAllReachable).toBe(false)
        expect(result.reachable).toEqual({ feather_falling: 3, unbreaking: 3 })
        const sets = maximalSets(result).map((levels) => JSON.stringify(levels)).sort()
        expect(sets).toEqual([JSON.stringify({ feather_falling: 2, unbreaking: 3 }), JSON.stringify({ feather_falling: 3, unbreaking: 2 })].sort())
        // Both maximal results have the same key, so the search order decides which one is chosen
        const [first, second] = result.maximal ?? []
        expect(first.best.levels.keys).toEqual(second.best.levels.keys)
      }
    }
    const both = advanced(target('boots'), books, { goal: { unbreaking: 3, feather_falling: 3 } })
    expect(bruteForceSolve(both, settings({ levelCap: null })).status).toBe('infeasible')
  })

  it('merges the 7 boot books into one for [49, 12, 793, 15] in both editions, and 6 sword books for [31, 10, 435, 7]', () => {
    for (const edition of ['java', 'bedrock'] as const) {
      expect(head4(bruteForceSolve(advanced(null, BOOTS_BOOKS, { useOnlyNeeded: false }), settings({ edition })))).toEqual([49, 12, 793, 15])
    }
    const swordBooks = [book({ sharpness: 5 }), book({ looting: 3 }), book({ unbreaking: 3 }), book({ mending: 1 }), book({ fire_aspect: 2 }), book({ sweeping_edge: 3 })]
    expect(head4(bruteForceSolve(advanced(null, swordBooks, { useOnlyNeeded: false }), settings()))).toEqual([31, 10, 435, 7])
  })

  it('renames boots with 6 anvil uses in one capped Java step ([39, 39, 2727, 63]), which Bedrock refuses as too expensive', () => {
    const problem = advanced(target('boots', { unbreaking: 3 }, 6), [], { goal: { unbreaking: 3 } })
    expect(bruteForceSolve(problem, settings({ edition: 'bedrock', rename: true })).status).toBe('infeasible')
    const java = bruteForceSolve(problem, settings({ rename: true }))
    expect(java.keys).toEqual([39, 39, 2727, 63, 1])
    expect(java.best?.levels.tree).toEqual({ t: 'leaf', input: 0, preRename: true })
    expect(java.best?.levels.stepCosts).toEqual([39])
  })

  it('reports Sharpness V and Smite V as two maximal results (Java [19, 9, 245, 3] / Bedrock [18, 8, 222, 3])', () => {
    const problem = advanced(target('sword'), [book({ sharpness: 5 }), book({ smite: 5 }), book({ looting: 3 })], { useOnlyNeeded: false })
    for (const [edition, expected] of [['java', [19, 9, 245, 3]], ['bedrock', [18, 8, 222, 3]]] as const) {
      const result = bruteForceSolve(problem, settings({ edition }))
      expect(head4(result)).toEqual(expected)
      const final = result.best?.levels.final.enchantments ?? {}
      expect(final.looting).toBe(3)
      expect([final.sharpness, final.smite].filter((level) => level === 5)).toHaveLength(1)
      expect(maximalSets(result).map((levels) => JSON.stringify(levels)).sort())
        .toEqual([JSON.stringify({ looting: 3, sharpness: 5 }), JSON.stringify({ looting: 3, smite: 5 })].sort())
      const [first, second] = result.maximal ?? []
      expect(first.best.levels.planKeys.totalLevels).toBe(second.best.levels.planKeys.totalLevels)
    }
  })
})

describe('tree-table reference values rebuilt from real books (target with no anvil uses)', () => {
  it.each<[string, ItemTypeId, EnchantLevels[], number]>([
    ['4, 3 -> 8', 'boots', [{ thorns: 1 }, { unbreaking: 3 }], 8],
    ['12, 1 -> 14', 'boots', [{ thorns: 3 }, { unbreaking: 1 }], 14],
    ['12, 6, 4 -> 26', 'boots', [{ thorns: 3 }, { depth_strider: 3 }, { protection: 4 }], 26],
    ['12, 12, 6, 4 -> 43', 'boots', [{ soul_speed: 3 }, { thorns: 3 }, { depth_strider: 3 }, { protection: 4 }], 43],
    ['6, 6, 3, 2 -> 24', 'helmet', [{ respiration: 3 }, { blast_protection: 3 }, { unbreaking: 3 }, { aqua_affinity: 1 }], 24],
    ['12, 12, 6, 4, 4 -> 52', 'boots', [{ soul_speed: 3 }, { thorns: 3 }, { depth_strider: 3 }, { protection: 4 }, { feather_falling: 4 }], 52],
    ['12, 12, 6, 4, 4, 3 -> 61', 'boots', [{ soul_speed: 3 }, { thorns: 3 }, { depth_strider: 3 }, { protection: 4 }, { feather_falling: 4 }, { unbreaking: 3 }], 61],
  ])('weights %s', (_name, itemType, books, optimum) => {
    const problem = advanced(target(itemType), books.map((enchantments) => book(enchantments)), { useOnlyNeeded: false })
    expect(totalOf(bruteForceSolve(problem, settings({ levelCap: null })))).toBe(optimum)
  })
})

describe('hand-computed small problems', () => {
  it('breaks a tie on total levels by the most expensive step (sword + Sharpness V + Unbreaking III = 9, max 5)', () => {
    // sword + Sharpness (5), then Unbreaking (1 + 3): 9, max 5. sword + Unbreaking (3), then Sharpness (1 + 5): 9, max 6.
    // Merging the books first costs 12 or more
    const result = bruteForceSolve(advanced(target('sword'), [book({ sharpness: 5 }), book({ unbreaking: 3 })], { useOnlyNeeded: false }), settings())
    expect(result.keys).toEqual([9, 5, xpForLevels(5) + xpForLevels(4), 3, 3])
    expect(result.best?.levels.stepCosts).toEqual([5, 4])
    expect(result.best?.levels.tree).toEqual({
      t: 'combine',
      left: { t: 'combine', left: { t: 'leaf', input: 0, preRename: false }, right: { t: 'leaf', input: 1, preRename: false }, rename: false },
      right: { t: 'leaf', input: 2, preRename: false },
      rename: false,
    })
  })

  it('renames a lone target in one rename-only step costing the prior work penalty + 1 (boots with 2 anvil uses: 4)', () => {
    const result = bruteForceSolve(advanced(target('boots', {}, 2), [], { useOnlyNeeded: false }), settings({ rename: true }))
    expect(result.keys).toEqual([4, 4, 40, 3, 1])
    expect(result.best?.levels.final.named).toBe(true)
  })

  it('returns a plan without steps for a lone target without rename', () => {
    const result = bruteForceSolve(advanced(target('boots', { unbreaking: 3 }, 1), [], { useOnlyNeeded: false }), settings())
    expect(result.keys).toEqual([0, 0, 0, 1, 1])
    expect(result.best?.levels.stepCosts).toEqual([])
    expect(maximalSets(result)).toEqual([{ unbreaking: 3 }])
  })

  it('combines nothing when the target already meets the goal', () => {
    const result = bruteForceSolve(advanced(target('boots', { unbreaking: 3 }), [book({ mending: 1 })], { goal: { unbreaking: 3 } }), settings())
    expect(result.keys).toEqual([0, 0, 0, 0, 1])
    expect(result.best?.levels.usedInputs).toEqual([0])
  })

  it('combines nothing when a single book meets the goal', () => {
    expect(bruteForceSolve(simple('enchanted_book', [{ id: 'sharpness', level: 5 }]), settings()).keys).toEqual([0, 0, 0, 0, 1])
  })

  it('renames the base book before its first use when merging books', () => {
    // Rename book A (Sharpness V) alone (1), then add book B (Unbreaking III) (3): 4. Renaming during the merge also totals 4,
    // but its most expensive step is 4
    const result = bruteForceSolve(advanced(null, [book({ sharpness: 5 }), book({ unbreaking: 3 })], { useOnlyNeeded: false }), settings({ rename: true }))
    expect(result.keys).toEqual([4, 3, xpForLevels(1) + xpForLevels(3), 1, 2])
    expect(result.best?.levels.final.named).toBe(true)
    expect(result.best?.levels.final.kind).toBe('book')
  })

  it('charges item multipliers for a spare item of the same type (sword + sword{Sharpness V, Looting III} = 17)', () => {
    const result = bruteForceSolve(advanced(target('sword'), [], { extraItems: [spare({ sharpness: 5, looting: 3 })], useOnlyNeeded: false }), settings())
    expect(result.keys).toEqual([17, 17, xpForLevels(17), 1, 2])
  })

  it('puts a book on an unenchanted spare item before sacrificing it', () => {
    // target + spare is refused as having no effect, with or without a rename. spare + book (5), then target + spare (1 + 5 = 6): 11
    const problem = advanced(target('sword'), [book({ sharpness: 5 })], { extraItems: [spare({})], useOnlyNeeded: false })
    const result = bruteForceSolve(problem, settings())
    expect(result.keys).toEqual([11, 6, xpForLevels(5) + xpForLevels(6), 3, 3])
    expect(result.best?.levels.tree).toEqual({
      t: 'combine',
      left: { t: 'leaf', input: 0, preRename: false },
      right: { t: 'combine', left: { t: 'leaf', input: 1, preRename: false }, right: { t: 'leaf', input: 2, preRename: false }, rename: false },
      rename: false,
    })
    // The spare alone cannot be used up
    const alone = advanced(target('sword'), [], { extraItems: [spare({})], useOnlyNeeded: false })
    expect(bruteForceSolve(alone, settings()).status).toBe('infeasible')
    expect(bruteForceSolve(alone, settings({ rename: true })).status).toBe('infeasible')
  })

  it('charges item multipliers for a spare item that already took a book', () => {
    // target + book (5), then target + spare (1 + Unbreaking I * item multiplier 2 = 3): 8, max 5
    // target + spare (2), then target + book (1 + 5 = 6): 8, max 6
    // spare + book (5), then target + spare (1 + Sharpness 5 * 1 + Unbreaking 1 * 2 = 8): 13. book + spare is refused (item onto book)
    const problem = advanced(target('sword'), [book({ sharpness: 5 })], { extraItems: [spare({ unbreaking: 1 })], useOnlyNeeded: false })
    const result = bruteForceSolve(problem, settings())
    expect(result.keys).toEqual([8, 5, xpForLevels(5) + xpForLevels(3), 3, 3])
    expect(result.best?.xp.keys).toEqual([xpForLevels(5) + xpForLevels(3), 8, 5, 3, 3])
  })

  it('puts Curse of Binding on a carved pumpkin, which has no durability (4)', () => {
    expect(bruteForceSolve(simple('carved_pumpkin', [{ id: 'binding_curse', level: 1 }]), settings()).keys).toEqual([4, 4, 40, 1, 2])
  })

  it('cannot use every input in Bedrock when the last step would change no level, but meets the goal without a step', () => {
    const useAll = advanced(target('pickaxe', { efficiency: 5 }), [book({ efficiency: 5 })], { useOnlyNeeded: false })
    expect(bruteForceSolve(useAll, settings()).keys).toEqual([5, 5, 55, 1, 2])
    expect(bruteForceSolve(useAll, settings({ edition: 'bedrock' })).status).toBe('infeasible')
    const goal = advanced(target('pickaxe', { efficiency: 5 }), [book({ efficiency: 5 })], { goal: { efficiency: 5 } })
    expect(bruteForceSolve(goal, settings({ edition: 'bedrock' })).keys).toEqual([0, 0, 0, 0, 1])
  })

  it('reports an inapplicable goal or conflicting goals as infeasible', () => {
    expect(bruteForceSolve(simple('pickaxe', [{ id: 'sharpness', level: 1 }]), settings()).status).toBe('infeasible')
    expect(bruteForceSolve(simple('sword', [{ id: 'sharpness', level: 1 }, { id: 'smite', level: 1 }]), settings()).status).toBe('infeasible')
  })

  it('counts only the inputs the plan uses in the last key (one of two identical books)', () => {
    // Either of the two Unbreaking III books meets the goal (using both costs 3 + 4 = 7)
    const result = bruteForceSolve(advanced(target('boots'), [book({ unbreaking: 3 }, 2)], { goal: { unbreaking: 3 } }), settings())
    expect(result.keys).toEqual([3, 3, xpForLevels(3), 1, 2])
    expect(result.best?.levels.usedInputs).toHaveLength(2)
  })

  it('reports the normalized inputs and the eligible enchantments', () => {
    const result = bruteForceSolve(simple('sword', [{ id: 'sharpness', level: 2, sources: [{ level: 1, count: 2 }] }]), settings())
    expect(result.problem.inputs).toEqual([
      { kind: 'item', itemType: 'sword', enchantments: {}, anvilUses: 0 },
      { kind: 'book', itemType: null, enchantments: { sharpness: 1 }, anvilUses: 0 },
      { kind: 'book', itemType: null, enchantments: { sharpness: 1 }, anvilUses: 0 },
    ])
    expect(result.problem.goal).toEqual({ sharpness: 2 })
    expect(result.reachable).toEqual({ sharpness: 2 })
    expect(result.eligible).toContain('sharpness')
    expect(result.eligible).not.toContain('efficiency')
    const withSmite = bruteForceSolve(advanced(target('sword', { smite: 1 }), [book({ looting: 1 })]), settings())
    expect(withSmite.eligible).not.toContain('sharpness')
    expect(withSmite.eligible).toContain('looting')
  })

  it('returns the same result twice (deterministic enumeration)', () => {
    const problem = advanced(target('sword'), [book({ sharpness: 5 }), book({ smite: 5 }), book({ looting: 3 })], { useOnlyNeeded: false })
    expect(bruteForceSolve(problem, settings())).toEqual(bruteForceSolve(problem, settings()))
  })
})

describe('contract checks', () => {
  it.each<[string, Problem]>([
    ['a self-conflicting book', advanced(target('sword'), [book({ sharpness: 5, smite: 5 })])],
    ['an empty book', advanced(target('sword'), [book({})])],
    ['a level above the maximum', advanced(target('sword'), [book({ sharpness: 6 })])],
    ['an inapplicable enchantment on the target', advanced(target('sword', { efficiency: 1 }), [book({ sharpness: 1 })])],
    ['extra items without a target', advanced(null, [book({ sharpness: 1 })], { extraItems: [spare({})] })],
    ['extra items of a type without durability', advanced(target('carved_pumpkin'), [book({ binding_curse: 1 })], { extraItems: [spare({})] })],
    ['an enchantment that is not in the edition', advanced(target('sword'), [book({ sweeping_edge: 1 })])],
    ['a duplicate simple request', simple('sword', [{ id: 'sharpness', level: 1 }, { id: 'sharpness', level: 2 }])],
  ])('throws for %s', (_name, problem) => {
    expect(() => bruteForceSolve(problem, settings({ edition: 'bedrock' }))).toThrow(/oracle/)
  })

  it('refuses more inputs than it can enumerate', () => {
    expect(() => bruteForceSolve(advanced(target('boots'), [book({ unbreaking: 1 }, 8)]), settings())).toThrow(/more than the oracle can enumerate/)
  })

  it('accepts conflicting goal enchantments (a failure reason, not a validation issue)', () => {
    expect(() => bruteForceSolve(advanced(target('sword'), [book({ sharpness: 1 })], { goal: { sharpness: 1, smite: 1 } }), settings())).not.toThrow()
  })
})

// Literal enumeration

/** A full binary tree; null is a leaf. */
type Shape = { readonly left: Shape; readonly right: Shape } | null

const SHAPES = new Map<number, readonly Shape[]>([[1, [null]]])
function shapesWith(leaves: number): readonly Shape[] {
  const cached = SHAPES.get(leaves)
  if (cached !== undefined) return cached
  const shapes: Shape[] = []
  for (let k = 1; k < leaves; k++) {
    for (const left of shapesWith(k)) for (const right of shapesWith(leaves - k)) shapes.push({ left, right })
  }
  SHAPES.set(leaves, shapes)
  return shapes
}

function permutations(items: readonly number[]): number[][] {
  if (items.length <= 1) return [[...items]]
  return items.flatMap((first, index) => permutations(items.filter((_, i) => i !== index)).map((rest) => [first, ...rest]))
}

function leftSpineLength(shape: Shape): number {
  let length = 0
  for (let node = shape; node !== null; node = node.left) length++
  return length
}

interface LiteralResult {
  readonly best: { readonly [O in Objective]: KeyVector } | null
  /** Sorted JSON of each maximal final enchantment set; null with a goal. */
  readonly maximal: readonly string[] | null
}

/**
 * Every subset * shape * leaf order (target leftmost) * rename option (none, a rename-only step on the leftmost leaf, or +1
 * on one step of the left spine), each plan replayed from scratch.
 */
function literalSolve(problem: Problem, s: Settings): LiteralResult {
  const np = oracleNormalize(problem)
  const table = createRuleTable(s.edition, [...np.inputs.flatMap((input) => presentIds(input.enchantments)), ...presentIds(np.goal ?? {})])
  const leaves: SimObject[] = np.inputs.map((input) => ({
    kind: input.kind, itemType: input.itemType, levels: levelsToVector(table, input.enchantments), uses: input.anvilUses, named: false,
  }))
  const n = np.inputs.length
  const all = Array.from({ length: n }, (_, i) => i)
  const subsets = np.useOnlyNeeded
    ? Array.from({ length: (1 << n) - 1 }, (_, i) => all.filter((index) => ((i + 1) & (1 << index)) !== 0))
      .filter((subset) => np.targetIndex === null || subset.includes(np.targetIndex))
    : [all]
  const goal = np.goal === null ? null : levelsToVector(table, np.goal)

  const plans: { keys: { [O in Objective]: KeyVector }; vector: string }[] = []
  for (const subset of subsets) {
    for (const shape of shapesWith(subset.length)) {
      const spine = leftSpineLength(shape)
      const renameOptions: Array<'none' | 'pre' | number> = s.rename ? ['pre', ...Array.from({ length: spine }, (_, i) => i)] : ['none']
      for (const order of permutations(subset)) {
        if (np.targetIndex !== null && order[0] !== np.targetIndex) continue
        for (const renameAt of renameOptions) {
          const costs: number[] = []
          let next = 0
          const walk = (node: Shape, spineIndex: number | null): SimObject | null => {
            if (node === null) {
              const leaf = leaves[order[next++]]
              if (renameAt !== 'pre' || spineIndex === null) return leaf
              const renamed = simRenameOnly(table, leaf, s.levelCap)
              if (!renamed.ok) return null
              costs.push(renamed.cost)
              return renamed.result
            }
            const left = walk(node.left, spineIndex === null ? null : spineIndex + 1)
            if (left === null) return null
            const right = walk(node.right, null)
            if (right === null) return null
            const outcome = simCombine(table, left, right, s.levelCap, renameAt === spineIndex)
            if (!outcome.ok) return null
            costs.push(outcome.cost)
            return outcome.result
          }
          const final = walk(shape, 0)
          if (final === null) continue
          if (final.kind !== (np.targetIndex === null ? 'book' : 'item') || final.named !== s.rename) continue
          if (goal !== null && !goal.every((level, position) => final.levels[position] >= level)) continue
          const planKeys = {
            totalLevels: costs.reduce((sum, cost) => sum + cost, 0),
            maxStepLevels: costs.reduce((max, cost) => Math.max(max, cost), 0),
            xpPoints: costs.reduce((sum, cost) => sum + xpForLevels(cost), 0),
            finalPriorWorkPenalty: priorWorkPenalty(final.uses),
            inputsUsed: subset.length,
          }
          const keys = Object.fromEntries(OBJECTIVES.map((objective) =>
            [objective, ORACLE_KEY_ORDER[objective].map((name) => planKeys[name]) as unknown as KeyVector])) as { [O in Objective]: KeyVector }
          plans.push({ keys, vector: JSON.stringify(vectorToLevels(table, final.levels)) })
        }
      }
    }
  }

  let qualifying = plans
  let maximal: string[] | null = null
  if (goal === null) {
    const vectors = [...new Set(plans.map((plan) => plan.vector))]
    const parsed = new Map(vectors.map((vector) => [vector, JSON.parse(vector) as EnchantLevels]))
    const ids = [...new Set(vectors.flatMap((vector) => presentIds(parsed.get(vector)!)))] as EnchantmentId[]
    const dominates = (a: EnchantLevels, b: EnchantLevels): boolean =>
      ids.every((id) => (a[id] ?? 0) >= (b[id] ?? 0)) && ids.some((id) => (a[id] ?? 0) > (b[id] ?? 0))
    maximal = vectors.filter((vector) => !vectors.some((other) => other !== vector && dominates(parsed.get(other)!, parsed.get(vector)!))).sort()
    qualifying = plans.filter((plan) => maximal!.includes(plan.vector))
  }
  if (qualifying.length === 0) return { best: null, maximal }
  const bestFor = (objective: Objective): KeyVector =>
    qualifying.map((plan) => plan.keys[objective]).reduce((best, keys) => (compareKeys(keys, best) < 0 ? keys : best))
  return { best: { levels: bestFor('levels'), xp: bestFor('xp'), finalPwp: bestFor('finalPwp') }, maximal }
}

describe('memoized enumeration against the literal enumeration', () => {
  it('reproduces the Sharpness/Smite example with the literal enumeration', () => {
    const literal = literalSolve(advanced(target('sword'), [book({ sharpness: 5 }), book({ smite: 5 }), book({ looting: 3 })], { useOnlyNeeded: false }), settings())
    expect(literal.best?.levels.slice(0, 4)).toEqual([19, 9, 245, 3])
    expect(literal.maximal).toHaveLength(2)
  })

  it.each(['java', 'bedrock'] as const)('%s: agrees on 150 random problems with at most 5 inputs', (edition) => {
    const cases = sampleOracleCases(150, edition === 'java' ? 11 : 12, { editions: [edition], maxInputs: 5 })
    let feasible = 0
    for (const { problem, settings: s } of cases) {
      const oracle = bruteForceSolve(problem, s)
      const literal = literalSolve(problem, s)
      const context = JSON.stringify({ problem, settings: s })
      expect(oracle.best === null ? null : OBJECTIVES.map((objective) => oracle.best![objective].keys), context)
        .toEqual(literal.best === null ? null : OBJECTIVES.map((objective) => literal.best![objective]))
      expect(oracle.maximal === null ? null : oracle.maximal.map((entry) => JSON.stringify(entry.enchantments)).sort(), context).toEqual(literal.maximal)
      if (oracle.status === 'ok') feasible++
    }
    // Covers both feasible and infeasible problems
    expect(feasible).toBeGreaterThan(50)
    expect(feasible).toBeLessThan(150)
  })
})
