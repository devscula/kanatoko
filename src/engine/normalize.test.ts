import { applicableEnchantments, enchantmentsInEdition } from '../data/gameData.ts'
import { groupInputs, normalizeProblem, reachableLevel } from './normalize.ts'
import type { AdvancedProblem, BookInput, EnchantLevels, Settings, SimpleProblem } from './types.ts'

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })
const books = (...levels: EnchantLevels[]): BookInput[] => levels.map((enchantments) => ({ enchantments, anvilUses: 0 }))

describe('reachableLevel', () => {
  it.each<[string, number, number, number[]]>([
    ['I x3', 3, 2, [1, 1, 1]],
    ['I x4', 3, 3, [1, 1, 1, 1]],
    ['I, II, II', 3, 3, [1, 2, 2]],
    ['I x3, II', 3, 3, [1, 1, 1, 2]],
    ['I, II', 3, 2, [1, 2]],
    ['III, III (clamped)', 3, 3, [3, 3]],
    ['IV, IV (Efficiency)', 5, 5, [4, 4]],
    ['III, III, IV (Efficiency)', 5, 5, [3, 3, 4]],
    ['none', 3, 0, []],
    ['none', 1, 0, []],
  ])('%s (max %i) -> U = %i', (_label, max, expected, levels) => {
    expect(reachableLevel(levels, max)).toBe(expected)
  })

  it('handles the other boundaries', () => {
    expect(reachableLevel([1], 1)).toBe(1)
    expect(reachableLevel([1, 1], 1)).toBe(1)
    expect(reachableLevel([1, 1, 1, 1, 1, 1, 1, 1], 3)).toBe(3)   // carries stop at the max
    expect(reachableLevel([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 5)).toBe(5)   // I x16 -> V
    expect(reachableLevel([1, 1, 1, 1, 1, 1, 1, 1], 5)).toBe(4)   // I x8 -> IV
    expect(reachableLevel([1, 3], 5)).toBe(3)
    expect(reachableLevel([2, 1, 1], 5)).toBe(3)   // order does not matter
    expect(reachableLevel([7, 0, -1], 5)).toBe(5)   // above max counts as max, non-positive is ignored
  })

  it('never exceeds the max nor the highest level merged pairwise (brute force over small multisets)', () => {
    // equals the highest level found by trying every way of merging two inputs into one
    const bestByMerging = (levels: readonly number[], max: number): number => {
      if (levels.length === 0) return 0
      let best = Math.max(...levels.map((l) => Math.min(l, max)))
      for (let i = 0; i < levels.length; i++) {
        for (let j = i + 1; j < levels.length; j++) {
          const [a, b] = [levels[i], levels[j]]
          const merged = Math.min(a === b ? a + 1 : Math.max(a, b), max)
          const rest = levels.filter((_, k) => k !== i && k !== j)
          best = Math.max(best, bestByMerging([...rest, merged], max))
        }
      }
      return best
    }
    for (let max = 1; max <= 5; max++) {
      for (let mask = 0; mask < 4 ** 4; mask++) {
        // 0..3 copies of each level 1..4 (one base-4 digit per level)
        const levels: number[] = []
        for (let level = 1, rest = mask; level <= 4; level++, rest = Math.floor(rest / 4)) {
          for (let k = 0; k < rest % 4; k++) levels.push(level)
        }
        if (levels.length > 6) continue
        expect(reachableLevel(levels, max), `${levels} max ${max}`).toBe(bestByMerging(levels, max))
      }
    }
  })
})

describe('normalizeProblem: simple mode', () => {
  it('puts the fresh item first and one book per request at the wanted level', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'pickaxe', enchantments: [{ id: 'unbreaking', level: 3 }, { id: 'efficiency', level: 5 }] }
    const np = normalizeProblem(problem, java)
    expect(np.inputs).toEqual([
      { kind: 'item', itemType: 'pickaxe', enchantments: {}, anvilUses: 0, origin: { source: 'simple-item', itemType: 'pickaxe' } },
      { kind: 'book', itemType: null, enchantments: { unbreaking: 3 }, anvilUses: 0, origin: { source: 'simple-book', enchantment: 'unbreaking', level: 3, copy: 0 } },
      { kind: 'book', itemType: null, enchantments: { efficiency: 5 }, anvilUses: 0, origin: { source: 'simple-book', enchantment: 'efficiency', level: 5, copy: 0 } },
    ])
    expect(np.targetIndex).toBe(0)
    expect(np.goal).toEqual({ efficiency: 5, unbreaking: 3 })
    expect(Object.keys(np.goal ?? {})).toEqual(['efficiency', 'unbreaking'])   // data order
    expect(np.useOnlyNeeded).toBe(true)
    expect(np.reachable).toEqual({ efficiency: 5, unbreaking: 3 })
  })

  it('expands sources into copies numbered per enchantment and level (e.g. Wind Burst I x4)', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'mace',
      enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }, { level: 2, count: 1 }] }, { id: 'density', level: 5 }],
    }
    const np = normalizeProblem(problem, java)
    expect(np.inputs.map((input) => input.origin)).toEqual([
      { source: 'simple-item', itemType: 'mace' },
      { source: 'simple-book', enchantment: 'wind_burst', level: 1, copy: 0 },
      { source: 'simple-book', enchantment: 'wind_burst', level: 1, copy: 1 },
      { source: 'simple-book', enchantment: 'wind_burst', level: 1, copy: 2 },
      { source: 'simple-book', enchantment: 'wind_burst', level: 1, copy: 3 },
      { source: 'simple-book', enchantment: 'wind_burst', level: 2, copy: 0 },
      { source: 'simple-book', enchantment: 'density', level: 5, copy: 0 },
    ])
    expect(np.inputs[1].enchantments).toEqual({ wind_burst: 1 })
    expect(np.goal).toEqual({ density: 5, wind_burst: 3 })
    expect(np.reachable).toEqual({ density: 5, wind_burst: 3 })
  })

  it('an empty sources list gives no book for that request (the goal still names it)', () => {
    const np = normalizeProblem({ mode: 'simple', item: 'boots', enchantments: [{ id: 'mending', level: 1, sources: [] }] }, java)
    expect(np.inputs).toHaveLength(1)
    expect(np.goal).toEqual({ mending: 1 })
    expect(np.reachable).toEqual({})
  })

  it('enchanted_book means books only: no target, all edition enchantments are eligible', () => {
    const np = normalizeProblem({ mode: 'simple', item: 'enchanted_book', enchantments: [{ id: 'sharpness', level: 5 }, { id: 'looting', level: 3 }] }, bedrock)
    expect(np.targetIndex).toBeNull()
    expect(np.inputs.every((input) => input.kind === 'book')).toBe(true)
    expect(np.inputs).toHaveLength(2)
    expect(np.eligible).toEqual(enchantmentsInEdition('bedrock').map((e) => e.id))
    expect(np.eligible).not.toContain('sweeping_edge')
  })
})

