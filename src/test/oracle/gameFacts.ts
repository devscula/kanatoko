// Reads the raw GAME_DATA entries rather than the helpers in src/data/gameData.ts, so a mistake in those helpers shows up
// as a mismatch in the cross-check.

import { GAME_DATA } from '../../data/gameData.generated.ts'
import type {
  Edition,
  EnchantmentDef,
  EnchantmentEditionData,
  EnchantmentId,
  ItemDef,
  ItemEditionData,
  ItemTypeId,
} from '../../data/types.ts'

const ENCHANTMENTS: ReadonlyMap<string, EnchantmentDef> = new Map(GAME_DATA.enchantments.map((def) => [def.id, def]))
const ITEMS: ReadonlyMap<string, ItemDef> = new Map(GAME_DATA.items.map((def) => [def.id, def]))
const DATA_POSITION: ReadonlyMap<string, number> = new Map(GAME_DATA.enchantments.map((def, index) => [def.id, index]))

export const ENCHANTMENT_ORDER: readonly EnchantmentId[] = GAME_DATA.enchantments.map((def) => def.id)

export function enchantmentDef(id: EnchantmentId): EnchantmentDef {
  const def = ENCHANTMENTS.get(id)
  if (def === undefined) throw new Error(`oracle: unknown enchantment ${id}`)
  return def
}

export function itemDef(id: ItemTypeId): ItemDef {
  const def = ITEMS.get(id)
  if (def === undefined) throw new Error(`oracle: unknown item type ${id}`)
  return def
}

/** Null when the enchantment does not exist in the edition. */
export function enchantmentIn(edition: Edition, id: EnchantmentId): EnchantmentEditionData | null {
  const def = ENCHANTMENTS.get(id)
  if (def === undefined) return null
  return edition === 'java' ? def.java : def.bedrock
}

/** Null when the item type does not exist in the edition. */
export function itemIn(edition: Edition, id: ItemTypeId): ItemEditionData | null {
  const def = ITEMS.get(id)
  if (def === undefined) return null
  return edition === 'java' ? def.java : def.bedrock
}

export function dataPosition(id: EnchantmentId): number {
  const position = DATA_POSITION.get(id)
  if (position === undefined) throw new Error(`oracle: unknown enchantment ${id}`)
  return position
}

export function enchantmentsOf(edition: Edition): EnchantmentId[] {
  return ENCHANTMENT_ORDER.filter((id) => enchantmentIn(edition, id) !== null)
}

export function itemTypesOf(edition: Edition): ItemTypeId[] {
  return GAME_DATA.items.filter((def) => (edition === 'java' ? def.java : def.bedrock) !== null).map((def) => def.id)
}

function requireEnchantment(edition: Edition, id: EnchantmentId): EnchantmentEditionData {
  const data = enchantmentIn(edition, id)
  if (data === null) throw new Error(`oracle: ${id} does not exist in ${edition}`)
  return data
}

/** The multiplier depends only on what is sacrificed, never on the target. */
export function sacrificeMultiplier(edition: Edition, id: EnchantmentId, sacrificeKind: 'item' | 'book'): number {
  const data = requireEnchantment(edition, id)
  return sacrificeKind === 'book' ? data.bookMultiplier : data.itemMultiplier
}

/** Anvil applicability: supported_items in Java, the wiki tables in Bedrock. */
export function canApply(edition: Edition, itemType: ItemTypeId, id: EnchantmentId): boolean {
  const data = itemIn(edition, itemType)
  if (data === null) throw new Error(`oracle: ${itemType} does not exist in ${edition}`)
  return data.applicable.includes(id)
}

/**
 * Like the game's Enchantment.areCompatible, either one listing the other is enough, so the data need not be symmetric. An
 * enchantment is never exclusive with itself; the levels merge instead.
 */
export function areExclusive(edition: Edition, a: EnchantmentId, b: EnchantmentId): boolean {
  if (a === b) return false
  return requireEnchantment(edition, a).exclusiveWith.includes(b) || requireEnchantment(edition, b).exclusiveWith.includes(a)
}

export function maxLevelOf(id: EnchantmentId): number {
  return enchantmentDef(id).maxLevel
}

/** Two items of the same type can be combined only when the type has durability. */
export function isDamageable(itemType: ItemTypeId): boolean {
  return itemDef(itemType).damageable
}

/** The enchanted book as an item type stands for merging books into one. */
export function isBookType(itemType: ItemTypeId): boolean {
  return itemDef(itemType).isBook
}
