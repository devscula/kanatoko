// The expected values are the same as in the engine's rules.test.ts.
import type { Edition, ItemTypeId } from '../../data/types.ts'
import type { EnchantLevels } from '../../engine/types.ts'
import {
  JAVA_RENAME_ONLY_CLAMP,
  oracleCombine,
  oracleRenameOnly,
  priorWorkPenalty,
  xpForLevels,
  type OracleObject,
  type OracleOutcome,
  type OracleRefusal,
} from './anvil.ts'
import { reachableLevelOf } from './bruteForce.ts'
import { areExclusive, canApply, enchantmentIn, sacrificeMultiplier } from './gameFacts.ts'

const item = (itemType: ItemTypeId, enchantments: EnchantLevels = {}, anvilUses = 0): OracleObject =>
  ({ kind: 'item', itemType, enchantments, anvilUses, named: false })
const book = (enchantments: EnchantLevels, anvilUses = 0): OracleObject =>
  ({ kind: 'book', itemType: null, enchantments, anvilUses, named: false })

type Accepted = Extract<OracleOutcome, { ok: true }>

function combine(edition: Edition, left: OracleObject, right: OracleObject, options: { levelCap?: number | null; rename?: boolean } = {}): OracleOutcome {
  return oracleCombine(edition, left, right, { levelCap: options.levelCap === undefined ? 39 : options.levelCap, rename: options.rename ?? false })
}

function accepted(outcome: OracleOutcome): Accepted {
  if (!outcome.ok) throw new Error(`expected accepted, got refused: ${outcome.reason}`)
  return outcome
}

function expectCost(outcome: OracleOutcome, cost: number): Accepted {
  const result = accepted(outcome)
  expect(result.cost).toBe(cost)
  return result
}

function expectRefused(outcome: OracleOutcome, reason: OracleRefusal): void {
  expect(outcome.ok).toBe(false)
  if (!outcome.ok) expect(outcome.reason).toBe(reason)
}