describe('normalizeProblem: advanced mode', () => {
  it('orders target, extra items, then books with count expanded', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: { unbreaking: 1, sharpness: 3 }, anvilUses: 2 },
      extraItems: [{ enchantments: { looting: 1 }, anvilUses: 0 }, { enchantments: {}, anvilUses: 1 }],
      books: [{ enchantments: { mending: 1 }, anvilUses: 0, count: 2 }, { enchantments: { sharpness: 4 }, anvilUses: 1 }],
      goal: { sharpness: 5 },
      useOnlyNeeded: false,
    })
    const np = normalizeProblem(problem, java)
    expect(np.inputs).toEqual([
      { kind: 'item', itemType: 'sword', enchantments: { sharpness: 3, unbreaking: 1 }, anvilUses: 2, origin: { source: 'target' } },
      { kind: 'item', itemType: 'sword', enchantments: { looting: 1 }, anvilUses: 0, origin: { source: 'extra-item', index: 0 } },
      { kind: 'item', itemType: 'sword', enchantments: {}, anvilUses: 1, origin: { source: 'extra-item', index: 1 } },
      { kind: 'book', itemType: null, enchantments: { mending: 1 }, anvilUses: 0, origin: { source: 'book', index: 0, copy: 0 } },
      { kind: 'book', itemType: null, enchantments: { mending: 1 }, anvilUses: 0, origin: { source: 'book', index: 0, copy: 1 } },
      { kind: 'book', itemType: null, enchantments: { sharpness: 4 }, anvilUses: 1, origin: { source: 'book', index: 1, copy: 0 } },
    ])
    expect(Object.keys(np.inputs[0].enchantments)).toEqual(['sharpness', 'unbreaking'])
    expect(np.targetIndex).toBe(0)
    expect(np.goal).toEqual({ sharpness: 5 })
    expect(np.useOnlyNeeded).toBe(false)
  })

  it.each<[EnchantLevels | null, boolean, boolean]>([
    [{ mending: 1 }, true, true],
    [{ mending: 1 }, false, false],
    [null, true, false],
    [null, false, false],
  ])('goal %j with useOnlyNeeded %s -> useOnlyNeeded %s (always false without a goal)', (goal, useOnlyNeeded, expected) => {
    const np = normalizeProblem(advanced({ books: books({ mending: 1 }), goal, useOnlyNeeded }), java)
    expect(np.goal).toEqual(goal)
    expect(np.useOnlyNeeded).toBe(expected)
  })

  it('books only (target null): no target index, books keep their anvil uses', () => {
    const np = normalizeProblem(advanced({ books: [{ enchantments: { protection: 4 }, anvilUses: 3 }] }), java)
    expect(np.targetIndex).toBeNull()
    expect(np.inputs).toEqual([{ kind: 'book', itemType: null, enchantments: { protection: 4 }, anvilUses: 3, origin: { source: 'book', index: 0, copy: 0 } }])
  })

  it('drops undefined levels from inputs and the goal', () => {
    const np = normalizeProblem(advanced({ books: books({ mending: 1, unbreaking: undefined }), goal: { mending: 1, unbreaking: undefined } }), java)
    expect(np.inputs[0].enchantments).toEqual({ mending: 1 })
    expect(Object.keys(np.inputs[0].enchantments)).toEqual(['mending'])
    expect(np.goal).toEqual({ mending: 1 })
  })

  it('throws for extra items without a target (validation reports it first)', () => {
    expect(() => normalizeProblem(advanced({ extraItems: [{ enchantments: {}, anvilUses: 0 }] }), java)).toThrow(/validateProblem/)
  })
})

