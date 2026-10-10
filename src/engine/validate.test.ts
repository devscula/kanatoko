import type { EnchantmentId } from '../data/types.ts'
import { LIMITS } from './limits.ts'
import type { AdvancedProblem, Settings, SimpleProblem, ValidationIssue } from './types.ts'
import { validateProblem } from './validate.ts'

const java: Settings = { edition: 'java', levelCap: 39, objective: 'levels', rename: false }
const bedrock: Settings = { ...java, edition: 'bedrock' }

const advanced = (overrides: Partial<AdvancedProblem>): AdvancedProblem =>
  ({ mode: 'advanced', target: null, extraItems: [], books: [], goal: null, useOnlyNeeded: true, ...overrides })

describe('valid problems have no issues', () => {
  it.each<[string, SimpleProblem | AdvancedProblem, Settings]>([
    ['simple, item', { mode: 'simple', item: 'boots', enchantments: [{ id: 'protection', level: 4 }, { id: 'mending', level: 1 }] }, java],
    ['simple, sources', { mode: 'simple', item: 'mace', enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 4 }] }] }, java],
    ['simple, books only', { mode: 'simple', item: 'enchanted_book', enchantments: [{ id: 'sharpness', level: 5 }] }, bedrock],
    ['simple, no enchantments (solver returns empty)', { mode: 'simple', item: 'sword', enchantments: [] }, java],
    // an inapplicable or conflicting goal is a failure reason, not a validation issue
    ['simple, inapplicable request', { mode: 'simple', item: 'pickaxe', enchantments: [{ id: 'sharpness', level: 5 }] }, java],
    ['simple, conflicting requests', { mode: 'simple', item: 'sword', enchantments: [{ id: 'sharpness', level: 5 }, { id: 'smite', level: 5 }] }, java],
    ['advanced, full', advanced({
      target: { itemType: 'trident', enchantments: { loyalty: 3, channeling: 1 }, anvilUses: 2 },
      extraItems: [{ enchantments: { impaling: 5 }, anvilUses: 0 }],
      books: [{ enchantments: { riptide: 3, unbreaking: 3 }, anvilUses: 10, count: LIMITS.maxStackCount }],
      goal: { unbreaking: 3, riptide: 3 },
      useOnlyNeeded: true,
    }), java],
    ['advanced, books only with a goal', advanced({ books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }], goal: { sharpness: 5 } }), java],
    ['advanced, Bedrock shears + Silk Touch', advanced({ target: { itemType: 'shears', enchantments: { silk_touch: 1 }, anvilUses: 0 } }), bedrock],
    ['advanced, Bedrock Sharpness with Impaling', advanced({ books: [{ enchantments: { sharpness: 5, impaling: 5 }, anvilUses: 0 }] }), bedrock],
    ['advanced, recovery compass in Bedrock', advanced({ target: { itemType: 'recovery_compass', enchantments: { vanishing_curse: 1 }, anvilUses: 0 } }), bedrock],
  ])('%s', (_label, problem, settings) => {
    expect(validateProblem(problem, settings)).toEqual([])
  })
})