describe('anvil rules (oracle)', () => {
  it('charges the multiplier times the level and adds one anvil use (Java: sword + book{Sharpness V} = 5)', () => {
    const result = expectCost(combine('java', item('sword'), book({ sharpness: 5 })), 5)
    expect(result.result).toEqual({ kind: 'item', itemType: 'sword', enchantments: { sharpness: 5 }, anvilUses: 1, named: false })
  })

  it('uses the book multiplier for a book sacrifice (Java: boots + book{Thorns III} = 12)', () => {
    expectCost(combine('java', item('boots'), book({ thorns: 3 })), 12)
  })

  it('uses the item multiplier for an item sacrifice (Java: sword + sword{Sharpness V, Looting III} = 17)', () => {
    expectCost(combine('java', item('sword'), item('sword', { sharpness: 5, looting: 3 })), 17)
  })

  it('adds 1 per conflict in Java only (trident{Loyalty III, Channeling} + book{Riptide III, Unbreaking III} = Java 5 / Bedrock 3)', () => {
    const left = item('trident', { loyalty: 3, channeling: 1 })
    const right = book({ riptide: 3, unbreaking: 3 })
    expect(expectCost(combine('java', left, right), 5).result.enchantments).toEqual({ channeling: 1, loyalty: 3, unbreaking: 3 })
    expect(expectCost(combine('bedrock', left, right), 3).result.enchantments).toEqual({ channeling: 1, loyalty: 3, unbreaking: 3 })
  })

  it('refuses a step where nothing transfers (Java: sword{Sharpness V} + book{Smite V})', () => {
    expectRefused(combine('java', item('sword', { sharpness: 5 }), book({ smite: 5 })), 'nothing-transfers')
  })

  it('counts a conflict with an inapplicable enchantment in Java (sword{Sharpness V} + book{Density V, Unbreaking III} = 4)', () => {
    const result = expectCost(combine('java', item('sword', { sharpness: 5 }), book({ density: 5, unbreaking: 3 })), 4)
    expect(result.result.enchantments).toEqual({ sharpness: 5, unbreaking: 3 })
  })

  it('merges two equal levels into the next level (book{Efficiency IV} + book{Efficiency IV} = Java 5 / Bedrock 1)', () => {
    for (const [edition, cost] of [['java', 5], ['bedrock', 1]] as const) {
      const result = expectCost(combine(edition, book({ efficiency: 4 }), book({ efficiency: 4 })), cost)
      expect(result.result).toEqual({ kind: 'book', itemType: null, enchantments: { efficiency: 5 }, anvilUses: 1, named: false })
    }
  })

  it('charges the final level in Java and only the levels gained in Bedrock (pickaxe{Efficiency V} + book{Efficiency III, Unbreaking I} = 6 / 1)', () => {
    const left = item('pickaxe', { efficiency: 5 })
    const right = book({ efficiency: 3, unbreaking: 1 })
    expectCost(combine('java', left, right), 6)
    expectCost(combine('bedrock', left, right), 1)
  })

  it('refuses a Bedrock step that changes no level (pickaxe{Efficiency V} + book{Efficiency V}; Java charges 5)', () => {
    const left = item('pickaxe', { efficiency: 5 })
    const right = book({ efficiency: 5 })
    expectCost(combine('java', left, right), 5)
    expectRefused(combine('bedrock', left, right), 'no-effect')
  })

  it('adds the prior work penalty of both sides (Java: boots(uses 2) + book{Mending}(uses 1) = 3 + 1 + 2, result uses 3)', () => {
    expect(expectCost(combine('java', item('boots', {}, 2), book({ mending: 1 }, 1)), 6).result.anvilUses).toBe(3)
  })

  it('refuses an item placed onto a book', () => {
    expectRefused(combine('java', book({ mending: 1 }), item('sword')), 'item-onto-book')
  })

  it('refuses two items of different types', () => {
    expectRefused(combine('java', item('sword'), item('pickaxe', { efficiency: 1 })), 'different-item-type')
  })

  it('refuses two items without durability but accepts a book on them (carved pumpkin + Curse of Binding)', () => {
    expectRefused(combine('java', item('carved_pumpkin'), item('carved_pumpkin', { binding_curse: 1 })), 'not-damageable')
    expectCost(combine('java', item('carved_pumpkin'), book({ binding_curse: 1 })), 4)
  })

  it('refuses a step above the cap and reports its cost (Java: boots(uses 5) + book{Thorns III} = 43)', () => {
    const outcome = combine('java', item('boots', {}, 5), book({ thorns: 3 }))
    expectRefused(outcome, 'too-expensive')
    expect(outcome.cost).toBe(43)
    expect(expectCost(combine('java', item('boots', {}, 5), book({ thorns: 3 }), { levelCap: null }), 43).result.anvilUses).toBe(6)
  })

  it('uses the Impaling book multiplier of each edition (trident + book{Impaling V} = Java 10 / Bedrock 5)', () => {
    expectCost(combine('java', item('trident'), book({ impaling: 5 })), 10)
    expectCost(combine('bedrock', item('trident'), book({ impaling: 5 })), 5)
  })

  it('charges an upgrade from Sharpness IV to V as Java 5 / Bedrock 1', () => {
    expectCost(combine('java', item('sword', { sharpness: 4 }), book({ sharpness: 4 })), 5)
    expectCost(combine('bedrock', item('sword', { sharpness: 4 }), book({ sharpness: 4 })), 1)
  })

  it('uses the Loyalty item multiplier of 2 in Java (trident + trident{Loyalty III} = 6)', () => {
    expectCost(combine('java', item('trident'), item('trident', { loyalty: 3 })), 6)
  })

  it('combines Sharpness and Impaling books only in Bedrock, where they are not exclusive', () => {
    expectRefused(combine('java', book({ sharpness: 5 }), book({ impaling: 5 })), 'nothing-transfers')
    expectCost(combine('bedrock', book({ sharpness: 5 }), book({ impaling: 5 })), 5)
  })

  it('refuses two unenchanted items in Java, also when renaming', () => {
    expectRefused(combine('java', item('sword'), item('sword')), 'no-effect')
    expectRefused(combine('java', item('sword'), item('sword'), { rename: true }), 'no-effect')
  })

  it('adds 1 level for a rename and marks the result as named (Java: sword + book{Sharpness V} = 6)', () => {
    expect(expectCost(combine('java', item('sword'), book({ sharpness: 5 }), { rename: true }), 6).result.named).toBe(true)
  })

  it('applies Silk Touch to shears only in Bedrock', () => {
    expectRefused(combine('java', item('shears'), book({ silk_touch: 1 })), 'nothing-transfers')
    expectCost(combine('bedrock', item('shears'), book({ silk_touch: 1 })), 4)
  })

  it('charges the kept level when the sacrifice has a lower one (Java: book{Protection IV} + book{Feather Falling IV, Protection III} = 8)', () => {
    const result = expectCost(combine('java', book({ protection: 4 }), book({ feather_falling: 4, protection: 3 })), 8)
    expect(result.result.enchantments).toEqual({ feather_falling: 4, protection: 4 })
  })

  it('adds 1 for the conflict to the cost of what transfers (Java: helmet{Protection IV} + book{Blast Protection IV, Unbreaking III} = 4)', () => {
    expectCost(combine('java', item('helmet', { protection: 4 }), book({ blast_protection: 4, unbreaking: 3 })), 4)
  })

  it('refuses when every enchantment on the sacrifice conflicts (Java: book{Riptide III} + book{Loyalty III, Channeling})', () => {
    expectRefused(combine('java', book({ riptide: 3 }), book({ loyalty: 3, channeling: 1 })), 'nothing-transfers')
  })

  it('caps a rename-only step at 39 in Java but not in Bedrock (6 anvil uses: Java 39, Bedrock 64 and refused)', () => {
    const renamed = oracleRenameOnly('java', item('boots', { unbreaking: 3 }, 6), 39)
    expect(expectCost(renamed, JAVA_RENAME_ONLY_CLAMP).result).toEqual({ kind: 'item', itemType: 'boots', enchantments: { unbreaking: 3 }, anvilUses: 6, named: true })
    const refused = oracleRenameOnly('bedrock', item('boots', { unbreaking: 3 }, 6), 39)
    expectRefused(refused, 'too-expensive')
    expect(refused.cost).toBe(64)
    expectCost(oracleRenameOnly('bedrock', item('boots', {}, 6), null), 64)
  })

  it('charges nothing for an inapplicable enchantment (pickaxe + book{Sharpness V, Efficiency I} = 1 in both editions)', () => {
    for (const edition of ['java', 'bedrock'] as const) {
      expect(expectCost(combine(edition, item('pickaxe'), book({ sharpness: 5, efficiency: 1 })), 1).result.enchantments).toEqual({ efficiency: 1 })
    }
  })
})