describe('normalizeProblem: reachable and eligible', () => {
  const boots = { itemType: 'boots' as const, enchantments: {}, anvilUses: 0 }

  it.each<[string, number[], number]>([
    ['Unbreaking I x3 -> II', [1, 1, 1], 2],
    ['Unbreaking I x4 -> III', [1, 1, 1, 1], 3],
    ['Unbreaking I, II, II -> III', [1, 2, 2], 3],
    ['Unbreaking I x3, II -> III', [1, 1, 1, 2], 3],
  ])('%s', (_label, levels, expected) => {
    const np = normalizeProblem(advanced({ target: boots, books: books(...levels.map((unbreaking) => ({ unbreaking }))), goal: { unbreaking: 3 } }), java)
    expect(np.reachable).toEqual({ unbreaking: expected })
  })

  it('counts the target and extra items too, over every enchantment on any input', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'boots', enchantments: { unbreaking: 2 }, anvilUses: 0 },
      extraItems: [{ enchantments: { unbreaking: 1, feather_falling: 2 }, anvilUses: 0 }],
      books: books({ unbreaking: 1 }, { feather_falling: 2, mending: 1 }),
    }), java)
    expect(np.reachable).toEqual({ feather_falling: 3, mending: 1, unbreaking: 3 })
    expect(Object.keys(np.reachable)).toEqual(['feather_falling', 'mending', 'unbreaking'])
  })

  it('each enchantment can reach III on its own, even when both cannot reach it together', () => {
    const np = normalizeProblem(advanced({
      target: boots,
      books: books({ unbreaking: 1, feather_falling: 1 }, { unbreaking: 1, feather_falling: 2 }, { unbreaking: 2, feather_falling: 1 }),
    }), java)
    expect(np.reachable).toEqual({ feather_falling: 3, unbreaking: 3 })
  })

  it('item mode: eligible = applicable to the target and compatible with what it already has', () => {
    const np = normalizeProblem(advanced({ target: { itemType: 'sword', enchantments: { smite: 5 }, anvilUses: 0 }, books: books({ sharpness: 5 }) }), java)
    const expected = applicableEnchantments('java', 'sword').filter((id) => id !== 'sharpness' && id !== 'bane_of_arthropods')
    expect(np.eligible).toEqual(expected)
    expect(np.eligible).toContain('smite')
  })

  it('item mode: eligible differs by edition (shears + Silk Touch only in Bedrock)', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'shears', enchantments: [{ id: 'silk_touch', level: 1 }] }
    expect(normalizeProblem(problem, java).eligible).not.toContain('silk_touch')
    expect(normalizeProblem(problem, bedrock).eligible).toContain('silk_touch')
  })

  it('books only: every enchantment of the edition is eligible', () => {
    expect(normalizeProblem(advanced({ books: books({ mending: 1 }) }), java).eligible).toEqual(enchantmentsInEdition('java').map((e) => e.id))
  })
})