describe('simple mode issues', () => {
  it('item-not-in-edition: the recovery compass in Java', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'recovery_compass', enchantments: [{ id: 'vanishing_curse', level: 1 }] }
    expect(validateProblem(problem, java)).toEqual([{ code: 'item-not-in-edition', itemType: 'recovery_compass' }])
    expect(validateProblem(problem, bedrock)).toEqual([])
  })

  it('enchantment-not-in-edition: Sweeping Edge in Bedrock', () => {
    const problem: SimpleProblem = { mode: 'simple', item: 'sword', enchantments: [{ id: 'sweeping_edge', level: 3 }] }
    expect(validateProblem(problem, bedrock)).toEqual([
      { code: 'enchantment-not-in-edition', enchantment: 'sweeping_edge', where: { part: 'simple', enchantment: 'sweeping_edge' } },
    ])
  })

  it('level-out-of-range for the wanted level and for sources', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'boots',
      enchantments: [
        { id: 'thorns', level: 4 },
        { id: 'unbreaking', level: 3, sources: [{ level: 0, count: 1 }, { level: 1.5, count: 1 }] },
      ],
    }
    expect(validateProblem(problem, java)).toEqual([
      { code: 'level-out-of-range', enchantment: 'thorns', level: 4, maxLevel: 3, where: { part: 'simple', enchantment: 'thorns' } },
      { code: 'level-out-of-range', enchantment: 'unbreaking', level: 0, maxLevel: 3, where: { part: 'simple', enchantment: 'unbreaking' } },
      { code: 'level-out-of-range', enchantment: 'unbreaking', level: 1.5, maxLevel: 3, where: { part: 'simple', enchantment: 'unbreaking' } },
    ])
  })

  it('count-out-of-range for a source stack', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'mace',
      enchantments: [{ id: 'wind_burst', level: 3, sources: [{ level: 1, count: 0 }, { level: 2, count: LIMITS.maxStackCount + 1 }] }],
    }
    const where = { part: 'simple', enchantment: 'wind_burst' } as const
    expect(validateProblem(problem, java)).toEqual([
      { code: 'count-out-of-range', value: 0, where },
      { code: 'count-out-of-range', value: 33, where },
    ])
  })

  it('duplicate-simple-enchantment is reported once per enchantment', () => {
    const problem: SimpleProblem = {
      mode: 'simple',
      item: 'boots',
      enchantments: [{ id: 'mending', level: 1 }, { id: 'unbreaking', level: 3 }, { id: 'mending', level: 1 }, { id: 'mending', level: 9 }],
    }
    expect(validateProblem(problem, java)).toEqual([{ code: 'duplicate-simple-enchantment', enchantment: 'mending' }])
  })

  it('reports unknown ids instead of throwing (values read from a URL or storage)', () => {
    const problem = { mode: 'simple', item: 'laser_sword', enchantments: [{ id: 'mega_sharpness', level: 1 }] } as unknown as SimpleProblem
    expect(validateProblem(problem, java)).toEqual([
      { code: 'item-not-in-edition', itemType: 'laser_sword' },
      { code: 'enchantment-not-in-edition', enchantment: 'mega_sharpness', where: { part: 'simple', enchantment: 'mega_sharpness' } },
    ])
  })
})

