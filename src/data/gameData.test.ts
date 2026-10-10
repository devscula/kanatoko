import enchantmentDataJson from '../../data/enchantment-data.json?raw'
import japaneseNamesJson from '../../data/japanese-names.json?raw'
import committedModule from './gameData.generated.ts?raw'
import { buildGameData, generateGameDataModule, type SourceData } from './buildGameData.ts'
import { GAME_DATA } from './gameData.generated.ts'
import {
  applicableEnchantments,
  areCompatible,
  enchantmentsInEdition,
  getEnchantment,
  getItem,
  isApplicable,
  isEnchantmentId,
  isEnchantmentInEdition,
  isItemInEdition,
  isItemTypeId,
  itemsInEdition,
  maxLevel,
  multiplier,
} from './gameData.ts'
import { ENCHANTMENT_TOOLTIP_ORDER, compareTooltipOrder, tooltipPosition } from './tooltipOrder.ts'
import type { Edition, EnchantmentId, ItemGroupId, ItemTypeId } from './types.ts'

const EDITIONS: readonly Edition[] = ['java', 'bedrock']

const ALL_ENCHANTMENT_IDS: readonly EnchantmentId[] = [
  'aqua_affinity', 'bane_of_arthropods', 'binding_curse', 'blast_protection', 'breach',
  'channeling', 'density', 'depth_strider', 'efficiency', 'feather_falling',
  'fire_aspect', 'fire_protection', 'flame', 'fortune', 'frost_walker',
  'impaling', 'infinity', 'knockback', 'looting', 'loyalty',
  'luck_of_the_sea', 'lunge', 'lure', 'mending', 'multishot',
  'piercing', 'power', 'projectile_protection', 'protection', 'punch',
  'quick_charge', 'respiration', 'riptide', 'sharpness', 'silk_touch',
  'smite', 'soul_speed', 'sweeping_edge', 'swift_sneak', 'thorns',
  'unbreaking', 'vanishing_curse', 'wind_burst',
]

const ALL_ITEM_IDS: readonly ItemTypeId[] = [
  'helmet', 'turtle_shell', 'chestplate', 'leggings', 'boots', 'elytra',
  'sword', 'spear', 'axe', 'pickaxe', 'shovel', 'hoe', 'shears',
  'bow', 'crossbow', 'trident', 'mace', 'fishing_rod', 'shield',
  'flint_and_steel', 'brush', 'carrot_on_a_stick', 'warped_fungus_on_a_stick',
  'compass', 'carved_pumpkin', 'head', 'recovery_compass', 'enchanted_book',
]

const sources = (): SourceData => ({
  enchantmentData: JSON.parse(enchantmentDataJson),
  japaneseNames: JSON.parse(japaneseNamesJson),
})

describe('generated file', () => {
  it('equals a fresh generation from the source data (run `npm run gen:data` if this fails)', () => {
    expect(committedModule).toBe(generateGameDataModule(sources()))
  })

  it('exports the same GAME_DATA as an in-memory build', () => {
    expect(GAME_DATA).toEqual(buildGameData(sources()))
  })

  it('records the game versions and the source files', () => {
    expect(GAME_DATA.version).toEqual({
      java: '26.3',
      bedrock: '26.52',
      generatedFrom: ['data/enchantment-data.json', 'data/japanese-names.json'],
    })
  })
})