describe('other rule details (oracle simulator)', () => {
  it('refuses exactly above the cap: a cost equal to the cap is accepted', () => {
    expectCost(combine('java', item('boots'), book({ thorns: 3 }), { levelCap: 12 }), 12)
    expectRefused(combine('java', item('boots'), book({ thorns: 3 }), { levelCap: 11 }), 'too-expensive')
  })

  it('adds the rename in Bedrock too, and keeps the higher anvil uses + 1', () => {
    const result = expectCost(combine('bedrock', item('sword', {}, 1), book({ sharpness: 5 }, 3), { rename: true }), 1 + 7 + 5 + 1)
    expect(result.result.anvilUses).toBe(4)
    expect(result.result.named).toBe(true)
  })

  it('transfers the other enchantments past a conflict in Bedrock, without a penalty', () => {
    const result = expectCost(combine('bedrock', item('sword', { sharpness: 5 }), book({ smite: 5, looting: 3 })), 6)
    expect(result.result.enchantments).toEqual({ looting: 3, sharpness: 5 })
  })

  it('charges the final level in Java when the sacrifice has a lower level', () => {
    expectCost(combine('java', item('pickaxe', { efficiency: 5 }), book({ efficiency: 2 })), 5)
  })

  it('keeps the anvil uses on a rename-only step costing the prior work penalty + 1', () => {
    for (const edition of ['java', 'bedrock'] as const) {
      const result = expectCost(oracleRenameOnly(edition, item('sword', {}, 3), 39), 8)
      expect(result.result.anvilUses).toBe(3)
    }
  })

  it('refuses a Java rename-only step when a cap override below 39 is exceeded', () => {
    expectRefused(oracleRenameOnly('java', item('sword', {}, 6), 30), 'too-expensive')
  })
})