describe('advanced mode issues', () => {
  it('target-is-book', () => {
    expect(validateProblem(advanced({ target: { itemType: 'enchanted_book', enchantments: {}, anvilUses: 0 } }), java))
      .toEqual([{ code: 'target-is-book' }])
  })

  it('item-not-in-edition for the target', () => {
    expect(validateProblem(advanced({ target: { itemType: 'recovery_compass', enchantments: {}, anvilUses: 0 } }), java))
      .toEqual([{ code: 'item-not-in-edition', itemType: 'recovery_compass' }])
  })

  it('not-applicable-on-item-input on the target and on extra items (checked against the target type)', () => {
    const problem = advanced({
      target: { itemType: 'shears', enchantments: { silk_touch: 1, efficiency: 5 }, anvilUses: 0 },
      extraItems: [{ enchantments: { sharpness: 1 }, anvilUses: 0 }],
    })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'not-applicable-on-item-input', enchantment: 'silk_touch', where: { part: 'target' } },
      { code: 'not-applicable-on-item-input', enchantment: 'sharpness', where: { part: 'extraItem', index: 0 } },
    ])
  })

  it('input-self-conflict on items and books, one issue per pair in data order', () => {
    const problem = advanced({
      target: { itemType: 'trident', enchantments: { riptide: 3, loyalty: 3, channeling: 1 }, anvilUses: 0 },
      books: [{ enchantments: { smite: 5, sharpness: 5 }, anvilUses: 0 }],
    })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'input-self-conflict', a: 'channeling', b: 'riptide', where: { part: 'target' } },
      { code: 'input-self-conflict', a: 'loyalty', b: 'riptide', where: { part: 'target' } },
      { code: 'input-self-conflict', a: 'sharpness', b: 'smite', where: { part: 'book', index: 0 } },
    ])
  })

  it('self-conflict follows the edition (Sharpness + Impaling is fine in Bedrock only)', () => {
    const problem = advanced({ books: [{ enchantments: { sharpness: 5, impaling: 5 }, anvilUses: 0 }] })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'input-self-conflict', a: 'impaling', b: 'sharpness', where: { part: 'book', index: 0 } },
    ])
    expect(validateProblem(problem, bedrock)).toEqual([])
  })

  it('empty-book, also when every level is undefined', () => {
    const problem = advanced({ books: [{ enchantments: {}, anvilUses: 0 }, { enchantments: { mending: undefined }, anvilUses: 0 }] })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'empty-book', where: { part: 'book', index: 0 } },
      { code: 'empty-book', where: { part: 'book', index: 1 } },
    ])
  })

  it('anvil-uses-out-of-range on every kind of input', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: {}, anvilUses: -1 },
      extraItems: [{ enchantments: {}, anvilUses: LIMITS.maxAnvilUses + 1 }],
      books: [{ enchantments: { mending: 1 }, anvilUses: 0.5 }],
    })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'anvil-uses-out-of-range', value: -1, where: { part: 'target' } },
      { code: 'anvil-uses-out-of-range', value: 11, where: { part: 'extraItem', index: 0 } },
      { code: 'anvil-uses-out-of-range', value: 0.5, where: { part: 'book', index: 0 } },
    ])
  })

  it('count-out-of-range on a book; an omitted count is 1', () => {
    const problem = advanced({ books: [{ enchantments: { mending: 1 }, anvilUses: 0, count: 0 }, { enchantments: { mending: 1 }, anvilUses: 0 }] })
    expect(validateProblem(problem, java)).toEqual([{ code: 'count-out-of-range', value: 0, where: { part: 'book', index: 0 } }])
  })

  it('extra-items-without-target', () => {
    expect(validateProblem(advanced({ extraItems: [{ enchantments: {}, anvilUses: 0 }] }), java)).toEqual([{ code: 'extra-items-without-target' }])
  })

  it('extra-item-not-combinable for a type without durability', () => {
    const problem = advanced({
      target: { itemType: 'carved_pumpkin', enchantments: {}, anvilUses: 0 },
      extraItems: [{ enchantments: { binding_curse: 1 }, anvilUses: 0 }, { enchantments: {}, anvilUses: 0 }],
    })
    expect(validateProblem(problem, java)).toEqual([{ code: 'extra-item-not-combinable', itemType: 'carved_pumpkin' }])
  })

  it('checks the goal for the edition and the level range', () => {
    const problem = advanced({ books: [{ enchantments: { sharpness: 5 }, anvilUses: 0 }], goal: { sweeping_edge: 3, sharpness: 6, unbreaking: undefined } })
    expect(validateProblem(problem, bedrock)).toEqual([
      { code: 'level-out-of-range', enchantment: 'sharpness', level: 6, maxLevel: 5, where: { part: 'goal', enchantment: 'sharpness' } },
      { code: 'enchantment-not-in-edition', enchantment: 'sweeping_edge', where: { part: 'goal', enchantment: 'sweeping_edge' } },
    ])
  })

  it('enchantment-not-in-edition skips the other checks for that enchantment', () => {
    const problem = advanced({ target: { itemType: 'sword', enchantments: { sweeping_edge: 9, sharpness: 5 }, anvilUses: 0 } })
    expect(validateProblem(problem, bedrock)).toEqual([
      { code: 'enchantment-not-in-edition', enchantment: 'sweeping_edge', where: { part: 'target' } },
    ])
  })

  it('lists issues in input order: target, extra items, books, goal', () => {
    const problem = advanced({
      target: { itemType: 'sword', enchantments: { efficiency: 1 }, anvilUses: 0 },
      extraItems: [{ enchantments: {}, anvilUses: 99 }],
      books: [{ enchantments: {}, anvilUses: 0 }],
      goal: { sharpness: 0 },
    })
    expect(validateProblem(problem, java).map((issue) => issue.code)).toEqual([
      'not-applicable-on-item-input', 'anvil-uses-out-of-range', 'empty-book', 'level-out-of-range',
    ])
  })

  it('uses overridden limits when given (SolveOptions.limits)', () => {
    const problem = advanced({ books: [{ enchantments: { mending: 1 }, anvilUses: 3, count: 3 }] })
    expect(validateProblem(problem, java, { maxAnvilUses: 2, maxStackCount: 2 })).toEqual([
      { code: 'anvil-uses-out-of-range', value: 3, where: { part: 'book', index: 0 } },
      { code: 'count-out-of-range', value: 3, where: { part: 'book', index: 0 } },
    ])
  })

  it('does not repeat an identical issue, but keeps the same problem at different places', () => {
    const simple: SimpleProblem = {
      mode: 'simple', item: 'boots', enchantments: [{ id: 'thorns', level: 3, sources: [{ level: 7, count: 1 }, { level: 7, count: 2 }] }],
    }
    expect(validateProblem(simple, java)).toEqual([
      { code: 'level-out-of-range', enchantment: 'thorns', level: 7, maxLevel: 3, where: { part: 'simple', enchantment: 'thorns' } },
    ])
    const problem = advanced({ target: { itemType: 'boots', enchantments: { thorns: 7 }, anvilUses: 0 }, goal: { thorns: 7 } })
    expect(validateProblem(problem, java).map((issue: ValidationIssue) => issue.code)).toEqual(['level-out-of-range', 'level-out-of-range'])
  })

  it('reports unknown enchantment ids on inputs instead of throwing', () => {
    const problem = advanced({ books: [{ enchantments: { ['mega' as EnchantmentId]: 1 }, anvilUses: 0 }] })
    expect(validateProblem(problem, java)).toEqual([
      { code: 'enchantment-not-in-edition', enchantment: 'mega', where: { part: 'book', index: 0 } },
    ])
  })
})