describe('generator rejects source data that breaks the invariants', () => {
  type Mutable = { enchantments: Record<string, unknown>[]; items: Record<string, unknown>[] }
  type MutableNames = { enchantments: Record<string, Record<string, unknown>> }
  const mutated = (edit: (data: Mutable, names: MutableNames) => void): SourceData => {
    const s = sources()
    edit(s.enchantmentData as Mutable, s.japaneseNames as MutableNames)
    return s
  }
  const ench = (data: Mutable, id: string) => data.enchantments.find((e) => e.id === id)!
  const item = (data: Mutable, id: string) => data.items.find((i) => i.id === id)!

  it('rejects the wiki value 1/1 for Java Loyalty even when both files agree', () => {
    expect(() => buildGameData(mutated((d, names) => {
      ench(d, 'loyalty').itemMultiplier = 1
      names.enchantments.loyalty.anvil_cost = 1
    }))).toThrow(/java loyalty multipliers/)
  })
  it('rejects an anvil_cost that differs between the two files', () => {
    expect(() => buildGameData(mutated((d) => { ench(d, 'loyalty').itemMultiplier = 1 }))).toThrow(/anvil_cost differs between/)
  })
  it('rejects a null Bedrock item multiplier without an assumed value', () => {
    expect(() => buildGameData(mutated((d) => { ench(d, 'thorns').bedrockItemMultiplier = null }))).toThrow(/no assumed value/)
  })
  it('rejects Bedrock Impaling that is exclusive with Sharpness', () => {
    expect(() => buildGameData(mutated((d) => {
      ench(d, 'impaling').bedrockExclusiveWith = ['sharpness']
      ench(d, 'sharpness').bedrockExclusiveWith = [...(ench(d, 'sharpness').bedrockExclusiveWith as string[]), 'impaling']
    }))).toThrow(/bedrock impaling must not be exclusive/)
  })
  it('rejects asymmetric exclusivity', () => {
    expect(() => buildGameData(mutated((d) => { ench(d, 'mending').exclusiveWith = ['infinity', 'unbreaking'] })))
      .toThrow(/not symmetric/)
  })
  it('rejects an enchantment that excludes itself', () => {
    expect(() => buildGameData(mutated((d) => {
      ench(d, 'mending').exclusiveWith = ['infinity', 'mending']
    }))).toThrow(/exclusive with itself/)
  })
  it('rejects an applicable enchantment that does not exist in the edition', () => {
    expect(() => buildGameData(mutated((d) => {
      item(d, 'sword').bedrockEnchantments = [...(item(d, 'sword').bedrockEnchantments as string[]), 'sweeping_edge']
    }))).toThrow(/not in the edition/)
  })
  it('rejects a missing field', () => {
    expect(() => buildGameData(mutated((d) => { delete ench(d, 'power').maxLevel }))).toThrow(/maxLevel/)
  })
})

describe('counts and ids', () => {
  it('has 43 enchantments (Java 43, Bedrock 42) and 28 item types (Java 27, Bedrock 28)', () => {
    expect(GAME_DATA.enchantments).toHaveLength(43)
    expect(enchantmentsInEdition('java')).toHaveLength(43)
    expect(enchantmentsInEdition('bedrock')).toHaveLength(42)
    expect(GAME_DATA.items).toHaveLength(28)
    expect(itemsInEdition('java')).toHaveLength(27)
    expect(itemsInEdition('bedrock')).toHaveLength(28)
  })

  it('uses exactly the ids of EnchantmentId and ItemTypeId', () => {
    expect(new Set(GAME_DATA.enchantments.map((e) => e.id))).toEqual(new Set(ALL_ENCHANTMENT_IDS))
    expect(new Set(GAME_DATA.items.map((i) => i.id))).toEqual(new Set(ALL_ITEM_IDS))
  })

  it('includes Lunge and the spear (Java 1.21.11+)', () => {
    expect(getEnchantment('lunge')).toMatchObject({ maxLevel: 3, name: { ja: '突進', en: 'Lunge' } })
    expect(getItem('spear')).toMatchObject({ name: { ja: '槍', en: 'Spear' }, group: 'weapon' })
    expect(isApplicable('java', 'spear', 'lunge')).toBe(true)
    expect(isApplicable('bedrock', 'spear', 'lunge')).toBe(true)
    expect(isApplicable('java', 'sword', 'lunge')).toBe(false)
    expect(isApplicable('java', 'spear', 'sweeping_edge')).toBe(false)
  })
})