describe('experience points (oracle)', () => {
  it.each([[0, 0], [1, 7], [5, 55], [15, 315], [16, 352], [17, 394], [30, 1395], [31, 1507], [32, 1628], [39, 2727], [40, 2920]])('level %i costs %i points', (levels, points) => {
    expect(xpForLevels(levels)).toBe(points)
  })

  it('matches the closed-form formula up to level 300', () => {
    const closedForm = (L: number): number =>
      L <= 16 ? L * L + 6 * L : L <= 31 ? (5 * L * L - 81 * L) / 2 + 360 : (9 * L * L - 325 * L) / 2 + 2220
    for (let level = 0; level <= 300; level++) expect(xpForLevels(level)).toBe(closedForm(level))
  })

  it('computes the prior work penalty as 2^uses − 1', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(priorWorkPenalty)).toEqual([0, 1, 3, 7, 15, 31, 63, 1023])
  })
})

describe('reachable level (oracle)', () => {
  it.each([
    ['I x3', [1, 1, 1], 3, 2],
    ['I x4', [1, 1, 1, 1], 3, 3],
    ['I, II, II', [1, 2, 2], 3, 3],
    ['I x3, II', [1, 1, 1, 2], 3, 3],
    ['I, II', [1, 2], 3, 2],
    ['III, III (clamped)', [3, 3], 3, 3],
    ['IV, IV (Efficiency)', [4, 4], 5, 5],
    ['III, III, IV (Efficiency)', [3, 3, 4], 5, 5],
    ['none', [], 5, 0],
  ] as const)('%s -> %i', (_name, levels, max, expected) => {
    expect(reachableLevelOf(levels, max)).toBe(expected)
  })
})

describe('game data read by the oracle', () => {
  it('selects the multiplier by the kind of the sacrifice', () => {
    expect(sacrificeMultiplier('java', 'thorns', 'book')).toBe(4)
    expect(sacrificeMultiplier('java', 'thorns', 'item')).toBe(8)
  })

  it('reads Loyalty as item 2 / book 1 in Java and the assumed item 2 in Bedrock', () => {
    expect([sacrificeMultiplier('java', 'loyalty', 'item'), sacrificeMultiplier('java', 'loyalty', 'book')]).toEqual([2, 1])
    expect(sacrificeMultiplier('bedrock', 'loyalty', 'item')).toBe(2)
  })

  it('reads Bedrock Impaling as item 2 / book 1 and exclusive with nothing', () => {
    expect([sacrificeMultiplier('bedrock', 'impaling', 'item'), sacrificeMultiplier('bedrock', 'impaling', 'book')]).toEqual([2, 1])
    expect(areExclusive('bedrock', 'impaling', 'sharpness')).toBe(false)
    expect(areExclusive('java', 'impaling', 'sharpness')).toBe(true)
  })

  it('reads exclusivity listed without a tag: Mending-Infinity, Loyalty-Riptide, Channeling-Riptide', () => {
    for (const edition of ['java', 'bedrock'] as const) {
      expect(areExclusive(edition, 'mending', 'infinity')).toBe(true)
      expect(areExclusive(edition, 'riptide', 'loyalty')).toBe(true)
      expect(areExclusive(edition, 'channeling', 'riptide')).toBe(true)
      expect(areExclusive(edition, 'sharpness', 'sharpness')).toBe(false)
    }
  })

  it('reads applicability per edition: Silk Touch on shears only in Bedrock, Vanishing on a compass in both, no Sweeping Edge in Bedrock', () => {
    expect(canApply('java', 'shears', 'silk_touch')).toBe(false)
    expect(canApply('bedrock', 'shears', 'silk_touch')).toBe(true)
    expect(canApply('java', 'compass', 'vanishing_curse')).toBe(true)
    expect(canApply('bedrock', 'compass', 'vanishing_curse')).toBe(true)
    expect(enchantmentIn('bedrock', 'sweeping_edge')).toBeNull()
  })
})