describe('groupInputs', () => {
  it('groups identical non-target inputs by first index; the target is never grouped', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'mace', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: {}, anvilUses: 0 }, { enchantments: {}, anvilUses: 0 }],
      books: [
        { enchantments: { wind_burst: 1 }, anvilUses: 0, count: 3 },
        { enchantments: { density: 5 }, anvilUses: 0 },
        { enchantments: { wind_burst: 1 }, anvilUses: 1 },          // different uses
        { enchantments: { wind_burst: 1 }, anvilUses: 0 },          // same as book 0
        { enchantments: { wind_burst: 2 }, anvilUses: 0 },          // different level
      ],
    }), java)
    // 0 target, 1-2 extra, 3-5 book 0, 6 density, 7 wind_burst uses 1, 8 wind_burst I, 9 wind_burst II
    expect(groupInputs(np)).toEqual([
      { inputs: [1, 2] },
      { inputs: [3, 4, 5, 8] },
      { inputs: [6] },
      { inputs: [7] },
      { inputs: [9] },
    ])
  })

  it('does not group a target-like extra item with the target, nor a book with an item', () => {
    const np = normalizeProblem(advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: {}, anvilUses: 0 }],
      books: [{ enchantments: { unbreaking: 1 }, anvilUses: 0 }],
    }), java)
    expect(groupInputs(np)).toEqual([{ inputs: [1] }, { inputs: [2] }])
  })

  it('books only: every input can be grouped', () => {
    const np = normalizeProblem({ mode: 'simple', item: 'enchanted_book', enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }] }, java)
    expect(groupInputs(np)).toEqual([{ inputs: [0, 1, 2, 3] }])
  })

  it('treats the same enchantments in another key order as identical', () => {
    const np = normalizeProblem(advanced({ books: books({ unbreaking: 3, mending: 1 }, { mending: 1, unbreaking: 3 }) }), java)
    expect(groupInputs(np)).toEqual([{ inputs: [0, 1] }])
  })
})