describe('corrections', () => {
  it('makes Java Loyalty item 2 / book 1', () => {
    expect(getEnchantment('loyalty').java).toMatchObject({ itemMultiplier: 2, bookMultiplier: 1, multiplierSource: 'official-data' })
  })

  it('makes Density item 2 / book 1 in both editions', () => {
    for (const edition of EDITIONS) {
      expect(getEnchantment('density')[edition]).toMatchObject({ itemMultiplier: 2, bookMultiplier: 1 })
    }
  })

  it('uses the assumed 2 for the Bedrock Loyalty item multiplier', () => {
    expect(getEnchantment('loyalty').bedrock).toMatchObject({ itemMultiplier: 2, bookMultiplier: 1, multiplierSource: 'assumption' })
    const assumed = GAME_DATA.enchantments.filter((e) => e.bedrock?.multiplierSource === 'assumption').map((e) => e.id)
    expect(assumed).toEqual(['loyalty'])
  })

  it('makes Bedrock Impaling 2/1 and exclusive with nothing, while Java keeps the damage set', () => {
    expect(getEnchantment('impaling').bedrock).toMatchObject({
      itemMultiplier: 2, bookMultiplier: 1, exclusiveWith: [], exclusiveSetTag: null,
    })
    expect(getEnchantment('impaling').java).toMatchObject({ itemMultiplier: 4, bookMultiplier: 2, exclusiveSetTag: 'damage' })
    for (const id of ['sharpness', 'smite', 'bane_of_arthropods', 'density', 'breach'] as const) {
      expect(areCompatible('bedrock', id, 'impaling')).toBe(true)
      expect(areCompatible('java', id, 'impaling')).toBe(false)
    }
  })

  it('keeps Sweeping Edge Java only and the recovery compass Bedrock only, and lets the compass take Vanishing in both', () => {
    expect(getEnchantment('sweeping_edge').bedrock).toBeNull()
    expect(getEnchantment('sweeping_edge').java).not.toBeNull()
    expect(isEnchantmentInEdition('bedrock', 'sweeping_edge')).toBe(false)
    expect(getItem('recovery_compass').java).toBeNull()
    expect(isItemInEdition('java', 'recovery_compass')).toBe(false)
    expect(applicableEnchantments('bedrock', 'recovery_compass')).toEqual(['vanishing_curse'])
    expect(applicableEnchantments('java', 'recovery_compass')).toEqual([])
    for (const edition of EDITIONS) expect(applicableEnchantments(edition, 'compass')).toEqual(['vanishing_curse'])
  })

  it('lets Bedrock shears accept Silk Touch but not Java shears', () => {
    expect(isApplicable('bedrock', 'shears', 'silk_touch')).toBe(true)
    expect(isApplicable('java', 'shears', 'silk_touch')).toBe(false)
  })

  it('uses the Bedrock ja names of breach, density, wind_burst and swift_sneak and keeps the English names', () => {
    const overrides = Object.fromEntries(
      GAME_DATA.enchantments.flatMap((e) => (e.bedrock?.nameOverride ? [[e.id, e.bedrock.nameOverride]] : [])),
    )
    expect(overrides).toEqual({
      breach: { ja: '違反', en: 'Breach' },
      density: { ja: '密度', en: 'Density' },
      swift_sneak: { ja: 'しのび足速度上昇', en: 'Swift Sneak' },
      wind_burst: { ja: '爆風', en: 'Wind Burst' },
    })
    for (const e of GAME_DATA.enchantments) expect(e.java?.nameOverride ?? null).toBeNull()
    expect(getEnchantment('breach').name).toEqual({ ja: '防具貫通', en: 'Breach' })
  })

  it('names head and recovery_compass', () => {
    expect(getItem('head').name).toEqual({ ja: 'Mobの頭', en: 'Mob Head' })
    expect(getItem('recovery_compass').name).toEqual({ ja: 'リカバリーコンパス', en: 'Recovery Compass' })
  })

  it('marks only compass, carved_pumpkin, head, recovery_compass and enchanted_book as not damageable', () => {
    const notDamageable = GAME_DATA.items.filter((i) => !i.damageable).map((i) => i.id)
    expect(new Set(notDamageable)).toEqual(new Set(['compass', 'carved_pumpkin', 'head', 'recovery_compass', 'enchanted_book']))
  })

  it('marks only compass, carved_pumpkin, head and recovery_compass as stackable', () => {
    const stackable = GAME_DATA.items.filter((i) => i.stackable).map((i) => i.id)
    expect(new Set(stackable)).toEqual(new Set(['compass', 'carved_pumpkin', 'head', 'recovery_compass']))
  })

  it('uses the official item names', () => {
    expect(getItem('trident').name).toEqual({ ja: 'トライデント', en: 'Trident' })
    expect(getItem('fishing_rod').name).toEqual({ ja: '釣竿', en: 'Fishing Rod' })
  })

  it('treats only the enchanted book as a book', () => {
    expect(GAME_DATA.items.filter((i) => i.isBook).map((i) => i.id)).toEqual(['enchanted_book'])
  })

  it('has 2 curses and 7 treasure enchantments', () => {
    expect(GAME_DATA.enchantments.filter((e) => e.curse).map((e) => e.id)).toEqual(['binding_curse', 'vanishing_curse'])
    expect(new Set(GAME_DATA.enchantments.filter((e) => e.treasure).map((e) => e.id))).toEqual(new Set([
      'binding_curse', 'vanishing_curse', 'swift_sneak', 'soul_speed', 'frost_walker', 'mending', 'wind_burst',
    ]))
  })
})

