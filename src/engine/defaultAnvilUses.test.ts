import { describe, expect, it } from 'vitest'
import { GAME_DATA } from '../data/gameData.generated.ts'
import type { EnchantmentId } from '../data/types.ts'
import { defaultAnvilUses, lowerBoundAnvilUses } from './defaultAnvilUses.ts'
import type { EnchantLevels } from './types.ts'

describe('defaultAnvilUses', () => {
  const cases: [string, Parameters<typeof defaultAnvilUses>[1], EnchantLevels, number][] = [
    ['boots: Frost Walker II', 'boots', { frost_walker: 2 }, 1],
    ['boots: Frost Walker II, Curse of Binding', 'boots', { frost_walker: 2, binding_curse: 1 }, 1],
    ['boots: Protection IV, Unbreaking III', 'boots', { protection: 4, unbreaking: 3 }, 2],
    [
      'boots: the 7 usual max-level enchantments',
      'boots',
      { protection: 4, feather_falling: 4, soul_speed: 3, depth_strider: 3, thorns: 3, unbreaking: 3, mending: 1 },
      4,
    ],
    ['pickaxe: Efficiency IV, Unbreaking III', 'pickaxe', { efficiency: 4, unbreaking: 3 }, 2],
    ['pickaxe: Unbreaking III', 'pickaxe', { unbreaking: 3 }, 1],
    ['book: Protection III, Feather Falling II', null, { protection: 3, feather_falling: 2 }, 1],
    ['book: Efficiency III, Unbreaking II, Fortune I', null, { efficiency: 3, unbreaking: 2, fortune: 1 }, 2],
    ['book: Mending', null, { mending: 1 }, 0],
  ]
  for (const [name, item, enchantments, expected] of cases) {
    it(`${name} -> ${expected}`, () => {
      expect(defaultAnvilUses('java', item, enchantments)).toBe(expected)
    })
  }

  it('gives boots with Frost Walker II one use in Bedrock as well', () => {
    expect(defaultAnvilUses('bedrock', 'boots', { frost_walker: 2 })).toBe(1)
  })

  it('gives 0 for an item without enchantments or with curses only', () => {
    expect(defaultAnvilUses('java', 'boots', {})).toBe(0)
    expect(defaultAnvilUses('java', 'boots', { binding_curse: 1, vanishing_curse: 1 })).toBe(0)
  })

  it('ignores enchantments the item cannot have', () => {
    expect(defaultAnvilUses('java', 'boots', { sharpness: 5 })).toBe(0)
    expect(defaultAnvilUses('java', 'boots', { sharpness: 5, frost_walker: 2 })).toBe(1)
  })

  it("counts 'enchanted_book' as a book", () => {
    expect(defaultAnvilUses('java', 'enchanted_book', { protection: 3, feather_falling: 2 })).toBe(1)
  })

  it('uses a plan within the level cap of 39', () => {
    // The 7 books have an optimal plan within the cap, so the cap does not change the value.
    expect(defaultAnvilUses('java', 'boots', { protection: 4, feather_falling: 4, soul_speed: 3, depth_strider: 3, thorns: 3, unbreaking: 3, mending: 1 })).toBe(4)
  })

  it('falls back to the lower bound when the tree-table method does not apply (too many books): 25 books -> ceil(log2 25) = 5', () => {
    const ids = GAME_DATA.enchantments
      .filter((e) => !e.curse)
      .map((e) => e.id as EnchantmentId)
      .slice(0, 25)
    expect(ids).toHaveLength(25)
    const levels: EnchantLevels = Object.fromEntries(ids.map((id) => [id, 1]))
    expect(defaultAnvilUses('java', null, levels)).toBe(5)
    expect(lowerBoundAnvilUses(true, 25)).toBe(5)
    expect(lowerBoundAnvilUses(false, 7)).toBe(3)
    expect(lowerBoundAnvilUses(true, 1)).toBe(0)
  })
})