describe('exclusivity and applicability', () => {
  it.each(EDITIONS)('%s: keeps exclusivity symmetric and irreflexive', (edition) => {
    for (const e of enchantmentsInEdition(edition)) {
      const data = e[edition]!
      expect(data.exclusiveWith).not.toContain(e.id)
      for (const other of data.exclusiveWith) {
        expect(getEnchantment(other)[edition]?.exclusiveWith, `${other} ↔ ${e.id}`).toContain(e.id)
      }
    }
  })

  it.each(EDITIONS)('%s: lists only applicable ids that exist in the edition', (edition) => {
    for (const item of itemsInEdition(edition)) {
      for (const id of applicableEnchantments(edition, item.id)) {
        expect(isEnchantmentInEdition(edition, id), `${item.id} -> ${id}`).toBe(true)
      }
    }
  })

  it.each(EDITIONS)('%s: lets the enchanted book accept every enchantment of the edition', (edition) => {
    expect(applicableEnchantments(edition, 'enchanted_book')).toEqual(enchantmentsInEdition(edition).map((e) => e.id))
  })

  it('lets curse-only items accept curses only', () => {
    for (const item of GAME_DATA.items.filter((i) => i.curseOnly)) {
      for (const edition of EDITIONS) {
        for (const id of applicableEnchantments(edition, item.id)) expect(getEnchantment(id).curse).toBe(true)
      }
    }
  })

  it('sets every Java book multiplier to max(1, floor(item multiplier / 2))', () => {
    for (const e of enchantmentsInEdition('java')) {
      expect(e.java!.bookMultiplier, e.id).toBe(Math.max(1, Math.floor(e.java!.itemMultiplier / 2)))
    }
  })

  it('uses the seven 26.3 exclusive set tags and gives mending, loyalty and channeling none', () => {
    const tags = new Set(GAME_DATA.enchantments.flatMap((e) => [e.java?.exclusiveSetTag, e.bedrock?.exclusiveSetTag]))
    tags.delete(null)
    tags.delete(undefined)
    expect(tags).toEqual(new Set(['armor', 'boots', 'bow', 'crossbow', 'damage', 'mining', 'riptide']))
    for (const id of ['mending', 'loyalty', 'channeling'] as const) {
      expect(getEnchantment(id).java?.exclusiveSetTag).toBeNull()
      expect(getEnchantment(id).java?.exclusiveWith.length).toBeGreaterThan(0)
    }
  })

  // The largest number of applicable enchantments (curses included) that are pairwise compatible.
  const maxCompatible = (edition: Edition, itemType: ItemTypeId): number => {
    const ids = applicableEnchantments(edition, itemType)
    let best = 0
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const chosen = ids.filter((_, i) => mask & (1 << i))
      if (chosen.length <= best) continue
      if (chosen.every((a, i) => chosen.slice(i + 1).every((b) => areCompatible(edition, a, b)))) best = chosen.length
    }
    return best
  }

  it('allows at most 9 compatible enchantments on Java boots and 8 on the helmet, sword and spear', () => {
    expect(maxCompatible('java', 'boots')).toBe(9)
    expect(maxCompatible('java', 'helmet')).toBe(8)
    expect(maxCompatible('java', 'sword')).toBe(8)
    expect(maxCompatible('java', 'spear')).toBe(8)
  })
})

describe('picker groups', () => {
  it('groups and orders the items for the picker', () => {
    const grouped = (group: ItemGroupId) =>
      GAME_DATA.items.filter((i) => i.group === group).sort((a, b) => a.order - b.order).map((i) => i.id)
    expect(grouped('armor')).toEqual(['helmet', 'turtle_shell', 'chestplate', 'leggings', 'boots', 'elytra', 'shield'])
    expect(grouped('weapon')).toEqual(['sword', 'spear', 'mace', 'trident', 'bow', 'crossbow'])
    expect(grouped('tool')).toEqual([
      'pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'fishing_rod', 'brush', 'flint_and_steel',
      'carrot_on_a_stick', 'warped_fungus_on_a_stick',
    ])
    expect(grouped('other')).toEqual(['compass', 'recovery_compass', 'carved_pumpkin', 'head'])
    expect(grouped('book')).toEqual(['enchanted_book'])
  })

  it('numbers the items 1..n without gaps inside each group', () => {
    for (const group of ['armor', 'weapon', 'tool', 'other', 'book'] as const) {
      const orders = GAME_DATA.items.filter((i) => i.group === group).map((i) => i.order).sort((a, b) => a - b)
      expect(orders).toEqual(orders.map((_, i) => i + 1))
    }
  })

  it('uses the item id as the icon key', () => {
    for (const item of GAME_DATA.items) expect(item.icon).toBe(item.id)
  })
})

describe('lookups', () => {
  it('picks the book multiplier for a book sacrifice and the item multiplier otherwise', () => {
    expect(multiplier('java', 'thorns', 'book')).toBe(4)
    expect(multiplier('java', 'thorns', 'item')).toBe(8)
    expect(multiplier('java', 'impaling', 'book')).toBe(2)
    expect(multiplier('bedrock', 'impaling', 'book')).toBe(1)
    expect(multiplier('bedrock', 'loyalty', 'item')).toBe(2)
    expect(() => multiplier('bedrock', 'sweeping_edge', 'book')).toThrow(/does not exist in bedrock/)
  })

  it('treats compatibility as symmetric and true for the same enchantment and for enchantments missing from the edition', () => {
    expect(areCompatible('java', 'sharpness', 'smite')).toBe(false)
    expect(areCompatible('java', 'smite', 'sharpness')).toBe(false)
    expect(areCompatible('java', 'riptide', 'loyalty')).toBe(false)
    expect(areCompatible('java', 'loyalty', 'channeling')).toBe(true)
    expect(areCompatible('java', 'mending', 'infinity')).toBe(false)
    expect(areCompatible('java', 'protection', 'protection')).toBe(true)
    expect(areCompatible('bedrock', 'sweeping_edge', 'sharpness')).toBe(true)
  })

  it('follows the item data for applicability and returns false outside the edition', () => {
    expect(isApplicable('java', 'boots', 'soul_speed')).toBe(true)
    expect(isApplicable('java', 'sword', 'sweeping_edge')).toBe(true)
    expect(isApplicable('bedrock', 'sword', 'sweeping_edge')).toBe(false)
    expect(isApplicable('java', 'pickaxe', 'sharpness')).toBe(false)
    expect(isApplicable('java', 'recovery_compass', 'vanishing_curse')).toBe(false)
    expect(isApplicable('java', 'mace', 'breach')).toBe(true)
  })

  it('returns applicable enchantments in data order', () => {
    const order = GAME_DATA.enchantments.map((e) => e.id)
    for (const edition of EDITIONS) {
      for (const item of itemsInEdition(edition)) {
        const ids = applicableEnchantments(edition, item.id)
        expect([...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(ids)
      }
    }
  })

  it('looks up max levels, enchantments and items and throws for unknown ids', () => {
    expect(maxLevel('sharpness')).toBe(5)
    expect(maxLevel('mending')).toBe(1)
    expect(maxLevel('wind_burst')).toBe(3)
    expect(() => getEnchantment('nope' as EnchantmentId)).toThrow(/unknown enchantment/)
    expect(() => getItem('nope' as ItemTypeId)).toThrow(/unknown item/)
  })

  it('accepts only known ids in the type guards', () => {
    expect(isEnchantmentId('sharpness')).toBe(true)
    expect(isEnchantmentId('curse_of_binding')).toBe(false)
    expect(isEnchantmentId(3)).toBe(false)
    expect(isItemTypeId('head')).toBe(true)
    expect(isItemTypeId('mob_head')).toBe(false)
    expect(isItemTypeId(null)).toBe(false)
  })
})

describe('tooltip order (26.3 #minecraft:tooltip_order)', () => {
  it('lists each of the 43 enchantments once', () => {
    expect(ENCHANTMENT_TOOLTIP_ORDER).toHaveLength(43)
    expect(new Set(ENCHANTMENT_TOOLTIP_ORDER)).toEqual(new Set(ALL_ENCHANTMENT_IDS))
  })

  it('starts with the curses and ends with mending', () => {
    expect(ENCHANTMENT_TOOLTIP_ORDER.slice(0, 2)).toEqual(['binding_curse', 'vanishing_curse'])
    expect(tooltipPosition('mending')).toBe(42)
    const ids: EnchantmentId[] = ['mending', 'protection', 'binding_curse']
    expect(ids.sort(compareTooltipOrder)).toEqual(['binding_curse', 'protection', 'mending'])
  })
})
